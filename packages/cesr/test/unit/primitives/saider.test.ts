import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseSaider, Saider } from "../../../src/primitives/saider.ts";
import { sizeify } from "../../../src/serder/serder.ts";
import { versify } from "../../../src/serder/smell.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("saider: parses KERIpy SAID vector", () => {
  const saider = parseSaider(txt(KERIPY_MATTER_VECTORS.saiderAcdc), "txt");
  assertEquals(saider.qb64, KERIPY_MATTER_VECTORS.saiderAcdc);
  assertEquals(saider.said, KERIPY_MATTER_VECTORS.saiderAcdc);
  assertEquals(saider.digest.length > 0, true);
});

Deno.test("saider: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.saiderAcdc,
    parseSaider,
  );
  assertEquals(txtValue.said, bnyValue.said);
});

Deno.test("saider: rejects non-digest code families", () => {
  assertThrows(
    () => parseSaider(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});

Deno.test("saider: saidify injects one computed SAID and preserves sizeified version", () => {
  const ked = {
    v: versify({ size: 0 }),
    t: "icp",
    d: "",
    i: "DFixedPrefix0000000000000000000000000000000",
    s: "0",
    kt: "1",
    k: ["DFixedPrefix0000000000000000000000000000000"],
    nt: "0",
    n: [],
    bt: "0",
    b: [],
    c: [],
    a: [],
  };

  const { saider, sad } = Saider.saidify(ked, {});
  const { raw, ked: sized } = sizeify(sad, "JSON");

  assertEquals(sized.d, saider.qb64);
  assertEquals(sized.i, ked.i);
  assertEquals(saider.qb64.startsWith("E"), true);
  assertEquals(versify({ size: raw.length }), sized.v);
});
