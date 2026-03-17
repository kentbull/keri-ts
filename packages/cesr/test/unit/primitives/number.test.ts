import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseNumber } from "../../../src/primitives/number.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("number: parses KERIpy Short number vector", () => {
  const number = parseNumber(txt(KERIPY_MATTER_VECTORS.numberShort), "txt");
  assertEquals(number.code, "M");
  assertEquals(number.qb64, KERIPY_MATTER_VECTORS.numberShort);
  assertEquals(number.numh.length > 0, true);
});

Deno.test("number: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.numberShort,
    parseNumber,
  );
  assertEquals(txtValue.numh, bnyValue.numh);
});

Deno.test("number: rejects non-number codes", () => {
  assertThrows(
    () => parseNumber(txt(KERIPY_MATTER_VECTORS.ilker), "txt"),
    UnknownCodeError,
  );
});
