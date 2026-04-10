// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import type { CueEmission } from "keri-ts/runtime";
import { drainRuntimeCues } from "../src/http/protocol/runtime-bridge.ts";

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
    respondant: {
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
