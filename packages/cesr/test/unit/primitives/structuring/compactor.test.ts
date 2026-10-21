import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeHex } from "jsr:@std/encoding/hex";
import { DeserializeError, UnknownCodeError } from "../../../../src/core/errors.ts";
import { Compactor, parseCompactor } from "../../../../src/primitives/structuring/compactor.ts";
import { CtrDexV2 } from "../../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../../fixtures/counter-token-fixtures.ts";
import { txt } from "../../../fixtures/primitive-test-helpers.ts";

import type { MapperMap } from "../../../../src/primitives/structuring/mapper.ts";
import type { Kind } from "../../../../src/tables/versions.ts";
import vectors from "../../../fixtures/keripy-disclosure-vectors.json" with { type: "json" };

const V2 = { major: 2, minor: 0 } as const;

// These tests are intentionally pedagogical. Read them in order if you are
// trying to understand the compactor lifecycle:
// 1. parse one native map shape
// 2. reject wrong group families
// 3. trace leaves, compact them, then re-expand disclosure partials
//
// Compare with:
// - `Aggor` for selective disclosure over aggregate lists
// - `disclosure.ts` for fixed-field blinded disclosure records

Deno.test("compactor: parses KERIpy map-body shape", () => {
  // Minimal inhale example: a native map-body with two labeled fields should
  // hydrate as one compactor and preserve the map-body counter family.
  const payload = `0J_i${token("B")}0J_d${token("E")}`;
  const mapBody = `${counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)}${payload}`;

  const compactor = parseCompactor(txt(mapBody), V2, "txt");
  assertEquals(compactor.code, CtrDexV2.MapBodyGroup);
  assertEquals(compactor.fields.length, 2);
});

Deno.test("compactor: rejects non-map aggregate groups", () => {
  // A compactor is map-only. Generic list groups belong to `Aggor`, not here.
  const payload = "ABCDWXYZ";
  const listBody = `${counterV2(CtrDexV2.GenericListGroup, payload.length / 4)}${payload}`;

  assertThrows(
    () => parseCompactor(txt(listBody), V2, "txt"),
    UnknownCodeError,
  );
});

Deno.test("compactor: trace/compact/expand make nested saidive leaves teachable", () => {
  // This is the maintainer-learning test for compactification. The nested `a`
  // map has its own SAID, so it can become a compact branch reference while the
  // root map keeps its own top-level SAID.
  const compactor = new Compactor({
    mad: {
      d: "",
      a: {
        d: "",
        role: "issuer",
      },
      note: "expanded",
    },
    saidive: true,
    verify: false,
  });

  const traced = compactor.trace(true);
  assertEquals(traced, [".a"]);
  assertEquals(typeof (compactor.mad.a as Record<string, unknown>).d, "string");
  assertEquals(typeof compactor.said, "string");

  compactor.compact();
  assertEquals(typeof compactor.mad.a, "string");

  compactor.expand();
  assertEquals(compactor.partials !== null, true);
  assertEquals(Object.keys(compactor.partials ?? {}), ["", ".a"]);
  assertEquals((compactor.partials![".a"].mad.a as MapperMap).role, "issuer");
  assertEquals(Object.keys(compactor.leaves), [".a", ""]);
});

for (const row of vectors.formats) {
  Deno.test(`compactor: ${row.kind} canonical commitments and expansion match frozen Python`, () => {
    const c = new Compactor({ mad: vectors.source, kind: row.kind as Kind, verify: false });
    c.compact();
    assertEquals(c.mad, row.compact);
    assertEquals(c.raw, decodeHex(row.raw));
    assertEquals(Object.keys(c.leaves), row.leaves);
    c.expand();
    assertEquals(Object.keys(c.partials!), row.expanded.map((partial) => partial.paths.join("|")));
    for (const expected of row.expanded) {
      const actual = c.partials![expected.paths.join("|")];
      assertEquals(actual.mad, expected.mad);
      assertEquals(actual.raw, decodeHex(expected.raw));
    }
  });
}

Deno.test("compactor: requested scalar, subtree, ordinal and union closures match frozen Python", () => {
  for (const row of vectors.paths) {
    const c = new Compactor({ mad: vectors.source, verify: false });
    c.compact(row.paths, "a");
    assertEquals(Object.keys(c.partials!), row.partials.map((partial) => partial.paths.join("|")));
    for (const expected of row.partials) {
      const actual = c.partials![expected.paths.join("|")];
      assertEquals(actual.mad, expected.mad);
      assertEquals(actual.raw, decodeHex(expected.raw));
    }
    assertThrows(() => c.compact(["a/name/value"], "a"), DeserializeError, "compact mapping");
  }
});

Deno.test("compactor: invalid paths fail before changing the expanded map", () => {
  for (const path of ["a/missing", "a/99", "a/name/value/child", "a/name/value/", "a//name", "a/$bad"]) {
    const c = new Compactor({ mad: vectors.source, verify: false });
    assertThrows(() => c.compact([path], "a"), DeserializeError);
    assertEquals(c.mad, vectors.source);
    assertEquals(c.leaves, {});
  }
});

Deno.test("compactor: exact paths distinguish dotted labels from nested labels", () => {
  const row = vectors.collision;
  const c = new Compactor({ mad: row.source, strict: false, verify: false });
  c.compact(row.paths, "a");
  const expected = row.partials[0];
  const partial = c.partials![expected.paths.join("|")];
  assertEquals(partial.mad, expected.mad);
  assertEquals(partial.raw, decodeHex(expected.raw));
  assertEquals((partial.getTail(["a.b"]) as MapperMap).value, "literal");
  assertEquals((partial.getTail(["a", "b"]) as MapperMap).value, "nested");
});
