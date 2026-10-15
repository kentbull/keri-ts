import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { queryTransportSink, RuntimeDeliveries } from "../../../src/app/runtime-deliveries.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";

Deno.test("query delivery queues ordinary requests and retains failed deliveries for retry", async () => {
  const queue = new RuntimeDeliveries();
  const request = {
    url: "https://query.test/",
    body: new Uint8Array(9 * 1024 ** 2),
    bodyMode: "header" as const,
    destination: "aid",
  };
  for (let index = 0; index < 9; index++) queue.enqueue(request);
  assertEquals(queue.hasPending, true);
  await run(() => queue.close());
  assertEquals(queue.hasPending, false);
  assertThrows(() => queue.enqueue(request), Error, "closed");

  const failed = new RuntimeDeliveries();
  failed.enqueue({ ...request, body: new TextEncoder().encode("invalid CESR") });
  await assertRejects(() => run(() => failed.process({} as AgentRuntime)));
  assertEquals(failed.hasPending, true, "failed delivery remains available for retry or shutdown");
  await run(() => failed.close());
  assertEquals(failed.hasPending, false);
});

Deno.test("query transport prepares and queues wire without an application credit policy", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    hby.db.locs.pin([hab.pre, "http"], { url: "https://query.test/" });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const cue = { kin: "query" as const, pre: hab.pre, src: hab.pre, wits: [hab.pre], route: "logs" as const, q: {} };
      const sink = queryTransportSink(runtime, hby, hab);
      assertEquals(sink.admitQuery!(cue, () => hab.interpretCue(cue) ?? null), "transferred");
      assertEquals(runtime.deliveries.hasPending, true);
    } finally {
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
      runtime.deliveries.enqueue({
        url: "https://query.test/",
        body: hab.query(hab.pre, hab.pre, { route: "logs", q: {} }),
        bodyMode: "header",
        destination: hab.pre,
      });
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
    const queue = new RuntimeDeliveries();
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
    queue.enqueue(request);
    queue.enqueue(request);
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
    } finally {
      release.resolve();
      yield* delivery.halt();
      yield* queue.close();
      yield* hby.close(true);
    }
  });
});
