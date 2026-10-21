import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../../src/core/errors.ts";
import { Dater, parseDater } from "../../../../src/primitives/values/dater.ts";
import { KERIPY_MATTER_VECTORS } from "../../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../../fixtures/primitive-test-helpers.ts";

Deno.test("dater: parses KERIpy datetime vector", () => {
  const dater = parseDater(txt(KERIPY_MATTER_VECTORS.daterSample), "txt");
  assertEquals(dater.qb64, KERIPY_MATTER_VECTORS.daterSample);
  assertEquals(dater.dts.includes(":"), true);
  assertEquals(dater.dts.includes("."), true);
});

Deno.test("dater: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.daterSample,
    parseDater,
  );
  assertEquals(txtValue.dts, bnyValue.dts);
});

Deno.test("dater: rejects non-datetime codes", () => {
  assertThrows(
    () => parseDater(txt(KERIPY_MATTER_VECTORS.numberShort), "txt"),
    UnknownCodeError,
  );
});

Deno.test("dater: explicit datetime construction preserves offsets and encoded-input precedence", () => {
  const dts = "2026-10-13T01:02:03.123456-06:00";
  const dater = new Dater({ dts });
  assertEquals(dater.dts, dts);
  assertEquals(new Dater({ qb64: dater.qb64, dts: "ignored" }).dts, dts);
  assertEquals(new Dater({ raw: dater.raw, code: dater.code, dts: "ignored" }).dts, dts);
  assertThrows(() => new Dater({ dts: "short" }));
});
