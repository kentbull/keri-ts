import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Compactor, parseCompactor } from "../../../src/primitives/compactor.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

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
  assertEquals(Object.keys(compactor.partials ?? {}).length > 0, true);
});
