import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { httpClient } from "../../support/http-client.ts";

Deno.test("query owner retains actual failed HTTP output for retry and closes ordinary pending work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    hby.db.locs.pin([hab.pre, "http"], { url: "https://query.test/" });
    const fault = new Error("query peer unavailable");
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => Promise.reject(fault)),
      systemClock,
    );
    try {
      const request = { pre: hab.pre, src: hab.pre, route: "logs" as const, q: {}, wits: [hab.pre] };
      for (let index = 0; index < 9; index++) runtime.querying.enqueue(request);
      yield* runtime.querying.processPending();
      assertEquals([
        runtime.querying.pending.empty,
        runtime.querying.hasPendingDelivery,
        runtime.querying.hasPendingWork(),
      ], [true, true, true]);
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.querying.deliverOnce()))), fault);
      assertEquals(runtime.querying.hasPendingDelivery, true);
      yield* runtime.querying.close();
      assertEquals(runtime.querying.hasPendingWork(), false);
      assertThrows(() => runtime.querying.enqueue(request), Error, "closed");
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
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => Promise.resolve(new Response(body))),
      systemClock,
    );
    try {
      hby.db.locs.pin([hab.pre, "http"], { url: "https://query.test/" });
      runtime.querying.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, wits: [hab.pre] });
      yield* runtime.querying.processPending();
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
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => {
        requests++;
        const response = new Response(new Uint8Array());
        const cancel = response.body!.cancel.bind(response.body);
        response.body!.cancel = async (reason) => {
          cleaning.resolve();
          await release.promise;
          await cancel(reason);
        };
        return Promise.resolve(response);
      }),
      systemClock,
    );
    const queue = runtime.querying;
    hby.db.locs.pin([hab.pre, "http"], { url: "https://query.test/" });
    for (let index = 0; index < 2; index++) {
      queue.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, wits: [hab.pre] });
    }
    yield* queue.processPending();
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
