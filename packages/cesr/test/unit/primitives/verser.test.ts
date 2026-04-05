import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DeserializeError } from "../../../src/core/errors.ts";
import { parseVerser } from "../../../src/primitives/verser.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("verser: parses KERIpy KERI 2.0 vector", () => {
  const verser = parseVerser(txt(KERIPY_MATTER_VECTORS.verserKeri20), "txt");
  assertEquals(verser.qb64, KERIPY_MATTER_VECTORS.verserKeri20);
  assertEquals(verser.proto, "KERI");
  assertEquals(verser.pvrsn.major, 2);
  assertEquals(verser.pvrsn.minor, 0);
  assertEquals(verser.gvrsn, null);
});

Deno.test("verser: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.verserKeri20,
    parseVerser,
  );
  assertEquals(txtValue.proto, bnyValue.proto);
});

Deno.test("verser: accepts KERIpy structing OCSR tag", () => {
  const verser = parseVerser(txt("YOCSRCAA"), "txt");
  assertEquals(verser.qb64, "YOCSRCAA");
  assertEquals(verser.proto, "OCSR");
  assertEquals(verser.pvrsn.major, 2);
  assertEquals(verser.pvrsn.minor, 0);
});

Deno.test("verser: rejects malformed protocol tags", () => {
  assertThrows(
    () => parseVerser(txt("YXXXXCAA"), "txt"),
    DeserializeError,
  );
});
