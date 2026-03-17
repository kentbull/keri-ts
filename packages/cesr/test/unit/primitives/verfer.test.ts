import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseVerfer } from "../../../src/primitives/verfer.ts";
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
