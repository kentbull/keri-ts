import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  createAgentRuntime,
  queryTransportSink,
} from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";

import { QueryCoordinator } from "../../../src/app/querying.ts";

Deno.test("query owner queues ordinary packets and retains failed deliveries for retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby), queue = runtime.querying;
    const request = {
      url: "https://query.test/",
      body: hab.query(hab.pre, hab.pre, { route: "logs", q: {} }),
      bodyMode: "header" as const,
      destination: hab.pre,
    };
    try {
      for (let index = 0; index < 9; index++) queue.enqueueDelivery(request);
      assertEquals(queue.hasPendingDelivery, true);
      assertEquals(queue.hasPendingWork(), true, "query convergence includes queued wire");
      yield* queue.close();
      assertEquals(queue.hasPendingDelivery, false);
      assertThrows(() => queue.enqueueDelivery(request), Error, "closed");
      const failed = new QueryCoordinator(hby, { reactor: runtime.reactor });
      try {
        failed.enqueueDelivery({ ...request, body: new TextEncoder().encode("invalid CESR") });
        yield* call(() => assertRejects(() => run(() => failed.deliverOnce())));
        assertEquals(failed.hasPendingDelivery, true, "failed delivery remains available for retry or shutdown");
      } finally {
        yield* failed.close();
      }
      assertEquals(failed.hasPendingDelivery, false);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("query transport prepares and queues wire without an application credit policy", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    hby.db.locs.pin([hab.pre, "http"], { url: "https://query.test/" });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const cue = { kin: "query" as const, pre: hab.pre, src: hab.pre, wits: [hab.pre], route: "logs" as const, q: {} };
      const sink = queryTransportSink(runtime, hab);
      assertEquals(sink.admitQuery!(cue, () => hab.interpretCue(cue) ?? null), "transferred");
      assertEquals(runtime.querying.hasPendingDelivery, true);
    } finally {
      yield* runtime.close();

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
      runtime.querying.enqueueDelivery({
        url: "https://query.test/",
        body: hab.query(hab.pre, hab.pre, { route: "logs", q: {} }),
        bodyMode: "header",
        destination: hab.pre,
      });
      const delivery = yield* spawn(function*() {
        try {
          yield* runtime.querying.deliverOnce();
          continued = true;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        }
      });
      yield* call(() => reading.promise);
      let closed = false;
      const closing = yield* spawn(function*() {
        yield* runtime.querying.close();
        closed = true;
      });
      yield* call(() => cleanup.promise);
      assertEquals(closed, false);
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
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          fetch: () => {
            requests++;
            const response = new Response(new Uint8Array());
            const cancel = response.body!.cancel.bind(response.body);
            response.body!.cancel = async (reason) => {
              cleaning.resolve();
              await release.promise;
              await cancel(reason);
            };
            return Promise.resolve(response);
          },
        },
      },
    });
    const queue = runtime.querying;
    const request = {
      url: "https://query.test/",
      body: hab.query(hab.pre, hab.pre, { route: "logs", q: {} }),
      bodyMode: "header" as const,
      destination: hab.pre,
    };
    queue.enqueueDelivery(request);
    queue.enqueueDelivery(request);
    const delivery = yield* spawn(function*() {
      try {
        yield* queue.deliverOnce();
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
      assertEquals([requests, continued, queue.hasPendingDelivery], [1, false, false]);
    } finally {
      release.resolve();
      yield* delivery.halt();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
