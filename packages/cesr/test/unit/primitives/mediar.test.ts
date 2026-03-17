import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { isMediarCode, Mediar, parseMediar } from "../../../src/primitives/mediar.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("mediar: parses typed-media group", () => {
  const ims = `${counterV2(CtrDexV2.TypedMediaQuadruples, 1)}${token("B")}${token("E")}${
    token("D")
  }${token("M")}`;
  const mediar = parseMediar(txt(ims), V2, "txt");
  assertEquals(mediar instanceof Mediar, true);
  assertEquals(mediar.code, CtrDexV2.TypedMediaQuadruples);
  assertEquals(mediar.count, 1);
  assertEquals(mediar.items.length, 1);
  assertEquals(mediar.qb64g, ims);
});

Deno.test("mediar: hydrates KERIpy typed-media tuple payload", () => {
  const payload = KERIPY_STRUCTOR_VECTORS.mediarTypedMediaPayload;
  const ims = `${counterV2(CtrDexV2.TypedMediaQuadruples, 1)}${payload}`;
  const mediar = parseMediar(txt(ims), V2, "txt");

  assertEquals(isMediarCode(mediar.code), true);
  assertEquals(mediar.code, CtrDexV2.TypedMediaQuadruples);
  assertEquals(mediar.items.length, 1);
  assertEquals(mediar.qb64g, ims);
});

Deno.test("mediar: rejects non-mediar groups", () => {
  const payload = "ABCDWXYZ";
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;
  assertThrows(() => parseMediar(txt(ims), V2, "txt"), UnknownCodeError);
});
