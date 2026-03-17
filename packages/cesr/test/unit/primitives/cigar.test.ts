import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseCigar } from "../../../src/primitives/cigar.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("cigar: parses KERIpy signature vector", () => {
  const cigar = parseCigar(txt(KERIPY_MATTER_VECTORS.cigarEcdsaR1), "txt");
  assertEquals(cigar.qb64, KERIPY_MATTER_VECTORS.cigarEcdsaR1);
  assertEquals(cigar.sig.length > 0, true);
  assertEquals(cigar.algorithm.endsWith("_Sig"), true);
});

Deno.test("cigar: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.cigarEcdsaR1,
    parseCigar,
  );
  assertEquals(txtValue.algorithm, bnyValue.algorithm);
});

Deno.test("cigar: rejects non-signature code families", () => {
  assertThrows(
    () => parseCigar(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
