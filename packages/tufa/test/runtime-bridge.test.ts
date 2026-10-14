// @file-test-lane app-fast-parallel

import { ResourceAdmissionError } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createAgentRuntime, createHabery, readCesrRequestBytes, Roles } from "keri-ts/runtime";
import { drainRuntimeCues } from "../src/http/protocol/runtime-bridge.ts";

Deno.test("HTTP cue drain transfers guarded wire then waits outside Reactor with joined ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    let start!: () => void, finish!: () => void;
    let started = new Promise<void>((resolve) => start = resolve);
    let gate = new Promise<void>((resolve) => finish = resolve);
    let failure: unknown, posted: Uint8Array | undefined, sends = 0;
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(_url, init) {
            sends++;
            posted = await readCesrRequestBytes(new Request(_url, init));
            start();
            await gate;
            if (failure) throw failure;
            return new Response(null, { status: 204 });
          },
        },
      },
    });
    try {
      hby.db.locs.pin([recipient.pre, "http"], { url: "https://recipient.test/" });
      hby.db.ends.pin([recipient.pre, Roles.controller, recipient.pre], { allowed: true });
      const wire = sender.query(sender.pre, sender.pre, {}, "logs");
      const cue = { kin: "replay" as const, src: sender.pre, dest: recipient.pre, messages: [wire] };
      runtime.cues.push(cue);
      const draining = run(() => drainRuntimeCues(runtime, sender, runtime.cues));
      yield* call(() => started);
      assertEquals(runtime.cues.empty, true);
      assertEquals(runtime.resources.used.bytes > 0, true);
      yield* runtime.reactor.settle(undefined, {}, function*() {
        runtime.cues.push({ kin: "query", pre: "unresolved", query: {} });
      });
      assertEquals(runtime.cues.length, 1, "another guarded turn progresses during network wait");
      failure = new ResourceAdmissionError("foreign fetch busy", "busy");
      finish();
      assertStrictEquals(yield* call(() => assertRejects(() => Promise.resolve(draining))), failure);
      assertEquals(runtime.deliveries.hasPending, true);
      assertEquals(posted, wire);
      failure = undefined;
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.querying.pending.length, 1, "unresolved query transfers to its existing owned queue");
      runtime.querying.pending.clear();
      for (let pass = 0; pass < 4 && runtime.deliveries.hasPending; pass++) {
        yield* runtime.deliveries.process(runtime);
      }
      assertEquals(runtime.deliveries.hasPending, false);
      assertEquals(runtime.resources.used.bytes, 0);

      started = new Promise<void>((resolve) => start = resolve);
      gate = new Promise<void>((resolve) => finish = resolve);
      runtime.cues.push(cue);
      const cancelling = run(() => drainRuntimeCues(runtime, sender, runtime.cues));
      yield* call(() => started);
      let joined = false;
      const halted = cancelling.halt().then(() => joined = true);
      yield* call(() => Promise.resolve());
      assertEquals(joined, false);
      assertEquals(runtime.resources.used.bytes > 0, true, "cancellation holds wire until fetch cleanup joins");
      finish();
      yield* call(() => halted);
      assertEquals(runtime.deliveries.hasPending, true, "cancelled transport retains independent delivery");
      for (let pass = 0; pass < 4 && runtime.deliveries.hasPending; pass++) yield* runtime.deliveries.process(runtime);
      assertEquals(runtime.resources.used.bytes, 0);

      hby.db.ends.rem([recipient.pre, Roles.controller, recipient.pre]);
      const beforeSends = sends, interpret = sender.interpretCue.bind(sender);
      let interpretations = 0;
      sender.interpretCue = (...args) => {
        interpretations++;
        return interpret(...args);
      };
      runtime.cues.push(cue);
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals([interpretations, sends, runtime.cues.length, runtime.deliveries.hasPending], [
        1,
        beforeSends,
        0,
        false,
      ], "absent endpoint remains a once-interpreted local no-op");
      assertEquals(runtime.resources.used.bytes, 0);
      sender.interpretCue = interpret;

      const event = hby.db.getEvtSerder(sender.pre, sender.kever!.serder.said!)!;
      const stream = { kin: "stream" as const, serder: event, pre: sender.pre, src: sender.pre, topics: { logs: 0 } };
      runtime.mailboxDirector.queryCues.capacity = 1;
      runtime.mailboxDirector.retainQueryCue(stream);
      const correlationBytes = runtime.resources.used.bytes;
      runtime.cues.push(stream);
      const before = runtime.resources.used.bytes;
      const sourceBytes = before - correlationBytes;
      assertEquals(sourceBytes > 0, true, "the runtime source retains independent queued cue credit");
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertStrictEquals(runtime.cues.peekHead(), stream, "correlation busy preserves the original head");
      assertEquals(runtime.resources.used.bytes, before, "busy transfer releases neither independent owner");
      runtime.mailboxDirector.queryCues.clear();
      assertEquals(runtime.resources.used.bytes, sourceBytes, "correlation clear preserves the queued source owner");
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.cues.empty, true);
      assertEquals(runtime.mailboxDirector.queryCues.length, 1);
      assertEquals(
        runtime.resources.used.bytes,
        correlationBytes,
        "successful transfer retains only correlation credit",
      );
    } finally {
      finish();
      yield* runtime.close();
      assertEquals(runtime.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
      yield* hby.close(true);
    }
  });
});
