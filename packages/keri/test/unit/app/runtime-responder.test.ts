import { ResourceAdmissionError } from "cesr-ts";
import { call, type Operation, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { Respondant } from "../../../src/app/respondant.ts";
import { processWitnessIngress, processWitnessIngressSource } from "../../../src/app/witnessing.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import type { CueEmission } from "../../../src/core/cues.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("app/runtime-responder - receipt, witness, reply, and replay cues forward through poster instead of mailbox storage", async () => {
  const posterCalls: Array<{
    hab: string;
    recipient: string;
    topic: string;
    message: Uint8Array;
  }> = [];
  const retained: CueEmission["cue"][] = [];
  const sourceHab = { pre: "EWIT" };
  const responder = new Respondant(
    {
      habs: new Map([["EWIT", sourceHab]]),
    } as never,
    {
      poster: {
        *sendBytes(
          hab: { pre: string },
          args: {
            recipient: string;
            topic?: string;
            message: Uint8Array;
          },
        ) {
          posterCalls.push({
            hab: hab.pre,
            recipient: args.recipient,
            topic: args.topic ?? "",
            message: args.message,
          });
        },
      } as never,
      mailboxDirector: {
        retainQueryCue(cue: CueEmission["cue"]) {
          retained.push(cue);
        },
      } as never,
    },
  );

  const cases: Array<{
    emission: CueEmission;
    recipient: string;
    topic: string;
    message: Uint8Array;
  }> = [
    {
      emission: {
        kind: "wire",
        cue: { kin: "receipt", serder: { pre: "EDEST" } as never },
        messages: [new Uint8Array([1])],
      },
      recipient: "EDEST",
      topic: "/receipt",
      message: new Uint8Array([1]),
    },
    {
      emission: {
        kind: "wire",
        cue: { kin: "witness", serder: { pre: "EDEST" } as never },
        messages: [new Uint8Array([2])],
      },
      recipient: "EDEST",
      topic: "/receipt",
      message: new Uint8Array([2]),
    },
    {
      emission: {
        kind: "wire",
        cue: { kin: "reply", route: "/ksn", src: "EWIT", dest: "EDEST" },
        messages: [new Uint8Array([3])],
      },
      recipient: "EDEST",
      topic: "/reply",
      message: new Uint8Array([3]),
    },
    {
      emission: {
        kind: "wire",
        cue: {
          kin: "replay",
          src: "EWIT",
          dest: "EDEST",
          messages: [new Uint8Array([4])],
        },
        messages: [new Uint8Array([4])],
      },
      recipient: "EDEST",
      topic: "/replay",
      message: new Uint8Array([4]),
    },
  ];

  for (const current of cases) {
    await run(function*() {
      yield* responder.sendWithHab(current.emission, sourceHab as never);
    });
  }

  assertEquals(retained, []);
  assertEquals(posterCalls, [
    {
      hab: "EWIT",
      recipient: "EDEST",
      topic: "/receipt",
      message: new Uint8Array([1]),
    },
    {
      hab: "EWIT",
      recipient: "EDEST",
      topic: "/receipt",
      message: new Uint8Array([2]),
    },
    {
      hab: "EWIT",
      recipient: "EDEST",
      topic: "/reply",
      message: new Uint8Array([3]),
    },
    {
      hab: "EWIT",
      recipient: "EDEST",
      topic: "/replay",
      message: new Uint8Array([4]),
    },
  ]);
});

Deno.test("app/runtime-responder - stream cues stay with mailbox query correlation instead of poster delivery", async () => {
  const posterCalls: CueEmission[] = [];
  const retained: CueEmission["cue"][] = [];
  const responder = new Respondant(
    {
      habs: new Map(),
    } as never,
    {
      poster: {
        *sendBytes() {
          posterCalls.push({} as CueEmission);
        },
      } as never,
      mailboxDirector: {
        retainQueryCue(cue: CueEmission["cue"]) {
          retained.push(cue);
        },
      } as never,
    },
  );
  const cue: CueEmission["cue"] = {
    kin: "stream",
    serder: {} as never,
    pre: "EDEST",
    src: "EWIT",
    topics: { "/reply": 0 },
  };

  await run(function*() {
    yield* responder.sendWithHab({
      kind: "transport",
      cue,
      messages: [],
    });
  });

  assertEquals(posterCalls, []);
  assertEquals(retained, [cue]);
});

Deno.test("app/runtime-responder - witness ingress drains through responder instead of mailbox-local side effects", async () => {
  const chunks: Array<{ bytes: Uint8Array; local: boolean }> = [];
  const handled: Array<{ emission: CueEmission; hab: string }> = [];
  const emission: CueEmission = {
    kind: "wire",
    cue: { kin: "witness", serder: { pre: "EDEST" } as never },
    messages: [new Uint8Array([7])],
  };
  const serviceHab = {
    pre: "EWIT",
    processCuesIter() {
      return [emission][Symbol.iterator]();
    },
  };
  const runtime = {
    cues: [],
    reactor: {
      *process(
        source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
        { local }: { local?: boolean },
        consume: () => Operation<void>,
      ) {
        // The transport fixture records one bounded input and then exercises the real cue consumer.
        const iterator = source(new AbortController().signal)[Symbol.asyncIterator]();
        const chunk = yield* call(() => iterator.next());
        chunks.push({ bytes: chunk.value!, local: local ?? false });
        yield* call(() => iterator.return?.());
        yield* consume();
      },
    },
    respondant: {
      *sendWithHab(current: CueEmission, hab: { pre: string }) {
        handled.push({ emission: current, hab: hab.pre });
      },
    },
    hby: {
      habs: new Map([["EWIT", serviceHab]]),
    },
  };
  const bytes = new Uint8Array([9, 9, 9]);

  const emissions = await run(function*() {
    return yield* processWitnessIngress(
      runtime as never,
      serviceHab as never,
      bytes,
      { local: true },
    );
  });

  assertEquals(emissions, [emission]);
  assertEquals(chunks, [{ bytes, local: true }]);
  assertEquals(handled, [{ emission, hab: "EWIT" }]);
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

      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      try {
        ingestKeriBytes(
          runtime,
          witness.makeLocScheme("http://127.0.0.1:9137", witness.pre, "http"),
        );
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        const message = new Uint8Array([8, 8, 8]);
        yield* runtime.respondant.sendWithHab(
          {
            kind: "wire",
            cue: { kin: "receipt", serder: { pre: recipient.pre } as never },
            messages: [message],
          },
          witness,
        );

        const stored = runtime.mailboxer?.getTopicMsgs(
          mailboxTopicKey(recipient.pre, "/receipt"),
        ) ?? [];
        assertEquals(stored, [message]);
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
      const runtime = yield* createAgentRuntime(provider, { mode: "indirect" });
      const seen = Promise.withResolvers<void>(), returning = Promise.withResolvers<void>();
      const cleanup = Promise.withResolvers<void>();
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
        yield* call(() => returning.promise);
        assertEquals(halted, false);
        assertEquals(runtime.resources.used.streams, 1, "source cleanup retains parser admission");
        cleanup.resolve();
        yield* call(() => halt);
        assertEquals(continued, false);
        assertEquals(runtime.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
        assertEquals(provider.db.getKever(controller.pre)?.sn, 0, "cancelled input cannot deliver its later event");
        const finite = yield* processWitnessIngress(runtime, witness, later, { local: true, deliver: false });
        assertEquals(finite.filter((emission) => emission.cue.kin === "witness").length, 1);
        assertEquals(provider.db.getKever(controller.pre)?.sn, 1);
      } finally {
        clearTimeout(timeout);
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

Deno.test("runtime Respondant admission keeps saturated cues and progresses signed ingress during paused HTTP delivery", async () => {
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
          route: "/loc/scheme",
          data: { eid: sender.pre, scheme: "http", url: "http://sender.test/" },
        };
        runtime.cues.push(cue);
        const interpretation = sender.interpretCue;
        let interpreted = 0;
        sender.interpretCue = (input) => {
          interpreted++;
          return interpretation.call(sender, input);
        };
        const queued = {
          url: "https://query.test/",
          body: new Uint8Array(),
          bodyMode: "header" as const,
          destination: sender.pre,
        };
        for (let index = 0; index < 8; index++) runtime.deliveries.enqueue(() => queued);
        runtime.querying.configure({ hab: sender, sink: runtime.respondant.forHab(sender) });
        yield* processCuesOnce(runtime, { hab: sender, sink: runtime.querying });
        assertStrictEquals(runtime.cues.peekHead(), cue);
        assertEquals([interpreted, runtime.deliveries.hasPending], [0, true]);
        // Dispose only this saturated fixture's query owners, then use a fresh owned runtime for actual delivery.
        yield* runtime.close();
        const active = yield* createAgentRuntime(hby, { mode: "local" });
        active.cues.push(cue);
        const sink = active.respondant.forHab(sender);
        if (!(active.cues instanceof CueDeck)) throw new Error("Expected admitted runtime source");
        const queuedBytes = active.cues.headRetentionBytes();
        assertEquals(active.resources.used.bytes, queuedBytes, "only this source's queued owner is live");
        const occupied = active.resources.reserve({
          bytes: active.resources.limits.bytes - active.resources.used.bytes,
        });
        if (occupied.kind !== "reserve") throw new Error("Expected free byte capacity");
        yield* processCuesOnce(active, { hab: sender, sink });
        assertStrictEquals(active.cues.peekHead(), cue, "own byte refusal cannot destructively fall back");
        const observerFailure = new Error("cue refusal observer failed");
        assertStrictEquals(
          assertThrows(() =>
            active.deliveries.enqueueCue(
              sender,
              active.cues,
              () => {
                throw new Error("Unadmitted route resolution");
              },
              sender,
              () => {
                throw observerFailure;
              },
            )
          ),
          observerFailure,
        );
        assertStrictEquals(active.cues.peekHead(), cue);
        occupied.reservation.release();
        const foreign = new ResourceAdmissionError("foreign cue preparation busy", "busy");
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
              yield* call(() => assertRejects(() => run(() => processCuesOnce(active, { hab: sender, sink })))),
              foreign,
            );
            assertStrictEquals(active.cues.peekHead(), cue);
            assertEquals(active.resources.used.bytes, queuedBytes, "foreign failure returns only unpublished credit");
          } finally {
            sender.interpretCue = interpretation;
            active.poster.findBytesRoute = resolve;
          }
        }
        let returned = false;
        const sending = yield* spawn(function*() {
          yield* processRuntimeTurn(active, {
            hab: sender,
            sink: active.respondant.forHab(sender),
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
          assertEquals(active.deliveries.hasPending, true);
          release();
          yield* accepting;
          yield* sending;
          yield* active.deliveries.process(active);
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
          assertEquals(active.resources.used.bytes, 0);
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
