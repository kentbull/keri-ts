import { SerderKERI } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { runtimeTurn } from "../../../../src/app/runtime/runtime-turn.ts";
import { TransportError } from "../../../../src/app/transport/transport-error.ts";
import { consoleLogger } from "../../../../src/core/logger.ts";
import { httpClient } from "../../../support/http-client.ts";

Deno.test("finite query delivery propagates failure after consuming its attempt and close clears pending work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    hby.db.locs.pin([hab.pre, "https"], { url: "https://query.test/" });
    const fault = new Error("query peer unavailable");
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => Promise.reject(fault)),
      systemClock,
    );
    try {
      const request = { pre: hab.pre, src: hab.pre, route: "logs" as const, q: {}, wits: [hab.pre] };
      for (let index = 0; index < 9; index++) runtime.querying.enqueue(request);

      assertEquals([
        runtime.querying.pending.length,
        runtime.querying.hasPendingDelivery,
        runtime.querying.hasPendingWork(),
      ], [9, false, true]);
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.querying.deliverOnce()))), fault);
      assertEquals([runtime.querying.pending.length, runtime.querying.hasPendingDelivery], [8, false]);
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
      hby.db.locs.pin([hab.pre, "https"], { url: "https://query.test/" });
      runtime.querying.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, wits: [hab.pre] });

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
    hby.db.locs.pin([hab.pre, "https"], { url: "https://query.test/" });
    for (let index = 0; index < 2; index++) {
      queue.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, wits: [hab.pre] });
    }

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

Deno.test("background query sender reports a refusal once and continues unrelated requests", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    hby.db.locs.pin([hab.pre, "https"], { url: "https://query.test/" });
    const requests: (string | null)[] = [], reported: unknown[] = [];
    const warn = consoleLogger.warn;
    consoleLogger.warn = (_message, error) => {
      reported.push(error);
    };
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (_url, init) => {
        requests.push(new SerderKERI({ raw: new Uint8Array(await new Response(init!.body).arrayBuffer()) }).route);
        return new Response(null, { status: requests.at(-1) === "ksn" ? 503 : 204 });
      }),
      systemClock,
    );
    try {
      runtime.querying.enqueue({ pre: hab.pre, src: hab.pre, route: "ksn", q: {}, wits: [hab.pre] });
      runtime.querying.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, wits: [hab.pre] });
      const worker = yield* spawn(() => runtime.querying.deliverDo());
      try {
        const deadline = Date.now() + 1_000;
        while ((requests.length < 2 || runtime.querying.hasPendingWork()) && Date.now() < deadline) {
          yield* runtimeTurn();
        }
        assertEquals(requests.filter(route => route !== null), ["ksn", "logs"]);
        assertEquals(reported.length, 1);
        assertEquals(runtime.querying.hasPendingWork(), false);
      } finally {
        yield* worker.halt();
      }
    } finally {
      consoleLogger.warn = warn;
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("background query sending propagates preparation faults even when they resemble transport failures", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => Promise.resolve(new Response(null, { status: 204 }))),
      systemClock,
    );
    const sign = hab.query, failure = new TransportError("signer storage failed");
    try {
      hby.db.locs.pin([hab.pre, "https"], { url: "https://query.test/" });
      runtime.querying.enqueue({ pre: hab.pre, src: hab.pre, route: "logs", q: {}, wits: [hab.pre] });
      hab.query = () => {
        throw failure;
      };
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.querying.deliverDo()))), failure);
    } finally {
      hab.query = sign;
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
