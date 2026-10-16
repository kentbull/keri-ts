import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { SerderKERI } from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
} from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { drainWitnessCues, processWitnessIngress, processWitnessIngressSource } from "../../../src/app/witnessing.ts";
import type { CueEmission } from "../../../src/core/cues.ts";
import { query as queryEvent, reply as replyEvent } from "../../../src/core/protocol-eventing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("app/runtime-responder - receipt, witness, reply, and replay cues forward through poster instead of mailbox storage", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const runtime = yield* createAgentRuntime(hby);
    const posted: { hab: string; recipient: string; topic?: string }[] = [];
    runtime.poster.findBytesRoute = (hab, args) => {
      posted.push({ hab: hab.pre, recipient: args.recipient, topic: args.topic });
      return null;
    };
    const cues: CueEmission["cue"][] = [
      { kin: "receipt", serder: recipient.kever!.serder },
      { kin: "witness", serder: recipient.kever!.serder },
      { kin: "reply", serder: replyEvent("/ksn", {}), src: sender.pre, dest: recipient.pre },
      { kin: "replay", src: sender.pre, dest: recipient.pre, messages: [Uint8Array.of(4)] },
    ];
    try {
      for (const [index, cue] of cues.entries()) {
        runtime.respondant.enqueueEmission(sender, { kind: "wire", cue, messages: [Uint8Array.of(index + 1)] });
      }
      assertEquals(
        posted,
        ["/receipt", "/receipt", "/reply", "/replay"].map((topic, index) => ({
          hab: sender.pre,
          recipient: recipient.pre,
          topic,
        })),
      );
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("app/runtime-responder - stream cues stay with mailbox query correlation instead of poster delivery", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby);
    let posted = false;
    const retained: CueEmission["cue"][] = [];
    runtime.poster.sendBytes = function*() {
      posted = true;
      return { deliveries: [] };
    };
    runtime.mailboxDirector.retainQueryCue = (cue) => {
      retained.push(cue);
    };
    const cue: CueEmission["cue"] = {
      kin: "stream",
      serder: queryEvent("mbx", { i: hab.pre, src: hab.pre }),
      pre: hab.pre,
      src: hab.pre,
      topics: { "/reply": 0 },
    };
    try {
      runtime.cues.push(cue);
      yield* processCuesOnce(runtime, { hab });
      assertEquals(posted, false);
      assertEquals(retained, [cue]);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("app/runtime-responder - receipt cues for witness-only recipients land in the hosted witness mailbox store", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `runtime-respondant-witness-fallback-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const witness = hby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });

      const runtime = yield* createAgentRuntime(hby, { enableMailboxStore: true });
      try {
        ingestKeriBytes(
          runtime,
          witness.makeLocScheme("http://127.0.0.1:9137", witness.pre, "http"),
        );
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const message = new Uint8Array([8, 8, 8]);
        runtime.respondant.enqueueEmission(witness, {
          kind: "wire",
          cue: { kin: "receipt", serder: recipient.kever!.serder },
          messages: [message],
        });
        yield* runtime.respondant.process();

        const stored = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, "/receipt"),
        ) ?? [];
        assertEquals(stored, [message]);
        const receipt = witness.witness.bind(witness);
        let interpretations = 0, witnessWire: Uint8Array | undefined;
        witness.witness = (...args) => {
          interpretations++;
          return witnessWire = receipt(...args);
        };
        runtime.cues.push({ kin: "proof", said: "ignored by habitat interpretation" });
        runtime.cues.push({ kin: "witness", serder: hby.db.getEvtSerder(recipient.pre, recipient.kever!.said)! });
        const emissions = yield* processWitnessIngress(
          runtime,
          witness,
          acceptedEventReplayMessage(hby, recipient.pre, 0).message,
          { local: true },
        );
        assertEquals(interpretations, 1, "callback and delivery borrow one witness interpretation");
        const proof = emissions.find((emission) => emission.cue.kin === "witness")!;
        const emitted = [...proof.messages];
        assertEquals(emitted[0], witnessWire);
        assertEquals(emitted[0].buffer === witnessWire!.buffer, false, "finite return owns independent wire");
        const published = runtime.mailboxer!.getTopicMsgs(mailboxTopicKey(recipient.pre, "/receipt"));
        assertEquals(published, [message, ...emitted], "the existing local mailbox policy uses that same wire");
        for (let pass = 0; pass < 4 && runtime.respondant.hasPending; pass++) {
          yield* runtime.respondant.process();
        }
        assertEquals(runtime.respondant.hasPending, false);

        const chunk = new Uint8Array(4 * 1024 ** 2 + 1), messages = [chunk, chunk];
        const iterator = messages[Symbol.iterator].bind(messages), cleanupFailure = new Error("witness cursor cleanup");
        messages[Symbol.iterator] = () =>
          Object.assign(iterator(), {
            return() {
              throw cleanupFailure;
            },
          });
        runtime.cues.push({ kin: "replay", messages });
        const failed = yield* call(() =>
          assertRejects(() => run(() => drainWitnessCues(runtime, witness, runtime.cues, { deliver: false })))
        );
        assertStrictEquals(failed, cleanupFailure, "actual iterator cleanup failure retains its identity");
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("witness source verifies actual counted Hab output before EOF and joins cancellation", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `witness-progress-source-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const provider = yield* createHabery({
      name: `witness-progress-provider-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const witness = provider.makeHab("witness", undefined, { transferable: false });
      const controller = source.makeHab("controller", undefined, { wits: [witness.pre], toad: 1 });
      // Real replay/interaction producers supply their own counted attachment boundaries.
      assertEquals(provider.db.getKever(controller.pre), null, "the receiver has no controller state yet");
      const first = acceptedEventReplayMessage(source, controller.pre, 0).message;
      const later = controller.interact();
      const runtime = yield* createAgentRuntime(provider, { enableMailboxStore: true });
      const seen = Promise.withResolvers<void>(), returning = Promise.withResolvers<void>();
      const cleanup = Promise.withResolvers<void>();
      const callbackClosing = Promise.withResolvers<void>(), callbackCleanup = Promise.withResolvers<void>();
      let continued = false, eof = false, emissions = 0;
      const task = run(function*() {
        yield* processWitnessIngressSource(
          runtime,
          witness,
          async function*(signal) {
            try {
              yield first;
              await new Promise<never>((_, reject) => {
                signal.addEventListener("abort", () => reject(signal.reason), { once: true });
              });
              yield later;
              eof = true;
            } finally {
              returning.resolve();
              await cleanup.promise;
            }
          },
          { local: true, deliver: false },
          function*(emission) {
            if (emission.cue.kin === "witness") {
              emissions++;
              seen.resolve();
              yield* resource<void>(function*(provide) {
                try {
                  yield* provide();
                } finally {
                  callbackClosing.resolve();
                  yield* call(() => callbackCleanup.promise);
                }
              });
              yield* suspend();
            }
          },
        );
        continued = true;
      });
      const timeout = setTimeout(() => seen.reject(new Error("Witness acceptance waited for source EOF")), 2000);
      try {
        yield* call(() => seen.promise);
        assertEquals(provider.db.getKever(controller.pre)?.sn, 0);
        assertEquals(provider.db.wigs.get(dgKey(controller.pre, provider.db.getKever(controller.pre)!.said)).length, 1);
        assertEquals([eof, emissions, continued], [false, 1, false]);
        let halted = false;
        const halt = task.halt().then(() => halted = true);
        yield* call(() => callbackClosing.promise);
        assertEquals(halted, false);
        yield* runtime.reactor.settle(undefined, {}, function*() {});
        callbackCleanup.resolve();
        yield* call(() => returning.promise);
        assertEquals(halted, false);
        cleanup.resolve();
        yield* call(() => halt);
        assertEquals(continued, false);
        assertEquals(provider.db.getKever(controller.pre)?.sn, 0, "cancelled input cannot deliver its later event");
        assertEquals(
          runtime.cues.toArray().map((cue) =>
            cue.kin === "keyStateSaved" ? [cue.kin, cue.ksn.i, cue.ksn.d] : [cue.kin]
          ),
          [["keyStateSaved", controller.pre, provider.db.getKever(controller.pre)!.said]],
        );
        runtime.cues.clear(); // Cancellation preserves the unconsumed state cue's owner until test cleanup.

        const finite = yield* processWitnessIngress(runtime, witness, later, { local: true, deliver: false });
        assertEquals(finite.filter((emission) => emission.cue.kin === "witness").length, 1);
        assertEquals(provider.db.getKever(controller.pre)?.sn, 1);
      } finally {
        clearTimeout(timeout);
        callbackCleanup.resolve();
        cleanup.resolve();
        yield* call(() => task.halt());
        yield* runtime.close();
      }
    } finally {
      yield* provider.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("runtime Respondant preserves cues on preparation failure and progresses signed ingress during paused HTTP delivery", async () => {
  let arrived!: () => void, release!: () => void;
  const receiving = new Promise<void>((resolve) => arrived = resolve);
  const gate = new Promise<void>((resolve) => release = resolve);
  const abort = new AbortController();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, signal: abort.signal, onListen() {} },
    async (request) => {
      await readCesrRequestBytes(request);
      arrived();
      await gate;
      return new Response(null, { status: 204 });
    },
  );
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const sender = hby.makeHab("sender"),
        recipient = hby.makeHab("recipient"),
        controller = remote.makeHab("controller");
      const runtime = yield* createAgentRuntime(hby);
      try {
        ingestKeriBytes(
          runtime,
          recipient.makeLocScheme(`http://127.0.0.1:${server.addr.port}`, recipient.pre, "http"),
        );
        ingestKeriBytes(runtime, recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true));
        ingestKeriBytes(runtime, acceptedEventReplayMessage(remote, controller.pre, 0).message);
        yield* processRuntimeTurn(runtime, { hab: sender, pollMailbox: false });
        const cue = {
          kin: "reply" as const,
          src: sender.pre,
          dest: recipient.pre,
          serder: replyEvent("/loc/scheme", { eid: sender.pre, scheme: "http", url: "http://sender.test/" }),
        };
        const interpretation = sender.interpretCue;
        const active = runtime;
        active.cues.push(cue);

        const foreign = new Error("foreign cue preparation busy");
        const resolve = active.poster.findBytesRoute;
        for (const phase of ["interpret", "route"]) {
          if (phase === "interpret") {
            sender.interpretCue = () => {
              throw foreign;
            };
          } else {active.poster.findBytesRoute = () => {
              throw foreign;
            };}
          try {
            assertStrictEquals(
              yield* call(() => assertRejects(() => run(() => processCuesOnce(active, { hab: sender })))),
              foreign,
            );
            assertStrictEquals(active.cues.peekHead(), cue);
          } finally {
            sender.interpretCue = interpretation;
            active.poster.findBytesRoute = resolve;
          }
        }
        let returned = false;
        const sending = yield* spawn(function*() {
          yield* processRuntimeTurn(active, {
            hab: sender,
            pollMailbox: false,
          });
          returned = true;
        });
        let progress!: () => void;
        const progressed = new Promise<void>((resolve) => progress = resolve);
        let fail!: (error: Error) => void;
        const expired = new Promise<never>((_, reject) => fail = reject);
        const deadline = setTimeout(() => fail(new Error("Guarded ingress waited for paused delivery")), 2000);
        try {
          yield* call(() => Promise.race([receiving, expired]));
          assertEquals(active.cues.empty, true, "source removal follows admitted transfer");
          const later = controller.interact();
          const accepting = yield* spawn(function*() {
            yield* active.reactor.process((signal) => chunkBytes(later, { signal }), { local: true });
            progress();
          });
          yield* call(() => Promise.race([progressed, expired]));
          assertEquals(returned, false, "the real HTTP delivery is still paused");
          assertEquals(hby.db.getKever(controller.pre)?.sn, 1, "verified input progresses before delivery returns");
          assertEquals(active.respondant.hasPending, true);
          release();
          yield* accepting;
          yield* sending;
          yield* active.respondant.process();
          assertEquals(
            active.cues.toArray().map((cue) =>
              cue.kin === "receipt"
                ? [cue.kin, cue.serder.pre, cue.serder.said]
                : cue.kin === "keyStateSaved"
                ? [cue.kin, cue.ksn.i, cue.ksn.d]
                : [cue.kin]
            ),
            [["receipt", controller.pre, controller.kever!.said], [
              "keyStateSaved",
              controller.pre,
              controller.kever!.said,
            ]],
          );
          active.cues.clear(); // Retire verified queued test work without masking any delivery-owner leak.
        } finally {
          clearTimeout(deadline);
          release();
          yield* sending.halt();
          yield* active.close();
        }
        sender.interpretCue = interpretation;
      } finally {
        release();
        yield* runtime.close();
        yield* remote.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    release();
    abort.abort();
    await server.finished;
  }
});

Deno.test("witness recovery queries use the concrete query owner and sign only once", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const witness = hby.makeHab("witness", undefined, { transferable: false, ncount: 0 });
    const subject = hby.makeHab("subject");
    hby.db.locs.pin([subject.pre, "http"], { url: "http://query.test/" });
    let signatures = 0, sent = 0;
    const query = witness.query;
    witness.query = function(...args) {
      signatures++;
      return query.apply(this, args);
    };
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(url, init) {
            const wire = await readCesrRequestBytes(new Request(url, init));
            if (new SerderKERI({ raw: wire }).ilk === "qry") sent++;
            return new Response(null, { status: 204 });
          },
        },
      },
    });
    try {
      runtime.cues.push({
        kin: "query",
        pre: subject.pre,
        src: subject.pre,
        route: "logs",
        q: {},
        wits: [subject.pre],
      });
      const replies = yield* drainWitnessCues(runtime, witness, runtime.cues);
      assertEquals([signatures, sent, replies.length, runtime.cues.length, runtime.querying.hasPendingWork()], [
        1,
        1,
        0,
        0,
        false,
      ]);
    } finally {
      witness.query = query;
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
