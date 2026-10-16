import { assertEquals, assertThrows } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import { ParserError, ShortageError, UnknownCodeError } from "../../../src/core/errors.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { sniff } from "../../../src/parser/cold-start.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/parser.ts";
import { smell } from "../../../src/serder/smell.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { COUNTER_CODE_NAMES_V1 } from "../../../src/tables/counter.tables.generated.ts";
import { counterV1, counterV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";
import { minimalV1CborBody, minimalV1MgpkBody, v1ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Pick a genuinely v2-only enclosure so rejection cannot depend on a shared code's other meaning. */
function selectV2OnlyQuadletGroupCode(): string {
  const candidates = [
    CtrDexV2.ESSRWrapperGroup,
    CtrDexV2.BigESSRWrapperGroup,
    CtrDexV2.FixBodyGroup,
    CtrDexV2.BigFixBodyGroup,
    CtrDexV2.MapBodyGroup,
    CtrDexV2.BigMapBodyGroup,
    CtrDexV2.GenericMapGroup,
    CtrDexV2.BigGenericMapGroup,
    CtrDexV2.GenericListGroup,
    CtrDexV2.BigGenericListGroup,
  ];
  const code = candidates.find((value) => !(value in COUNTER_CODE_NAMES_V1));
  if (!code) throw new Error("No v2-only quadlet-group code found for version rejection tests");
  return code;
}

/** Consume small fixture chunks through the actual progressive engine and its terminal error channel. */
async function parseChunks(...chunks: Uint8Array[]): Promise<CesrFrame[]> {
  /** Preserve each producer boundary while source exhaustion supplies the genuine end of input. */
  async function* source(): AsyncGenerator<Uint8Array> {
    yield* chunks;
  }
  return await Array.fromAsync(parse(source()));
}

Deno.test("sniff detects message and text counters", () => {
  assertEquals(sniff(encode("{")), "msg");
  assertEquals(sniff(encode("-AAB")), "txt");
  assertEquals(sniff(minimalV1MgpkBody()), "msg");
  assertEquals(sniff(minimalV1CborBody()), "msg");
  assertEquals(sniff(Uint8Array.from([0xde])), "msg"); // mgpk2 tritet
});

Deno.test("smell parses v1 version string", () => {
  const raw = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const result = smell(encode(raw));
  assertEquals(result.smellage.proto, "KERI");
  assertEquals(result.smellage.kind, "JSON");
  assertEquals(result.smellage.pvrsn.major, 1);
});

Deno.test("smell parses v1 MGPK/CBOR version strings at cold start", () => {
  const mgpk = smell(minimalV1MgpkBody()).smellage;
  assertEquals(mgpk.kind, "MGPK");
  assertEquals(mgpk.size, minimalV1MgpkBody().length);
  assertEquals(mgpk.pvrsn.major, 1);
  const cbor = smell(minimalV1CborBody()).smellage;
  assertEquals(cbor.kind, "CBOR");
  assertEquals(cbor.size, minimalV1CborBody().length);
  assertEquals(cbor.pvrsn.major, 1);
});

Deno.test("parser emits frames for cold-start MGPK/CBOR bodies", async () => {
  const frames = await parseChunks(minimalV1MgpkBody(), minimalV1CborBody());
  assertEquals(frames.length, 2);
  assertEquals(frames[0].body.kind, "MGPK");
  assertEquals(frames[0].body.raw.length, minimalV1MgpkBody().length);
  assertEquals(frames[1].body.kind, "CBOR");
  assertEquals(frames[1].body.raw.length, minimalV1CborBody().length);
});

Deno.test("parser emits the semantic leaf inside a nested attachment group", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const nested = `-AAB${sigerToken()}`; // v1 ControllerIdxSigs counts one item.
  const frames = await parseBytes(encode(`${body}${counterV1("-V", nested.length / 4)}${nested}`));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].body.ilk, "icp");
  // Structural wrappers validate their extent but do not survive as duplicate raw attachment trees.
  assertEquals(frames[0].attachments.length, 1);
  assertEquals(frames[0].attachments[0].code, "-A");
  assertEquals(frames[0].attachments[0].count, 1);
});

Deno.test("parser rejects a truncated attachment stream", () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  assertThrows(() => parseBytes(encode(`${body}-AAB`)), ShortageError);
});

Deno.test("parser rejects attachments requiring an undeclared major version", () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const v2OnlyAttachment = `${counterV2(selectV2OnlyQuadletGroupCode(), 1)}AAAA`;
  assertThrows(() => parseBytes(encode(`${body}${v2OnlyAttachment}`)), ParserError);
});

Deno.test("parser rejects a NonNativeBodyGroup payload size mismatch", () => {
  const ims = `-HAB${sigerToken()}`; // One declared quadlet cannot contain this much larger token.
  assertThrows(() => parseBytes(encode(ims)), ParserError);
});

Deno.test("parser emits opaque CESR body for size-consistent NonNativeBodyGroup non-serder payload", async () => {
  const ims = `${CtrDexV2.NonNativeBodyGroup}ABMAAA`; // One quadlet encodes two opaque raw bytes.
  const frames = await parseBytes(encode(ims));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].attachments.length, 0);
  assertEquals(frames[0].body.kind, "CESR");
  assertEquals(frames[0].body.ked, null);
  assertEquals(frames[0].body.ilk, null);
  assertEquals(frames[0].body.said, null);
  assertEquals(frames[0].body.pvrsn.major, 2);
  assertEquals(frames[0].body.raw.length, 2);
});

Deno.test("parser handles chunked input", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const nested = `-AAB${sigerToken()}`;
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  const frames = await parseChunks(encode(ims.slice(0, 10)), encode(ims.slice(10)));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].body.ilk, "icp");
  assertEquals(frames[0].attachments[0].count, 1);
});

Deno.test("parser ignores annotation-domain separator bytes between frames", async () => {
  const frames = await parseBytes(encode(`${KERIPY_NATIVE_V2_ICP_FIX_BODY}\n`));
  assertEquals(frames.length, 1);
});

Deno.test("parser ignores leading and repeated annotation bytes before first frame", async () => {
  const baseline = await parseBytes(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  const prefixed = await parseBytes(encode(`\n\n\n${KERIPY_NATIVE_V2_ICP_FIX_BODY}`));
  const chunked = await parseChunks(encode("\n\n"), encode(`\n${KERIPY_NATIVE_V2_ICP_FIX_BODY}`));
  assertEquals(baseline.length, 1);
  // Annotation bytes may arrive in their own transport read and must not become a frame boundary.
  for (const frames of [prefixed, chunked]) {
    assertEquals(frames.length, 1);
    assertEquals(frames[0].body.raw, baseline[0].body.raw);
  }
});

Deno.test("parser rejects malformed native fix-body payload tokenization", () => {
  const bad = `${KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(0, 4)}!${KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(5)}`;
  assertThrows(() => parseBytes(encode(bad)), ParserError);
});

Deno.test("sniff throws on empty buffer", () => {
  assertThrows(() => sniff(new Uint8Array(0)));
});

Deno.test("parser rejects malformed v1 signatures without emitting a frame", () => {
  const body = encode(v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}"));
  for (const attachment of [encode("-AABzzzz"), decodeB64("-AABzzzz")]) {
    assertThrows(() => parseBytes(concatBytes(body, attachment)), UnknownCodeError);
  }
});
