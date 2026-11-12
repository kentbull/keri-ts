/**
 * ACDC attribute, edge and rule section SAIDs against KERIpy.
 *
 * Vectors come from `packages/cesr/scripts/reference-section-said-vectors.py`
 * at the pinned KERIpy reference. Each row carries the constructor input KERIpy
 * authored from and the bytes it emitted, so keri-ts must both accept those
 * bytes and author identical bytes and SAID from the same input.
 */
import { assertEquals } from "jsr:@std/assert";
import { decodeHex } from "jsr:@std/encoding/hex";
import { SerderACDC } from "../../../src/serder/serder.ts";
import { type Kind, Vrsn_1_0, Vrsn_2_0 } from "../../../src/tables/versions.ts";
import vectors from "../../fixtures/section-said-vectors.json" with { type: "json" };

type SectionSad = Record<string, unknown>;
type Row = (typeof vectors.rows)[number];

/** Section labels whose case name says the authored map had no top-level `d`. */
function sectionsWithoutD(row: Row): string[] {
  if (row.version === 1) return row.case === "v1-a-no-d" ? ["a"] : [];
  if (row.case === "all-no-d") return ["a", "e", "r"];
  const match = /^([aer])-no-d/.exec(row.case);
  return match ? [match[1]] : [];
}

/** Run one check per row and report every failing row name at once. */
function failingRows(check: (row: Row) => void): string[] {
  const failures: string[] = [];
  for (const row of vectors.rows) {
    try {
      check(row);
    } catch (error) {
      failures.push(`${row.name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    }
  }
  return failures;
}

Deno.test("serder: ACDC section SAID vectors verify KERIpy bytes", () => {
  assertEquals(
    failingRows((row) => {
      const raw = decodeHex(row.raw);
      const received = new SerderACDC({ raw });
      assertEquals(received.said, row.said);
      assertEquals(received.raw, raw);
      for (const label of sectionsWithoutD(row)) {
        const section = received.sad![label] as SectionSad;
        assertEquals(typeof section, "object", label);
        assertEquals("d" in section, false, label);
      }
    }),
    [],
  );
});

Deno.test("serder: ACDC section SAID vectors author KERIpy bytes", () => {
  assertEquals(
    failingRows((row) => {
      const built = new SerderACDC({
        sad: structuredClone(row.sad) as SectionSad,
        makify: true,
        kind: row.kind as Kind,
        pvrsn: row.version === 1 ? Vrsn_1_0 : Vrsn_2_0,
        gvrsn: row.version === 1 ? undefined : Vrsn_2_0,
        compactify: row.compactify,
      });
      assertEquals(built.said, row.said, "said");
      assertEquals(built.raw, decodeHex(row.raw), "raw");
    }),
    [],
  );
});

Deno.test("serder: ACDC section SAID vectors cover every kind and section form", () => {
  const names = new Set(vectors.rows.map((row) => row.name));
  for (const kind of ["JSON", "CBOR", "MGPK", "CESR"]) {
    for (
      const kase of [
        "a-no-d",
        "a-no-d-nested-d",
        "a-no-d-nested-no-d",
        "e-no-d",
        "e-no-d-nested-d",
        "r-no-d",
        "r-no-d-nested-d",
        "all-no-d",
        "a-d",
        "a-d-nested-no-d",
        "a-d-nested-d",
        "e-d",
        "r-d",
      ]
    ) {
      assertEquals(names.has(`2-${kind}-${kase}`), true, `2-${kind}-${kase}`);
      assertEquals(names.has(`2-${kind}-${kase}-compact`), true, `2-${kind}-${kase}-compact`);
    }
  }
  for (const kind of ["JSON", "CBOR", "MGPK"]) {
    for (const kase of ["v1-a-no-d", "v1-a-d"]) {
      assertEquals(names.has(`1-${kind}-${kase}`), true, `1-${kind}-${kase}`);
    }
  }
});
