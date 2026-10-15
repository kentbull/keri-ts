import { call, run, spawn } from "effection";
import { assertEquals, assertObjectMatch, assertRejects, assertThrows } from "jsr:@std/assert";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { queryTransportSink, RuntimeDeliveries } from "../../../src/app/runtime-deliveries.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";

Deno.test("query delivery queues ordinary requests and retains failed deliveries for retry", async () => {
  const resources = new ResourcePolicy();
  const queue = new RuntimeDeliveries(resources);
  const request = {
    url: "https://query.test/",
    body: new Uint8Array(),
    bodyMode: "header" as const,
    destination: "aid",
  };
  for (let index = 0; index < 9; index++) assertEquals(queue.enqueue(() => request), { kind: "queued" });
  assertEquals(resources.used.bytes, 81 * 1024 * 1024);
  assertEquals(queue.hasPending, true);
  await run(() => queue.close());
  assertEquals(queue.hasPending, false);
  assertEquals(resources.used.bytes, 0);
  assertThrows(() => queue.enqueue(() => request), Error, "closed");

  const failed = new RuntimeDeliveries(resources);
  failed.enqueue(() => ({ ...request, body: new TextEncoder().encode("invalid CESR") }));
  // Parser rejection retains the exact queued request for explicit retry or shutdown disposal.
  await assertRejects(() => run(() => failed.process({} as AgentRuntime)));
  assertEquals(failed.hasPending, true);
  assertEquals(resources.used.bytes, 9 * 1024 * 1024, "failed delivery retains retry ownership");
  await run(() => failed.close());
  assertEquals(resources.used.bytes, 0);
  const invalidRoute = new RuntimeDeliveries(resources);
  assertThrows(() => invalidRoute.enqueue(() => ({ ...request, url: "x".repeat(512 * 1024) })), ResourceLimitError);
  assertEquals(resources.used.bytes, 0, "metadata overflow releases both preparation and retained route credit");

  const shared = new ResourcePolicy({ bytes: 33 * 1024 * 1024 });
  const first = new RuntimeDeliveries(shared), second = new RuntimeDeliveries(shared);
  first.enqueue(() => request);
  let prepared = false;
  const prepare = () => {
    prepared = true;
    return request;
  };
  assertObjectMatch(second.enqueue(prepare), { kind: "refuse", error: { reason: "busy" } });
  assertEquals(prepared, false, "shared refusal precedes source acquisition or concatenation");
  assertEquals(shared.used.bytes, 9 * 1024 * 1024);
  const tooSmall = new RuntimeDeliveries(new ResourcePolicy({ bytes: shared.limits.bytes - 1 }));
  assertObjectMatch(tooSmall.enqueue(prepare), { kind: "refuse", error: { reason: "limit" } });
  assertEquals(prepared, false);
  const oversized = new RuntimeDeliveries(resources);
  assertThrows(
    () => oversized.enqueue(() => ({ ...request, body: new Uint8Array(8 * 1024 ** 2 + 1) })),
    ResourceLimitError,
    "Query request exceeds byte limit",
  );
  assertEquals(oversized.hasPending, false, "oversized wire is never queued");
  assertEquals(resources.used.bytes, 0, "oversized wire releases preparation and retained credit");
  await run(() => first.close());
  assertThrows(
    () =>
      second.enqueue(() => {
        throw new Error("wire preparation failed");
      }),
    Error,
    "wire preparation",
  );
  assertEquals(shared.used.bytes, 0);
  second.enqueue(prepare);
  await run(() => second.close());
  assertEquals(shared.used.bytes, 0);
});

Deno.test("query transport admits prepared wire without charging its borrowed cue twice", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    hby.db.locs.pin([hab.pre, "http"], { url: "https://query.test/" });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    const occupied = runtime.resources.reserve({ bytes: runtime.resources.limits.bytes - 33 * 1024 ** 2 });
    if (occupied.kind !== "reserve") throw new Error("Expected available fixture capacity");
    try {
      const cue = { kin: "query" as const, pre: hab.pre, src: hab.pre, wits: [hab.pre], route: "logs" as const, q: {} };
      const sink = queryTransportSink(runtime, hby, hab);
      assertEquals(sink.admitQuery!(cue, () => hab.interpretCue(cue) ?? null), "transferred");
      assertEquals(runtime.deliveries.hasPending, true);
    } finally {
      occupied.reservation.release();
      yield* runtime.close();
      assertEquals(runtime.resources.used.bytes, 0);
      yield* hby.close(true);
    }
  });
});

Deno.test("runtime query shutdown joins a pending response read before closing stores", async () => {
  const reading = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let continued = false;
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const body = new ReadableStream<Uint8Array>({
      pull() {
        reading.resolve();
      },
      async cancel() {
        cleanup.resolve();
        await release.promise;
      },
    }, { highWaterMark: 0 });
    const runtime = yield* createAgentRuntime(hby, {
      services: { http: { fetch: () => Promise.resolve(new Response(body)) } },
    });
    try {
      runtime.deliveries.enqueue(() => ({
        url: "https://query.test/",
        body: hab.query(hab.pre, hab.pre, { route: "logs", q: {} }),
        bodyMode: "header",
        destination: hab.pre,
      }));
      const delivery = yield* spawn(function*() {
        try {
          yield* runtime.deliveries.process(runtime);
          continued = true;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        }
      });
      yield* call(() => reading.promise);
      let closed = false;
      const closing = yield* spawn(function*() {
        yield* runtime.deliveries.close();
        closed = true;
      });
      yield* call(() => cleanup.promise);
      assertEquals(closed, false); // Runtime shutdown must join the transport's asynchronous cancel.
      assertEquals(runtime.resources.used.bytes >= 9 * 1024 * 1024, true, "active request retains credit until joined");
      release.resolve();
      yield* closing;
      yield* delivery;
      assertEquals([closed, continued, body.locked], [true, false, false]);
      assertEquals(runtime.resources.used.bytes, 0);
    } finally {
      release.resolve();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("query shutdown after successful response consumption cannot send the next queued request", async () => {
  const cleaning = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let requests = 0;
  let continued = false;
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const resources = new ResourcePolicy();
    const queue = new RuntimeDeliveries(resources);
    const runtime = {
      services: {
        ...defaultRuntimeServices,
        http: {
          fetch: () => {
            requests++;
            return Promise.resolve(
              new Response(
                new ReadableStream<Uint8Array>({
                  async cancel() {
                    cleaning.resolve();
                    await release.promise;
                  },
                }),
              ),
            );
          },
        },
      },
      // Isolate the drainer handoff: response handling succeeded, but its HTTP owner has not finished cleanup.
      reactor: { *process() {} },
    } as unknown as AgentRuntime;
    const request = {
      url: "https://query.test/",
      body: hab.query(hab.pre, hab.pre, { route: "logs", q: {} }),
      bodyMode: "header" as const,
      destination: hab.pre,
    };
    queue.enqueue(() => request);
    queue.enqueue(() => request);
    const delivery = yield* spawn(function*() {
      try {
        yield* queue.process(runtime);
        continued = true;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      }
    });
    try {
      yield* call(() => cleaning.promise);
      const closing = yield* spawn(() => queue.close());
      release.resolve();
      yield* closing;
      yield* delivery;
      assertEquals([requests, continued, queue.hasPending], [1, false, false]);
      assertEquals(resources.used.bytes, 0);
    } finally {
      release.resolve();
      yield* delivery.halt();
      yield* queue.close();
      yield* hby.close(true);
    }
  });
});
import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";
