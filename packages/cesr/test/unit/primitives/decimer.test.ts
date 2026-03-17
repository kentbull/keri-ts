import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Decimer, parseDecimer } from "../../../src/primitives/decimer.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("decimer: parses KERIpy decimal vectors", () => {
  const d0 = parseDecimer(txt(KERIPY_MATTER_VECTORS.decimerZeroInt), "txt");
  const d1 = parseDecimer(
    txt(KERIPY_MATTER_VECTORS.decimerFloat123456789),
    "txt",
  );

  assertEquals(d0.qb64, KERIPY_MATTER_VECTORS.decimerZeroInt);
  assertEquals(d0.dns, "0");
  assertEquals(d1.qb64, KERIPY_MATTER_VECTORS.decimerFloat123456789);
  assertEquals(d1.decimal > 12, true);
});

Deno.test("decimer: constructor decimal input matches KERIpy vector", () => {
  const decimer = new Decimer({ dns: "12.3456789", code: "5H" });
  assertEquals(decimer.qb64, KERIPY_MATTER_VECTORS.decimerFloat123456789);
});

Deno.test("decimer: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.decimerZeroFloat,
    parseDecimer,
  );
  assertEquals(txtValue.dns, bnyValue.dns);
});

Deno.test("decimer: rejects non-decimal code families", () => {
  assertThrows(
    () => parseDecimer(txt(KERIPY_MATTER_VECTORS.ilker), "txt"),
    UnknownCodeError,
  );
});
