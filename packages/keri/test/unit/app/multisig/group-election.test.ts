/** Group election over real member and group KELs, as KERIpy `GroupHab.elected`. */
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { groupElectedMember } from "../../../../src/app/multisig/group-members.ts";
import { rotate, world } from "../../../support/registry-root-world.ts";

Deno.test("group election: the lowest verified signer is elected, even when index 0 did not sign", async () => {
  await run(function*() {
    const w = yield* world();
    const inception = { sn: 0, said: w.gid };
    for (const side of [w.alice, w.bob]) assertEquals(groupElectedMember(side.hby, w.gid, inception), w.alice.hab.pre);

    // Alice (index 0) withholds; Bob alone satisfies the 1-of-2 rotation at index 1.
    const said = yield* rotate(w, [w.alice, w.bob], [w.alice, w.bob], "1", [w.alice]);
    assertEquals(groupElectedMember(w.bob.hby, w.gid, { sn: 1, said }), w.bob.hab.pre);
    assertEquals(groupElectedMember(w.bob.hby, w.gid, { sn: 1, said: w.gid }), null, "mismatched event");
    assertEquals(groupElectedMember(w.issuer.hby, w.gid, { sn: 1, said }), null, "no local signing members");
  });
});
