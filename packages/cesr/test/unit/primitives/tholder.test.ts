import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseTholder } from "../../../src/primitives/tholder.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("tholder: parses KERIpy numeric threshold vector", () => {
  const tholder = parseTholder(txt(KERIPY_MATTER_VECTORS.numberShort), "txt");
  assertEquals(tholder.qb64, KERIPY_MATTER_VECTORS.numberShort);
  assertEquals(tholder.sith.length > 0, true);
});

Deno.test("tholder: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.numberShort,
    parseTholder,
  );
  assertEquals(txtValue.sith, bnyValue.sith);
});

Deno.test("tholder: rejects non-threshold code families", () => {
  assertThrows(
    () => parseTholder(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
