import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Cigar } from "../../../src/primitives/cigar.ts";
import { MtrDex } from "../../../src/primitives/codex.ts";
import { publicKeyForSignerCode, signRawForSignerCode } from "../../../src/primitives/signature-suite.ts";
import { parseVerfer, Verfer } from "../../../src/primitives/verfer.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("verfer: parses KERIpy verifier vector", () => {
  const verfer = parseVerfer(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt");
  assertEquals(verfer.qb64, KERIPY_MATTER_VECTORS.verferEcdsaR1);
  assertEquals(verfer.key.length > 0, true);
  assertEquals(verfer.algorithm.includes("ECDSA_256r1"), true);
});

Deno.test("verfer: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.verferEcdsaR1,
    parseVerfer,
  );
  assertEquals(txtValue.algorithm, bnyValue.algorithm);
});

Deno.test("verfer: rejects non-verifier code families", () => {
  assertThrows(
    () => parseVerfer(txt(KERIPY_MATTER_VECTORS.digerBlake3), "txt"),
    UnknownCodeError,
  );
});

Deno.test("verfer: verifies signatures via the verifier-implied crypto suite", () => {
  const message = txt("abc");
  const wrongMessage = txt("abd");
  const edSeed = new Uint8Array(32).fill(7);
  const cases = [
    {
      name: "Ed25519",
      verfer: new Verfer({
        code: MtrDex.Ed25519,
        raw: publicKeyForSignerCode(MtrDex.Ed25519_Seed, edSeed),
      }),
      sig: signRawForSignerCode(MtrDex.Ed25519_Seed, edSeed, message),
    },
    {
      name: "ECDSA_256k1",
      verfer: new Verfer({ qb64: KERIPY_MATTER_VECTORS.verferEcdsaK1 }),
      sig: new Cigar({ qb64: KERIPY_MATTER_VECTORS.cigarEcdsaK1 }).raw,
    },
    {
      name: "ECDSA_256r1",
      verfer: new Verfer({ qb64: KERIPY_MATTER_VECTORS.verferEcdsaR1Vector }),
      sig: new Cigar({ qb64: KERIPY_MATTER_VECTORS.cigarEcdsaR1 }).raw,
    },
  ];

  for (const testCase of cases) {
    assertEquals(testCase.verfer.verify(testCase.sig, message), true, testCase.name);
    assertEquals(
      testCase.verfer.verify(testCase.sig, wrongMessage),
      false,
      `${testCase.name} rejects wrong message`,
    );
  }
});
