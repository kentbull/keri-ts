// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import type { CueEmission } from "keri-ts/runtime";
import { drainRuntimeCues, publishQueryCatchupReplay } from "../src/http/protocol/runtime-bridge.ts";

Deno.test("tufa/runtime-bridge - replay cues are forwarded through poster instead of only local mailbox storage", async () => {
  const handled: Array<{ emission: CueEmission; hab: string }> = [];
  const emission: CueEmission = {
    kind: "wire",
    cue: {
      kin: "replay",
      src: "EWIT",
      dest: "EDEST",
      msgs: new Uint8Array([1, 2, 3]),
    },
    msgs: [new Uint8Array([1, 2, 3])],
  };
  const serviceHab = {
    pre: "EWIT",
    processCuesIter() {
      return [emission][Symbol.iterator]();
    },
  };
  const runtime = {
    hby: {
      habs: new Map([["EWIT", serviceHab]]),
    },
    cues: [],
    responder: {
      *sendWithHab(current: CueEmission, hab: { pre: string }) {
        handled.push({
          emission: current,
          hab: hab.pre,
        });
      },
    },
  };

  const emissions = await run(function*() {
    return yield* drainRuntimeCues(
      runtime as never,
      serviceHab as never,
    );
  });

  assertEquals(emissions, [emission]);
  assertEquals(handled, [{ emission, hab: "EWIT" }]);
});

Deno.test("tufa/runtime-bridge - catch-up replay uses poster delivery without mailbox-store fallback", async () => {
  const calls: Array<{
    hab: string;
    recipient: string;
    topic: string;
    message: Uint8Array;
  }> = [];
  const serviceHab = { pre: "EWIT" };
  const runtime = {
    hby: {
      habs: new Map([["EWIT", serviceHab]]),
      db: {
        getKever() {
          return null;
        },
        clonePreIter() {
          return [new Uint8Array([9, 9])][Symbol.iterator]();
        },
      },
    },
    poster: {
      *sendBytes(
        hab: { pre: string },
        args: {
          recipient: string;
          topic?: string;
          message: Uint8Array;
        },
      ) {
        calls.push({
          hab: hab.pre,
          recipient: args.recipient,
          topic: args.topic ?? "",
          message: args.message,
        });
      },
    },
  };
  const emissions: CueEmission[] = [{
    kind: "wire",
    cue: {
      kin: "reply",
      route: "/ksn",
      src: "EWIT",
      dest: "EDEST",
    },
    msgs: [new Uint8Array([7, 7])],
  }];

  await run(function*() {
    yield* publishQueryCatchupReplay(
      runtime as never,
      emissions,
      "EQUERY",
      serviceHab as never,
    );
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0], {
    hab: "EWIT",
    recipient: "EDEST",
    topic: "/replay",
    message: new Uint8Array([9, 9]),
  });
});
