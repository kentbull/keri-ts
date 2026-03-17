import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parsePather } from "../../../src/primitives/pather.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("pather: parses KERIpy path vector", () => {
  const pather = parsePather(txt(KERIPY_MATTER_VECTORS.patherSimple), "txt");
  assertEquals(pather.qb64, KERIPY_MATTER_VECTORS.patherSimple);
  assertEquals(pather.path.length > 0, true);
});

Deno.test("pather: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.patherSimple,
    parsePather,
  );
  assertEquals(txtValue.path, bnyValue.path);
});

Deno.test("pather: rejects non-path code families", () => {
  assertThrows(
    () => parsePather(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
