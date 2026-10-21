import { assertEquals } from "jsr:@std/assert";
import { b, concatBytes } from "../../../../src/core/bytes.ts";
import { Mapper } from "../../../../src/primitives/structuring/mapper.ts";
import { parsePather } from "../../../../src/primitives/structuring/pather.ts";
import { Bexter, parseBexter } from "../../../../src/primitives/values/bexter.ts";
import { parseLabeler } from "../../../../src/primitives/values/labeler.ts";
import { hexWire } from "../../../fixtures/current-reference-vectors.ts";
import vectors from "../../../fixtures/current-text-vectors.json" with { type: "json" };
import { currentTextVectors } from "../../../fixtures/current-text-vectors.ts";

Deno.test("current text: frozen Python literals decode with exact extents in both domains", () => {
  assertEquals(vectors.reference, "7143832813cac6a394ab1faf9be83bb3372be87c");
  for (const domain of ["txt", "bny"] as const) {
    for (const vector of vectors.bexters) {
      const wire = domain === "txt" ? b(vector.qb64) : hexWire(vector.qb2);
      const parsed = parseBexter(concatBytes(wire, b("TAIL")), domain);
      const bexter = new Bexter(parsed, vector.escapive);
      assertEquals(bexter.bext, vector.text);
      assertEquals(bexter.escapive, vector.escapive);
      assertEquals(domain === "txt" ? parsed.fullSize : parsed.fullSizeB2, wire.length);
    }
    for (const vector of vectors.labels) {
      const wire = domain === "txt" ? b(vector.qb64) : hexWire(vector.qb2);
      const labeler = parseLabeler(concatBytes(wire, b("TAIL")), domain);
      assertEquals(labeler.text, vector.text);
      if (!vector.text.startsWith("-")) assertEquals(labeler.label, vector.text);
      assertEquals(domain === "txt" ? labeler.fullSize : labeler.fullSizeB2, wire.length);
    }
    for (const vector of vectors.paths) {
      const wire = domain === "txt" ? b(vector.qb64) : hexWire(vector.qb2);
      const pather = parsePather(concatBytes(wire, b("TAIL")), domain);
      assertEquals(pather.path, vector.path);
      assertEquals(domain === "txt" ? pather.fullSize : pather.fullSizeB2, wire.length);
    }
  }
});

Deno.test("current text: independent TS encoding matches literal Python qb64 and qb2", () => {
  assertEquals(currentTextVectors(), {
    bexters: vectors.bexters,
    labels: vectors.labels,
    paths: vectors.paths,
  });
});

Deno.test("current text: Mapper preserves escaped labels and hyphen-prefixed text", () => {
  const mad = { Abbbbbbbbbbb: "-bbbbbbbbbbb", Abbbbbbbbbbbb: "--bbbbbbbbbb" };
  const mapper = new Mapper({ mad, saidive: false });
  for (const init of [{ qb64: mapper.qb64 }, { qb2: mapper.qb2 }]) {
    assertEquals(new Mapper({ ...init, saidive: false }).mad, mad);
  }
});

Deno.test("current text: large escaped Bexter decode uses the big family", () => {
  // One MiB exceeds ordinary argument/stack limits and exercises bulk decoding.
  const text = "A".repeat(1024 * 1024);
  const bexter = new Bexter({ code: "4A", raw: Bexter.rawify(text) });
  assertEquals(bexter.code, "9AAA");
  assertEquals(parseBexter(bexter.qb64b, "txt").bext, text);
  assertEquals(parseBexter(bexter.qb2, "bny").bext, text);
});
