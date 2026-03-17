import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseLabeler } from "../../../src/primitives/labeler.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("labeler: parses KERIpy label vector", () => {
  const labeler = parseLabeler(txt(KERIPY_MATTER_VECTORS.labelerI), "txt");
  assertEquals(labeler.qb64, KERIPY_MATTER_VECTORS.labelerI);
  assertEquals(labeler.label, "i");
  assertEquals(labeler.text, "i");
});

Deno.test("labeler: parses KERIpy Empty vector", () => {
  const labeler = parseLabeler(txt(KERIPY_MATTER_VECTORS.labelerEmpty), "txt");
  assertEquals(labeler.qb64, KERIPY_MATTER_VECTORS.labelerEmpty);
  assertEquals(labeler.text, "");
});

Deno.test("labeler: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.labelerI,
    parseLabeler,
  );
  assertEquals(txtValue.label, bnyValue.label);
});

Deno.test("labeler: invalid att-label projection throws", () => {
  const labeler = parseLabeler(txt("VABA"), "txt"); // from KERIpy labeler tests
  assertThrows(() => labeler.label, UnknownCodeError);
});
