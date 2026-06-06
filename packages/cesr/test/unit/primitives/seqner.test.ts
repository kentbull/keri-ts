import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseSeqner } from "../../../src/primitives/seqner.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("seqner: parses KERIpy sequence vectors", () => {
  const zero = parseSeqner(txt(KERIPY_MATTER_VECTORS.seqnerZero), "txt");
  const five = parseSeqner(txt(KERIPY_MATTER_VECTORS.seqnerFive), "txt");

  assertEquals(zero.sn, 0n);
  assertEquals(five.sn, 5n);
  assertEquals(five.qb64, KERIPY_MATTER_VECTORS.seqnerFive);
});

Deno.test("seqner: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.seqnerFive,
    parseSeqner,
  );
  assertEquals(txtValue.snh, bnyValue.snh);
});

Deno.test("seqner: rejects non-seqner codes", () => {
  assertThrows(
    () => parseSeqner(txt(KERIPY_MATTER_VECTORS.numberShort), "txt"),
    UnknownCodeError,
  );
});
