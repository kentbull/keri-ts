import { assertEquals } from "jsr:@std/assert";
import { deriveRotatedWitnessSet, hasUniqueWitnesses } from "../../../src/core/witnesses.ts";

Deno.test("core/witnesses - deriveRotatedWitnessSet preserves ordered cuts and adds", () => {
  const derived = deriveRotatedWitnessSet(
    ["wit-a", "wit-b"],
    ["wit-a"],
    ["wit-c"],
  );

  assertEquals(derived, {
    kind: "accept",
    value: {
      wits: ["wit-b", "wit-c"],
      cuts: ["wit-a"],
      adds: ["wit-c"],
    },
  });
});

Deno.test("core/witnesses - deriveRotatedWitnessSet rejects duplicate and intersecting witness data", () => {
  assertEquals(hasUniqueWitnesses(["wit-a", "wit-b"]), true);
  assertEquals(hasUniqueWitnesses(["wit-a", "wit-a"]), false);
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], ["wit-a", "wit-a"], []),
    { kind: "reject", reason: "duplicateCuts" },
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], [], ["wit-b", "wit-b"]),
    { kind: "reject", reason: "duplicateAdds" },
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], ["wit-a"], ["wit-a"]),
    { kind: "reject", reason: "intersectingCutsAndAdds" },
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], [], ["wit-a"]),
    { kind: "reject", reason: "intersectingWitnessesAndAdds" },
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], ["wit-b"], []),
    { kind: "reject", reason: "cutsNotSubsetOfWitnesses" },
  );
});
