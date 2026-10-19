import { httpClient } from "../../keri/test/support/http-client.ts";
// @file-test-lane app-fast-parallel

import { call, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createAgentRuntime, createHabery, readCesrRequestBytes, Roles } from "keri-ts/runtime";
import { drainRuntimeCues } from "../src/http/protocol/runtime-bridge.ts";

Deno.test("HTTP cue drain publishes guarded wire while Poster owns delivery and joined cancellation", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    let start!: () => void, finish!: () => void;
    let started = new Promise<void>((resolve) => start = resolve);
    let gate = new Promise<void>((resolve) => finish = resolve);
    let failure: unknown, posted: Uint8Array | undefined, sends = 0;
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: httpClient(async (_url, init) => {
          sends++;
          posted = await readCesrRequestBytes(new Request(_url, init));
          start();
          await gate;
          if (failure) throw failure;
          return new Response(null, { status: 204 });
        }),
      },
    });
    try {
      hby.db.locs.pin([recipient.pre, "http"], { url: "https://recipient.test/" });
      hby.db.ends.pin([recipient.pre, Roles.controller, recipient.pre], { allowed: true });
      const wire = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const cue = { kin: "replay" as const, src: sender.pre, dest: recipient.pre, msgs: [wire] };
      runtime.cues.push(cue);
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.cues.empty, true);
      assertEquals(sends, 0, "HTTP cue publication does not start outbound delivery");
      assertEquals(runtime.postman.hasPending, true);

      const delivering = run(() => runtime.postman.process());
      yield* call(() => started);

      runtime.cues.push({ kin: "query", pre: "unresolved", route: "logs", q: {} });
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.cues.empty, true, "HTTP cue publication progresses during Poster network wait");
      assertEquals(runtime.querying.pending.length, 1, "unresolved query transfers to its existing owned queue");
      failure = new Error("foreign fetch failure");
      finish();
      assertStrictEquals(yield* call(() => assertRejects(() => Promise.resolve(delivering))), failure);
      assertEquals(runtime.postman.hasPending, false);
      assertEquals(posted, wire);
      assertStrictEquals(runtime.postman.failures[0].error, failure);
      yield* runtime.postman.process();
      assertEquals(sends, 1, "retained failures do not retry automatically");
      failure = undefined;
      runtime.postman.retry(runtime.postman.failures[0].evt);
      yield* runtime.postman.process();
      assertEquals(runtime.postman.hasPending, false);
      assertEquals(runtime.postman.failures.length, 0);
      assertEquals(sends, 2);

      started = new Promise<void>((resolve) => start = resolve);
      gate = new Promise<void>((resolve) => finish = resolve);
      runtime.cues.push(cue);
      const beforeDelivery = sends;
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(sends, beforeDelivery, "publishing a second cue still does not start network work");
      const cancelling = run(() => runtime.postman.process());
      yield* call(() => started);
      let joined = false;
      const halted = cancelling.halt().then(() => joined = true);
      yield* call(() => Promise.resolve());
      assertEquals(joined, false);

      finish();
      yield* call(() => halted);
      assertEquals(runtime.postman.hasPending, true, "cancelled transport retains independent delivery");
      for (let pass = 0; pass < 4 && runtime.postman.hasPending; pass++) yield* runtime.postman.process();

      hby.db.ends.rem([recipient.pre, Roles.controller, recipient.pre]);
      const beforeSends = sends;
      runtime.cues.push(cue);
      yield* drainRuntimeCues(runtime, sender, runtime.cues);
      assertEquals(runtime.cues.empty, true, "cue production does not require a route");
      yield* runtime.postman.process();
      assertEquals(sends, beforeSends, "absent endpoints cannot transmit");
      assertEquals(runtime.postman.hasPending, false);
      assertEquals(runtime.postman.failures.length, 1, "missing endpoints retain the source for explicit retry");
      assertEquals(runtime.postman.failures[0].evt.msg, wire);
      runtime.postman.discard(runtime.postman.failures[0].evt);

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
