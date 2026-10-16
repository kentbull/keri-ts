// @file-test-lane app-fast-parallel

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
      const wire = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const cue = { kin: "replay" as const, src: sender.pre, dest: recipient.pre, messages: [wire] };
      runtime.cues.push(cue);
      const draining = run(() => drainRuntimeCues(runtime, sender, runtime.cues));
      yield* call(() => started);
      assertEquals(runtime.cues.empty, true);

      runtime.cues.push({ kin: "query", pre: "unresolved", route: "logs", q: {} });

      assertEquals(runtime.cues.length, 1, "application cue publication progresses during network wait");
      failure = new Error("foreign fetch failure");
      finish();
      assertStrictEquals(yield* call(() => assertRejects(() => Promise.resolve(draining))), failure);
      assertEquals(runtime.respondant.hasPending, true);
      assertEquals(posted, wire);
      failure = undefined;
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.querying.pending.length, 1, "unresolved query transfers to its existing owned queue");
      for (let pass = 0; pass < 4 && runtime.respondant.hasPending; pass++) {
        yield* runtime.respondant.process();
      }
      assertEquals(runtime.respondant.hasPending, false);

      started = new Promise<void>((resolve) => start = resolve);
      gate = new Promise<void>((resolve) => finish = resolve);
      runtime.cues.push(cue);
      const cancelling = run(() => drainRuntimeCues(runtime, sender, runtime.cues));
      yield* call(() => started);
      let joined = false;
      const halted = cancelling.halt().then(() => joined = true);
      yield* call(() => Promise.resolve());
      assertEquals(joined, false);

      finish();
      yield* call(() => halted);
      assertEquals(runtime.respondant.hasPending, true, "cancelled transport retains independent delivery");
      for (let pass = 0; pass < 4 && runtime.respondant.hasPending; pass++) yield* runtime.respondant.process();

      hby.db.ends.rem([recipient.pre, Roles.controller, recipient.pre]);
      const beforeSends = sends, interpret = sender.interpretCue.bind(sender);
      let interpretations = 0;
      sender.interpretCue = (...args) => {
        interpretations++;
        return interpret(...args);
      };
      runtime.cues.push(cue);
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals([interpretations, sends, runtime.cues.length, runtime.respondant.hasPending], [
        1,
        beforeSends,
        0,
        false,
      ], "absent endpoint remains a once-interpreted local no-op");

      sender.interpretCue = interpret;

      const event = hby.db.getEvtSerder(sender.pre, sender.kever!.serder.said!)!;
      const stream = { kin: "stream" as const, serder: event, pre: sender.pre, src: sender.pre, topics: { logs: 0 } };
      runtime.mailboxDirector.retainQueryCue(stream);
      runtime.cues.push(stream);
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.cues.empty, true);
      assertEquals(runtime.mailboxDirector.queryCues.toArray(), [stream, stream]);
    } finally {
      finish();
      yield* runtime.close();

      yield* hby.close(true);
    }
  });
});
