import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseSaider } from "../../../src/primitives/saider.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import {
  assertTxtBnyQb64Parity,
  txt,
} from "../../fixtures/primitive-test-helpers.ts";

Deno.test("saider: parses KERIpy SAID vector", () => {
  const saider = parseSaider(txt(KERIPY_MATTER_VECTORS.saiderAcdc), "txt");
  assertEquals(saider.qb64, KERIPY_MATTER_VECTORS.saiderAcdc);
  assertEquals(saider.said, KERIPY_MATTER_VECTORS.saiderAcdc);
  assertEquals(saider.digest.length > 0, true);
});

Deno.test("saider: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.saiderAcdc,
    parseSaider,
  );
  assertEquals(txtValue.said, bnyValue.said);
});

Deno.test("saider: rejects non-digest code families", () => {
  assertThrows(
    () => parseSaider(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
