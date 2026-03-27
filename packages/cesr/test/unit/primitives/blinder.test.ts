import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Blinder, isBlinderCode, parseBlinder } from "../../../src/primitives/blinder.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("blinder: parses blinded-state group", () => {
  const ims = `${counterV2(CtrDexV2.BlindedStateQuadruples, 1)}${token("B")}${token("E")}${token("D")}${token("M")}`;
  const blinder = parseBlinder(txt(ims), V2, "txt");
  assertEquals(blinder instanceof Blinder, true);
  assertEquals(blinder.code, CtrDexV2.BlindedStateQuadruples);
  assertEquals(blinder.count, 1);
  assertEquals(blinder.items.length, 1);
  assertEquals(blinder.qb64g, ims);
});

Deno.test("blinder: hydrates KERIpy blinded-state tuple payload", () => {
  const payload = KERIPY_STRUCTOR_VECTORS.blinderBlindStatePayload;
  const ims = `${counterV2(CtrDexV2.BlindedStateQuadruples, 1)}${payload}`;
  const blinder = parseBlinder(txt(ims), V2, "txt");

  assertEquals(isBlinderCode(blinder.code), true);
  assertEquals(blinder.code, CtrDexV2.BlindedStateQuadruples);
  assertEquals(blinder.items.length, 1);
  assertEquals(blinder.qb64g, ims);
});

Deno.test("blinder: rejects non-blinder groups", () => {
  const payload = "ABCDWXYZ";
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;
  assertThrows(() => parseBlinder(txt(ims), V2, "txt"), UnknownCodeError);
});
