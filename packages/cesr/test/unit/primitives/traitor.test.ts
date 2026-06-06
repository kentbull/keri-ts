import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseTraitor } from "../../../src/primitives/traitor.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("traitor: parses KERIpy trait vector", () => {
  const traitor = parseTraitor(txt(KERIPY_MATTER_VECTORS.traitorEO), "txt");
  assertEquals(traitor.qb64, KERIPY_MATTER_VECTORS.traitorEO);
  assertEquals(traitor.trait, "EO");
});

Deno.test("traitor: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.traitorEO,
    parseTraitor,
  );
  assertEquals(txtValue.trait, bnyValue.trait);
});

Deno.test("traitor: rejects invalid trait tags", () => {
  assertThrows(
    () => parseTraitor(txt("0Kzz"), "txt"),
    UnknownCodeError,
  );
});
