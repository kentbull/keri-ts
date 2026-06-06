import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { isSealerCode, parseSealer, Sealer } from "../../../src/primitives/sealer.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("sealer: parses KERIpy-style seal group", () => {
  const ims = `${counterV2(CtrDexV2.SealSourceCouples, 1)}${token("B")}${token("E")}`;
  const sealer = parseSealer(txt(ims), V2, "txt");
  assertEquals(sealer instanceof Sealer, true);
  assertEquals(sealer.code, CtrDexV2.SealSourceCouples);
  assertEquals(sealer.count, 1);
  assertEquals(sealer.items.length, 1);
  assertEquals(sealer.qb64g, ims);
});

Deno.test("sealer: hydrates KERIpy typed-digest tuple payload", () => {
  const payload = KERIPY_STRUCTOR_VECTORS.sealerTypedDigestPayload;
  const ims = `${counterV2(CtrDexV2.TypedDigestSealCouples, 1)}${payload}`;
  const sealer = parseSealer(txt(ims), V2, "txt");

  assertEquals(isSealerCode(sealer.code), true);
  assertEquals(sealer.code, CtrDexV2.TypedDigestSealCouples);
  assertEquals(sealer.items.length, 1);
  assertEquals(sealer.qb64g, ims);
});

Deno.test("sealer: rejects non-seal groups", () => {
  const payload = "ABCDWXYZ";
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;
  assertThrows(() => parseSealer(txt(ims), V2, "txt"), UnknownCodeError);
});
