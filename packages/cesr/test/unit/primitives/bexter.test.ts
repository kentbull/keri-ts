import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Bexter, parseBexter } from "../../../src/primitives/bexter.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import {
  assertTxtBnyQb64Parity,
  txt,
} from "../../fixtures/primitive-test-helpers.ts";

Deno.test("bexter: parses KERIpy strb64 vector", () => {
  const bexter = parseBexter(txt(KERIPY_MATTER_VECTORS.bexterSimple), "txt");
  assertEquals(bexter.qb64, KERIPY_MATTER_VECTORS.bexterSimple);
  assertEquals(bexter.bext.length > 0, true);
});

Deno.test("bexter: rawify/derawify roundtrip", () => {
  const bext = "bcd";
  const raw = Bexter.rawify(bext);
  const rebuilt = Bexter.derawify(raw, "4A");
  assertEquals(rebuilt, bext);
});

Deno.test("bexter: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.bexterSimple,
    parseBexter,
  );
  assertEquals(txtValue.bext, bnyValue.bext);
});

Deno.test("bexter: rejects non-strb64 code families", () => {
  assertThrows(
    () => parseBexter(txt(KERIPY_MATTER_VECTORS.texterSimple), "txt"),
    UnknownCodeError,
  );
});
