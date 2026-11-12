/** A group command signs only the proposal it was asked to sign; a proposer's wait signs nothing. */
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { findGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import { proposeGroupInteraction } from "../../../../src/app/multisig/proposing.ts";
import { waitForAcceptance } from "../../../../src/cli/messaging/group-wait.ts";
import { peerInteraction, readDeps, type Scenario, scenario } from "../multisig/proposal-fixture.ts";

/** Count the group event contributions the local member signs. */
function countSigns(s: Scenario) {
  const counts = { signs: 0 };
  const sign = s.alice.mgr.sign.bind(s.alice.mgr);
  s.alice.mgr.sign = ((...args: Parameters<typeof sign>) => {
    if ((args[1] as { indices?: number[] } | undefined)?.indices) counts.signs++;
    return sign(...args);
  }) as typeof sign;
  s.runtime.postman.send = evt => ({ ...evt, kin: "msg" });
  return counts;
}

Deno.test("a proposer waiting for its event never signs another stored proposal", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = countSigns(s);
      const unrelated = yield* peerInteraction(s, [{ n: "peer" }]);
      const group = s.left.habByName("group")!;
      const sent = yield* proposeGroupInteraction(
        { hby: s.left, protocol: s.runtime.protocol, postman: s.runtime.postman, counselor: s.runtime.counselor },
        group,
        [{ n: "mine" }],
        { fallbackAfterMs: 0 },
      );
      assertEquals(counts.signs, 1, "only the proposer's own event is signed");
      const accepted = yield* waitForAcceptance(s.left, s.runtime, sent.event, Date.now() + 300);
      assertEquals(accepted, false, "the second member never signed");
      assertEquals(counts.signs, 1);
      assertEquals(findGroupProposal(readDeps(s), unrelated.signed.exnSaid)?.local, "unapproved");
    }, "2");
  });
});
