import { createHabery } from "keri-ts/db/lmdb";
import { systemClock } from "../../keri/src/app/runtime/runtime-clock.ts";
import { httpClient } from "../../keri/test/support/http-client.ts";
// @file-test-lane app-fast-parallel

import {
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  MtrDex,
  nestedPayload,
  parseBytes,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, sleep, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import {
  type AgentRuntime,
  createAgentRuntime,
  envelopeFromFrame,
  exchange,
  type Habery,
  type KramConfig,
  mailboxTopicKey,
  query,
  readCesrRequestBytes,
  Roles,
  settleRuntimeIngress,
} from "keri-ts/runtime";
import { introduce } from "../../keri/src/app/delivery/introducing.ts";
import { runHostKernel } from "../src/host/kernel.ts";
import { drainRuntimeCues } from "../src/http/protocol/runtime-bridge.ts";

Deno.test("HTTP cue drain publishes guarded wire while Poster owns delivery and joined cancellation", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    let start!: () => void, finish!: () => void;
    let started = new Promise<void>((resolve) => start = resolve);
    let gate = new Promise<void>((resolve) => finish = resolve);
    let failure: unknown, posted: Uint8Array | undefined, sends = 0;
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (_url, init) => {
        sends++;
        posted = await readCesrRequestBytes(new Request(_url, init));
        start();
        await gate;
        if (failure) throw failure;
        return new Response(null, { status: 204 });
      }),
      systemClock,
    );
    try {
      hby.db.locs.pin([recipient.pre, "https"], { url: "https://recipient.test/" });
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
      const [frame] = parseBytes(wire);
      assertExists(frame.gvrsn);
      assertEquals(posted, concatBytes(Counter.makeGVC(frame.gvrsn), wire));
      yield* runtime.postman.process();
      assertEquals(sends, 1, "failed attempts do not retry automatically");
      failure = undefined;

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
      assertEquals(
        runtime.postman.cues.empty,
        true,
        "unobserved failures are reported without keeping outcome history",
      );

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

Deno.test("host listener precedes loopback mailbox consumption and shutdown joins the consumer", async () => {
  for (const configured of [false, true]) {
    const kram: KramConfig | undefined = configured
      ? { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } }
      : undefined;
    const reservation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (reservation.addr as Deno.NetAddr).port;
    reservation.close();
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const hab = hby.makeHab("host");
      hby.db.locs.pin([hab.pre, "http"], { url: `http://127.0.0.1:${port}` });
      hby.db.ends.pin([hab.pre, Roles.mailbox, hab.pre], { allowed: true });
      const worker = yield* spawn(() =>
        runHostKernel(hby, {
          enableMailboxStore: true,
          enableRelay: false,
          kram,
          serviceHab: hab,
          http: { port, hostname: "127.0.0.1" },
          protocolPolicy: {},
          companionHosts: [function*(runtime) {
            assertEquals(!!runtime.reactor.kvy.kramer, configured);
            assertStrictEquals(runtime.reactor.kvy.db, hby.db);
            const body = query("ksn", { i: hab.pre, src: hab.pre }, { pre: hab.pre, pvrsn: Vrsn_2_0 });
            const [frame] = yield* call(() => parseBytes(hab.endorse(body, { gvrsn: Vrsn_2_0 })));
            const result = runtime.reactor.kvy.kramer?.intake(envelopeFromFrame(frame));
            assertEquals(result?.kind, configured ? "ready" : undefined);
            if (result?.kind === "ready") assertEquals(typeof result.receiverTime, "string");
            assertEquals(!!hby.db.msgc.get([hab.pre, body.said!]), configured);
            runtime.mailboxer!.storeMsg(`${hab.pre}/reply`, hab.makeEndRole(hab.pre, Roles.controller, true));
          }],
        })
      );
      try {
        const deadline = performance.now() + 2_000;
        while (hby.db.tops.get([hab.pre, hab.pre])?.topics["/reply"] !== 0 && performance.now() < deadline) {
          yield* sleep(10);
        }
        assertEquals(hby.db.tops.get([hab.pre, hab.pre])?.topics["/reply"], 0);
        assertEquals(hby.db.ends.get([hab.pre, Roles.controller, hab.pre])?.allowed, true);
      } finally {
        yield* worker.halt();
        // The kernel borrowed the Habery; HTTP response and poll work have joined.
        assertEquals(hby.db.opened, true);
        yield* hby.close(true);
      }
    });
  }
});

/** Reserve a free loopback port for a host that binds it next. */
function reservePort(): number {
  const reservation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (reservation.addr as Deno.NetAddr).port;
  reservation.close();
  return port;
}

/** Accept wire into a Habery's state before its host starts, through a short-lived runtime. */
function* preload(hby: Habery, messages: Uint8Array[]) {
  const runtime = yield* createAgentRuntime(hby, httpClient(() => Promise.reject(new Error("no egress"))), systemClock);
  try {
    yield* settleRuntimeIngress(runtime, messages);
  } finally {
    yield* runtime.close();
  }
}

Deno.test("edge to agent to third-party mailbox delivers the signed child", async () => {
  const agentPort = reservePort();
  const mailboxPort = reservePort();
  await run(function*() {
    const agentHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const mailboxHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const agent = agentHby.makeHab("agent");
      const mailbox = mailboxHby.makeHab("mailbox", undefined, { transferable: false });
      const sender = edgeHby.makeHab("sender");
      const recipient = edgeHby.makeHab("recipient");
      const mailboxUrl = `http://127.0.0.1:${mailboxPort}/`;
      agentHby.db.locs.pin([agent.pre, "http"], { url: `http://127.0.0.1:${agentPort}/` });
      mailboxHby.db.locs.pin([mailbox.pre, "http"], { url: mailboxUrl });
      // The recipient uses a mailbox the agent does not host; both know it only from the recipient's replies.
      const recipientMailbox = recipient.makeEndRole(mailbox.pre, Roles.mailbox, true);
      yield* preload(mailboxHby, [introduce(recipient, mailbox.pre), recipientMailbox]);
      yield* preload(agentHby, [
        introduce(recipient, agent.pre),
        recipientMailbox,
        mailbox.makeLocScheme(mailboxUrl),
      ]);

      const listening = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      let mailboxRuntime: AgentRuntime | undefined;
      let agentRuntime: AgentRuntime | undefined;
      const mailboxHost = yield* spawn(() =>
        runHostKernel(mailboxHby, {
          enableMailboxStore: true,
          enableRelay: false,
          serviceHab: mailbox,
          http: { port: mailboxPort, hostname: "127.0.0.1", onListen: () => listening[0].resolve() },
          protocolPolicy: {},
          companionHosts: [function*(runtime) {
            mailboxRuntime = runtime;
            yield* suspend();
          }],
        })
      );
      const agentHost = yield* spawn(() =>
        runHostKernel(agentHby, {
          enableMailboxStore: true,
          enableRelay: true,
          // The plan's agent runs KRAM; every message the edge hands it is judged as received input.
          kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
          serviceHab: agent,
          http: { port: agentPort, hostname: "127.0.0.1", onListen: () => listening[1].resolve() },
          protocolPolicy: {},
          companionHosts: [function*(runtime) {
            agentRuntime = runtime;
            yield* suspend();
          }],
        })
      );
      try {
        yield* call(() => Promise.all(listening.map((listener) => listener.promise)));
        // The edge signs locally and hands the agent one `/fwd` for the recipient, as Poster would wrap it.
        const [child] = yield* call(() =>
          parseBytes(sender.endorse(
            exchange("/relay/check", { value: "through the agent" }, { sender: sender.pre, pvrsn: Vrsn_2_0 })[0],
            { pipelined: false, gvrsn: Vrsn_2_0, genusify: true },
          ))
        );
        const [fwd] = exchange("/fwd", {
          evt: new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(child.body.raw, MtrDex.Blake3_256) }).qb64,
        }, { sender: sender.pre, modifiers: { pre: recipient.pre, topic: "relay" }, pvrsn: Vrsn_2_0 });
        const [outer] = yield* call(() =>
          parseBytes(sender.endorse(fwd, { pipelined: false, gvrsn: Vrsn_2_0, genusify: true }))
        );
        const wrapper = yield* call(() => collectPayload(framePayload({ ...outer, nests: [child] })));
        const status = yield* call(async () => {
          const response = await fetch(`http://127.0.0.1:${agentPort}/`, {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: new Blob([concatBytes(
              introduce(sender, agent.pre),
              sender.makeEndRole(agent.pre, Roles.mailbox, true),
              wrapper,
            ) as Uint8Array<ArrayBuffer>]),
          });
          await response.body?.cancel();
          return response.status;
        });
        assertEquals(status, 204);

        const key = mailboxTopicKey(recipient.pre, "relay");
        const deadline = performance.now() + 10_000;
        while (!mailboxRuntime?.mailboxer?.getTopicMsgs(key).length && performance.now() < deadline) {
          yield* sleep(25);
        }
        const stored = mailboxRuntime!.mailboxer!.getTopicMsgs(key);
        assertEquals(stored.length, 1);
        // The third-party mailbox holds the sender's own signed child, not anything the agent signed.
        assertEquals(stored[0], yield* call(() => collectPayload(nestedPayload(child, Vrsn_2_0))));
        assertExists(agentRuntime!.reactor.kvy.kramer, "the agent judged the edge's input under KRAM");
        // The agent relayed the child; it kept no copy for a recipient it does not serve.
        assertEquals(agentRuntime!.mailboxer!.getTopicMsgs(key), []);
      } finally {
        yield* agentHost.halt();
        yield* mailboxHost.halt();
      }
    } finally {
      yield* edgeHby.close(true);
      yield* mailboxHby.close(true);
      yield* agentHby.close(true);
    }
  });
});
