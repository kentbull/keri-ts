import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseIlker } from "../../../src/primitives/ilker.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("ilker: parses KERIpy ilk vector", () => {
  const ilker = parseIlker(txt(KERIPY_MATTER_VECTORS.ilker), "txt");
  assertEquals(ilker.qb64, KERIPY_MATTER_VECTORS.ilker);
  assertEquals(ilker.ilk, "icp");
});

Deno.test("ilker: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.ilker,
    parseIlker,
  );
  assertEquals(txtValue.ilk, bnyValue.ilk);
});

Deno.test("ilker: rejects non-ilk tag codes", () => {
  assertThrows(
    () => parseIlker(txt(KERIPY_MATTER_VECTORS.traitorEO), "txt"),
    UnknownCodeError,
  );
});
