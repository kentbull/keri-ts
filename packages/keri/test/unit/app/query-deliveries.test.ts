import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { QueryDeliveries } from "../../../src/app/query-transport.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";

Deno.test("query delivery admission retains accepted requests on queue overflow and delivery failure", async () => {
  const queue = new QueryDeliveries();
  const request = {
    url: "https://query.test/",
    body: new Uint8Array(),
    bodyMode: "header" as const,
    destination: "aid",
  };
  for (let index = 0; index < 8; index++) queue.enqueue(request);
  assertThrows(() => queue.enqueue(request), Error, "Deck capacity");
  assertEquals(queue.hasPending, true);
  await run(() => queue.close());
  assertEquals(queue.hasPending, false);
  assertThrows(() => queue.enqueue(request), Error, "closed");

  const failed = new QueryDeliveries();
  failed.enqueue({ ...request, body: new TextEncoder().encode("invalid CESR") });
  // Parser rejection retains the exact queued request for explicit retry or shutdown disposal.
  await assertRejects(() => run(() => failed.process({} as AgentRuntime)));
  assertEquals(failed.hasPending, true);
  await run(() => failed.close());
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
      runtime.queryDeliveries.enqueue({
        url: "https://query.test/",
        body: hab.query(hab.pre, hab.pre, {}, "logs"),
        bodyMode: "header",
        destination: hab.pre,
      });
      const delivery = yield* spawn(function*() {
        try {
          yield* runtime.queryDeliveries.process(runtime);
          continued = true;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        }
      });
      yield* call(() => reading.promise);
      let closed = false;
      const closing = yield* spawn(function*() {
        yield* runtime.queryDeliveries.close();
        closed = true;
      });
      yield* call(() => cleanup.promise);
      assertEquals(closed, false); // Runtime shutdown must join the transport's asynchronous cancel.
      release.resolve();
      yield* closing;
      yield* delivery;
      assertEquals([closed, continued, body.locked], [true, false, false]);
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
    const queue = new QueryDeliveries();
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
