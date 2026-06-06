import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseTagger } from "../../../src/primitives/tagger.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("tagger: parses KERIpy tag vectors", () => {
  const tagger = parseTagger(txt(KERIPY_MATTER_VECTORS.taggerSimple), "txt");
  assertEquals(tagger.qb64, KERIPY_MATTER_VECTORS.taggerSimple);
  assertEquals(tagger.tag, "z");
});

Deno.test("tagger: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.taggerSimple,
    parseTagger,
  );
  assertEquals(txtValue.tag, bnyValue.tag);
});

Deno.test("tagger: rejects non-tag codex entries", () => {
  assertThrows(
    () => parseTagger(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});
