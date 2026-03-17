import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseTexter } from "../../../src/primitives/texter.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("texter: parses KERIpy text vector", () => {
  const texter = parseTexter(txt(KERIPY_MATTER_VECTORS.texterSimple), "txt");
  assertEquals(texter.qb64, KERIPY_MATTER_VECTORS.texterSimple);
  assertEquals(texter.text.length > 0, true);
});

Deno.test("texter: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.texterSimple,
    parseTexter,
  );
  assertEquals(txtValue.text, bnyValue.text);
});

Deno.test("texter: rejects non-bytes code families", () => {
  assertThrows(
    () => parseTexter(txt(KERIPY_MATTER_VECTORS.bexterSimple), "txt"),
    UnknownCodeError,
  );
});
