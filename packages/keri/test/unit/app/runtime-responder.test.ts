import { call, type Operation, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { Respondant } from "../../../src/app/respondant.ts";
import { processWitnessIngress, processWitnessIngressSource } from "../../../src/app/witnessing.ts";
import type { CueEmission } from "../../../src/core/cues.ts";
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
