import { assertEquals } from "jsr:@std/assert";
import { deriveRotatedWitnessSet, hasUniqueWitnesses } from "../../../src/core/witnesses.ts";

Deno.test("core/witnesses - deriveRotatedWitnessSet preserves ordered cuts and adds", () => {
  const derived = deriveRotatedWitnessSet(
    ["wit-a", "wit-b"],
    ["wit-a"],
    ["wit-c"],
  );

  assertEquals(derived, {
    wits: ["wit-b", "wit-c"],
    cuts: ["wit-a"],
    adds: ["wit-c"],
  });
});

Deno.test("core/witnesses - deriveRotatedWitnessSet rejects duplicate and intersecting witness data", () => {
  assertEquals(hasUniqueWitnesses(["wit-a", "wit-b"]), true);
  assertEquals(hasUniqueWitnesses(["wit-a", "wit-a"]), false);
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], ["wit-a", "wit-a"], []),
    null,
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], [], ["wit-b", "wit-b"]),
    null,
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], ["wit-a"], ["wit-a"]),
    null,
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], [], ["wit-a"]),
    null,
  );
  assertEquals(
    deriveRotatedWitnessSet(["wit-a"], ["wit-b"], []),
    null,
  );
});
