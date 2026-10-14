import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { RuntimeDeliveries } from "../../../src/app/runtime-deliveries.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";

Deno.test("query delivery admission retains accepted requests on queue overflow and delivery failure", async () => {
  const resources = new ResourcePolicy();
  const queue = new RuntimeDeliveries(resources);
  const request = {
    url: "https://query.test/",
    body: new Uint8Array(),
    bodyMode: "header" as const,
    destination: "aid",
  };
  for (let index = 0; index < 8; index++) queue.enqueue(() => request);
  assertThrows(() => queue.enqueue(() => request), Error, "Deck capacity");
  assertEquals(resources.used.bytes, 72 * 1024 * 1024);
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
  assertEquals(assertThrows(() => second.enqueue(prepare), ResourceAdmissionError).reason, "busy");
  assertEquals(prepared, false, "shared refusal precedes source acquisition or concatenation");
  assertEquals(shared.used.bytes, 9 * 1024 * 1024);
  const tooSmall = new RuntimeDeliveries(new ResourcePolicy({ bytes: shared.limits.bytes - 1 }));
  assertEquals(assertThrows(() => tooSmall.enqueue(prepare), ResourceAdmissionError).reason, "limit");
  assertEquals(prepared, false);
  const cue = { kin: "query" as const, pre: "aid", src: "aid", query: {} };
  const emptyFloor = new RuntimeDeliveries(new ResourcePolicy({ bytes: 33 * 1024 ** 2 }));
  assertEquals(assertThrows(() => emptyFloor.enqueue(prepare, undefined, cue), ResourceAdmissionError).reason, "limit");
  assertEquals(prepared, false, "combined source retention floor refuses before signing");
  assertEquals(
    assertThrows(() =>
      new RuntimeDeliveries(new ResourcePolicy({ bytes: 40 * 1024 ** 2 }))
        .enqueue(prepare, undefined, cue, 8 * 1024 ** 2), ResourceAdmissionError).reason,
    "limit",
  );
  assertEquals(prepared, false, "existing owned source credit cannot become irreducible busy");
  assertThrows(() =>
    new RuntimeDeliveries(resources).enqueue(prepare, undefined, {
      ...cue,
      query: { q: "x".repeat(4 * 1024 ** 2 + 1) },
    }), ResourceLimitError);
  assertEquals(prepared, false, "finite input ceiling refuses before query serialization");
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
        body: hab.query(hab.pre, hab.pre, {}, "logs"),
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
      body: hab.query(hab.pre, hab.pre, {}, "logs"),
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
