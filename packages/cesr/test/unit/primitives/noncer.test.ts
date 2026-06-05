import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseNoncer } from "../../../src/primitives/noncer.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import {
  assertTxtBnyQb64Parity,
  txt,
} from "../../fixtures/primitive-test-helpers.ts";

Deno.test("noncer: parses KERIpy nonce vectors", () => {
  const noncer = parseNoncer(txt(KERIPY_MATTER_VECTORS.noncerSalt128), "txt");
  assertEquals(noncer.qb64, KERIPY_MATTER_VECTORS.noncerSalt128);
  assertEquals(noncer.nonce, KERIPY_MATTER_VECTORS.noncerSalt128);

  const empty = parseNoncer(txt("1AAP"), "txt");
  assertEquals(empty.nonce, "");
  assertEquals(empty.nonceb.length, 0);
});

Deno.test("noncer: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.noncerSalt128,
    parseNoncer,
  );
  assertEquals(txtValue.nonce, bnyValue.nonce);
});

Deno.test("noncer: rejects non-nonce code families", () => {
  assertThrows(
    () => parseNoncer(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
