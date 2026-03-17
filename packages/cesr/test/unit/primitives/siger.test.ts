import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseSiger } from "../../../src/primitives/siger.ts";
import { KERIPY_INDEXER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("siger: parses KERIpy siger vector", () => {
  const siger = parseSiger(txt(KERIPY_INDEXER_VECTORS.sigerSample), "txt");
  assertEquals(siger.qb64, KERIPY_INDEXER_VECTORS.sigerSample);
  assertEquals(siger.verfer, undefined);
});

Deno.test("siger: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_INDEXER_VECTORS.sigerSample,
    parseSiger,
  );
  assertEquals(txtValue.index, bnyValue.index);
});

Deno.test("siger: rejects non-signature indexer families", () => {
  assertThrows(
    () => parseSiger(txt(KERIPY_INDEXER_VECTORS.tbd0Label), "txt"),
    UnknownCodeError,
  );
});
