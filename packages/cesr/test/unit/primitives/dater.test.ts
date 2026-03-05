import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseDater } from "../../../src/primitives/dater.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import {
  assertTxtBnyQb64Parity,
  txt,
} from "../../fixtures/primitive-test-helpers.ts";

Deno.test("dater: parses KERIpy datetime vector", () => {
  const dater = parseDater(txt(KERIPY_MATTER_VECTORS.daterSample), "txt");
  assertEquals(dater.qb64, KERIPY_MATTER_VECTORS.daterSample);
  assertEquals(dater.iso8601.includes(":"), true);
  assertEquals(dater.iso8601.includes("."), true);
});

Deno.test("dater: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.daterSample,
    parseDater,
  );
  assertEquals(txtValue.iso8601, bnyValue.iso8601);
});

Deno.test("dater: rejects non-datetime codes", () => {
  assertThrows(
    () => parseDater(txt(KERIPY_MATTER_VECTORS.numberShort), "txt"),
    UnknownCodeError,
  );
});
