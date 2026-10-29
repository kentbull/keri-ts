/** Application policy boundaries, independent of protocol signature processing. */
import { assertEquals } from "jsr:@std/assert";
import { replicationTargets } from "../mod.ts";

Deno.test("only the accepted rotation's elected lead selects newcomers", () => {
  const rotation = {
    accepted: true,
    previousSigningMembers: ["old-lead", "continuing", "other"],
    signingMembers: ["continuing", "new-member", "other"],
  };
  assertEquals(replicationTargets(rotation, "continuing"), ["new-member"]);
  assertEquals(replicationTargets(rotation, "old-lead"), []);
  assertEquals(replicationTargets(rotation, "other"), []);
  assertEquals(replicationTargets({ ...rotation, accepted: false }, "continuing"), []);
});

Deno.test("reordering or threshold-only rotation does not redistribute existing salts", () => {
  assertEquals(
    replicationTargets({
      accepted: true,
      previousSigningMembers: ["a", "b", "c"],
      signingMembers: ["b", "a", "c"],
    }, "b"),
    [],
  );
});
