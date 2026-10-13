import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseSaider, Saider } from "../../../src/primitives/saider.ts";
import { dumps, sizeify } from "../../../src/serder/serder.ts";
import { smell, versify } from "../../../src/serder/smell.ts";
import { wireHex } from "../../fixtures/current-reference-vectors.ts";
import vectors from "../../fixtures/current-said-vectors.json" with { type: "json" };
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

Deno.test("saider: frozen v1/v2 SAIDs retain excluded fields and the complete serialized size", () => {
  for (const row of vectors.rows) {
    const original = structuredClone(row.input);
    const { saider, sad } = Saider.saidify(row.input, { ignore: row.ignore });
    const { kind, size } = smell(txt(String(sad.v))).smellage;
    const raw = dumps(sad, kind);
    assertEquals(sad, row.sad);
    assertEquals(saider.qb64, row.sad.d);
    assertEquals(wireHex(raw), row.raw);
    assertEquals(raw.length, size);
    assertEquals(row.input, original);
    // The multi-field helper shares the same sizing-before-exclusion contract.
    assertEquals(
      Saider.saidifyFields(row.input, { saids: { d: "E" }, ignore: row.ignore }).raw,
      raw,
    );
  }
});

Deno.test("saider: ignored fields must exist and remain on unversioned SADs", () => {
  const input = { d: "", keep: "value", omit: "first" };
  const first = Saider.saidify(input, { ignore: ["omit"] });
  const second = Saider.saidify({ ...input, omit: "second" }, { ignore: ["omit"] });
  // With no version size in the hash, changing only an ignored field cannot change the SAID.
  assertEquals(first.saider.qb64, second.saider.qb64);
  assertEquals(first.sad.omit, "first");
  assertEquals(second.sad.omit, "second");
  for (const field of ["missing", "toString"]) {
    assertThrows(() => Saider.saidify(input, { ignore: [field] }), Error, "Missing ignored field");
  }
});
