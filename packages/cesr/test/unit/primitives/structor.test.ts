import { assertEquals, assertThrows } from "jsr:@std/assert";
import { codeB64ToB2 } from "../../../src/core/bytes.ts";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseStructor, Structor } from "../../../src/primitives/structor.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2 } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("structor: hydrates generic list group as class instance", () => {
  const payload = "ABCDWXYZ";
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;

  const structor = parseStructor(txt(ims), V2, "txt");
  assertEquals(structor instanceof Structor, true);
  assertEquals(structor.code, CtrDexV2.GenericListGroup);
  assertEquals(structor.count, payload.length / 4);
  assertEquals(structor.items.length, 2);
  assertEquals(structor.qb64g, ims);
});

Deno.test("structor: fromGroup preserves clan semantics", () => {
  const payload = "ABCDWXYZ";
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;
  const parsed = parseStructor(txt(ims), V2, "txt");

  const rebuilt = Structor.fromGroup(parsed);
  assertEquals(rebuilt.clan, parsed.name);
  assertEquals(rebuilt.qb64g, parsed.qb64g);
});

Deno.test("structor: parses KERIpy-derived payload and supports equality checks", () => {
  const payload = KERIPY_STRUCTOR_VECTORS.mediarTypedMediaPayload;
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;

  const left = parseStructor(txt(ims), V2, "txt");
  const right = Structor.fromGroup(left);

  assertEquals(left.qb64g, ims);
  assertEquals(left.equalsStructor(right), true);
});

Deno.test("structor: bny parse preserves qb2/qb64 group projections", () => {
  const payload = KERIPY_STRUCTOR_VECTORS.sealerTypedDigestPayload;
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;
  const qb2 = codeB64ToB2(ims);

  const structor = parseStructor(qb2, V2, "bny");
  assertEquals(structor.qb64g, ims);
  assertEquals(structor.qb2g, qb2);
  assertEquals(structor.consumed, qb2.length);
});

Deno.test("structor: allowed-code guard rejects mismatched families", () => {
  const payload = "ABCD";
  const ims = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;

  assertThrows(
    () =>
      parseStructor(
        txt(ims),
        V2,
        "txt",
        new Set([CtrDexV2.SealSourceCouples]),
        "sealer",
      ),
    UnknownCodeError,
  );
});
