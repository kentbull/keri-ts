import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseDiger } from "../../../src/primitives/diger.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("diger: parses KERIpy digest vector", () => {
  const diger = parseDiger(txt(KERIPY_MATTER_VECTORS.digerBlake3), "txt");
  assertEquals(diger.qb64, KERIPY_MATTER_VECTORS.digerBlake3);
  assertEquals(diger.digest.length > 0, true);
  assertEquals(diger.algorithm.includes("Blake"), true);
});

Deno.test("diger: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.digerBlake3,
    parseDiger,
  );
  assertEquals(txtValue.algorithm, bnyValue.algorithm);
});

Deno.test("diger: rejects non-digest code families", () => {
  assertThrows(
    () => parseDiger(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
