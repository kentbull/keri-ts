import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { encode as encodeMsgpack } from "@msgpack/msgpack";
import { encode as encodeCbor } from "cbor-x/encode";

type Encodable =
  | string
  | number
  | boolean
  | null
  | Encodable[]
  | { [key: string]: Encodable };

// Real KERI inception event fixture (from repository sample streams).
const REAL_ICP_EVENT: Record<string, Encodable> = {
  v: "KERI10JSON000229_",
  t: "icp",
  d: "EGq24VD48smR5JzSV2PnW9i_g1cdwzpSyZwNAse6JwkH",
  i: "EGq24VD48smR5JzSV2PnW9i_g1cdwzpSyZwNAse6JwkH",
  s: "0",
  kt: ["1/2", "1/2"],
  k: [
    "DHGF1NUOc-vwViJHL5vQ4pwJK2a41rRonZ4kJlMUZ-xF",
    "DFtTn4J6D8SIe8TXtEX12ce06obMjWaV-jncEV1Goypd",
  ],
  nt: ["1/2", "1/2"],
  n: [
    "EGKa8UzUyVkfZmNi3bRwFm0lB8KJwYahjKwcMEbLNcq0",
    "EJzwX8-rUGej2owHHc9P3-ELUjl-oHkFPQo4bHLLllId",
  ],
  bt: "3",
  b: [
    "BIfjEfe_3R6Svl6M9qcek9XIK0E7_DAJXRnWF-_feU98",
    "BHfT1Re4STNP8yPOvf4BpIAvQ0uBQND-4tCJzBV-RDG3",
    "BGnxtp6cV-37FU4eV6ZfOQGJBRirhlD_mtrazYNmfhBo",
  ],
  c: [],
  a: [],
};

function buildV1Serder(kind: "MGPK" | "CBOR"): Uint8Array {
  const body = structuredClone(REAL_ICP_EVENT);
  body.v = `KERI10${kind}000000_`;
  const encode = kind === "MGPK"
    ? (obj: Record<string, Encodable>) => encodeMsgpack(obj)
    : (obj: Record<string, Encodable>) => encodeCbor(obj);
  let raw = encode(body);
  body.v = `KERI10${kind}${raw.length.toString(16).padStart(6, "0")}_`;
  raw = encode(body);
  return raw;
}

function parseSingle(raw: Uint8Array) {
  const parser = createParser();
  const events = [...parser.feed(raw), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");
  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  if (frames[0].type !== "frame") {
    throw new Error("Expected frame event");
  }
  return frames[0].frame;
}

Deno.test("V-P1-013: cold-start MGPK Serder body populates ked/ilk/said", () => {
  const frame = parseSingle(buildV1Serder("MGPK"));
  assertEquals(frame.body.kind, "MGPK");
  assertEquals(frame.body.ilk, "icp");
  assertEquals(frame.body.said, REAL_ICP_EVENT.d);
  assertEquals(frame.body.pvrsn.major, 1);
  assertEquals(frame.body.ked?.t, "icp");
  assertEquals(frame.body.ked?.d, REAL_ICP_EVENT.d);
  assertEquals((frame.body.ked?.k as unknown[])?.length ?? 0, 2);
});

Deno.test("V-P1-013: cold-start CBOR Serder body populates ked/ilk/said", () => {
  const frame = parseSingle(buildV1Serder("CBOR"));
  assertEquals(frame.body.kind, "CBOR");
  assertEquals(frame.body.ilk, "icp");
  assertEquals(frame.body.said, REAL_ICP_EVENT.d);
  assertEquals(frame.body.pvrsn.major, 1);
  assertEquals(frame.body.ked?.t, "icp");
  assertEquals(frame.body.ked?.d, REAL_ICP_EVENT.d);
  assertEquals((frame.body.ked?.k as unknown[])?.length ?? 0, 2);
});
