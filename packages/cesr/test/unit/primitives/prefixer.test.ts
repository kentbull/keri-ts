import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parsePrefixer } from "../../../src/primitives/prefixer.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import {
  assertTxtBnyQb64Parity,
  txt,
} from "../../fixtures/primitive-test-helpers.ts";

Deno.test("prefixer: parses KERIpy prefix vector", () => {
  const prefixer = parsePrefixer(txt(KERIPY_MATTER_VECTORS.prefixerEd25519N), "txt");
  assertEquals(prefixer.qb64, KERIPY_MATTER_VECTORS.prefixerEd25519N);
  assertEquals(prefixer.prefix, KERIPY_MATTER_VECTORS.prefixerEd25519N);
});

Deno.test("prefixer: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.prefixerEd25519N,
    parsePrefixer,
  );
  assertEquals(txtValue.prefix, bnyValue.prefix);
});

Deno.test("prefixer: rejects non-prefix code families", () => {
  assertThrows(
    () => parsePrefixer(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
