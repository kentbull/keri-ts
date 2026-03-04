import { assertEquals } from "jsr:@std/assert";
import { serializeBody } from "../../src/serder/serder.ts";
import { parseSerder } from "../../src/serder/serder.ts";
import type { Smellage } from "../../src/core/types.ts";
import { Vrsn_1_0 } from "../../src/tables/versions.ts";

const sampleKed: Record<string, unknown> = {
  v: "KERI10JSON000000_",
  t: "icp",
  d: "EAbcdefg",
  i: "EAbcdefg",
  s: "0",
};

function makeSmellage(kind: "JSON" | "CBOR" | "MGPK", size: number): Smellage {
  return {
    proto: "KERI",
    pvrsn: Vrsn_1_0,
    gvrsn: null,
    kind,
    size,
  };
}

Deno.test("serializeBody: JSON output matches JSON.stringify", () => {
  const raw = serializeBody(sampleKed, "JSON");
  const expected = new TextEncoder().encode(JSON.stringify(sampleKed));
  assertEquals(raw, expected);
});

Deno.test("serializeBody: JSON round-trip through parseSerder", () => {
  const raw = serializeBody(sampleKed, "JSON");
  const body = parseSerder(raw, makeSmellage("JSON", raw.length));
  assertEquals(body.ked, sampleKed);
});

Deno.test("serializeBody: CBOR round-trip through parseSerder", () => {
  const raw = serializeBody(sampleKed, "CBOR");
  const body = parseSerder(raw, makeSmellage("CBOR", raw.length));
  assertEquals(body.ked, sampleKed);
});

Deno.test("serializeBody: MGPK round-trip through parseSerder", () => {
  const raw = serializeBody(sampleKed, "MGPK");
  const body = parseSerder(raw, makeSmellage("MGPK", raw.length));
  assertEquals(body.ked, sampleKed);
});
