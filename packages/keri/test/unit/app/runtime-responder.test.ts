// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
} from "../../../src/app/agent-runtime.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { Respondant } from "../../../src/app/respondant.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { processWitnessIngress } from "../../../src/app/witnessing.ts";
import type { CueEmission } from "../../../src/core/cues.ts";

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
        msgs: [new Uint8Array([1])],
      },
      recipient: "EDEST",
      topic: "/receipt",
      message: new Uint8Array([1]),
    },
    {
      emission: {
        kind: "wire",
        cue: { kin: "witness", serder: { pre: "EDEST" } as never },
        msgs: [new Uint8Array([2])],
      },
      recipient: "EDEST",
      topic: "/receipt",
      message: new Uint8Array([2]),
    },
    {
      emission: {
        kind: "wire",
        cue: { kin: "reply", route: "/ksn", src: "EWIT", dest: "EDEST" },
        msgs: [new Uint8Array([3])],
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
          msgs: new Uint8Array([4]),
        },
        msgs: [new Uint8Array([4])],
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
      msgs: [],
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
    msgs: [new Uint8Array([7])],
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
      processChunk(bytes: Uint8Array, { local }: { local?: boolean } = {}) {
        chunks.push({ bytes, local: local ?? false });
      },
      processEscrowsOnce() {
        return;
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
            msgs: [message],
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
