import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { sniff } from "../../src/parser/cold-start.ts";
import { smell } from "../../src/serder/smell.ts";
import {
  COUNTER_CODE_NAMES_V1,
} from "../../src/tables/counter.tables.generated.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import {
  counterV1,
  counterV2,
  sigerToken,
} from "../fixtures/counter-token-fixtures.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";
import {
  minimalV1CborBody,
  minimalV1MgpkBody,
  v1ify,
} from "../fixtures/versioned-body-fixtures.ts";

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
  if (!code) {
    throw new Error("No v2-only quadlet-group code found for fallback tests");
  }
  return code;
}

Deno.test("sniff detects message and text counters", () => {
  assertEquals(sniff(encode("{")), "msg");
  assertEquals(sniff(encode("-AAB")), "txt");
  assertEquals(sniff(minimalV1MgpkBody()), "msg");
  assertEquals(sniff(minimalV1CborBody()), "msg");
  assertEquals(sniff(Uint8Array.from([0xde])), "msg"); // mgpk2 tritet
});

Deno.test("smell parses v1 version string", () => {
  const raw = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
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

Deno.test("parser emits frames for cold-start MGPK/CBOR bodies", () => {
  const parser = createParser();
  const out = [
    ...parser.feed(minimalV1MgpkBody()),
    ...parser.feed(minimalV1CborBody()),
    ...parser.flush(),
  ];
  const frames = out.filter((event) => event.type === "frame");
  assertEquals(frames.length, 2);
  if (frames[0].type === "frame") {
    assertEquals(frames[0].frame.body.kind, "MGPK");
    assertEquals(frames[0].frame.body.raw.length, minimalV1MgpkBody().length);
  }
  if (frames[1].type === "frame") {
    assertEquals(frames[1].frame.body.kind, "CBOR");
    assertEquals(frames[1].frame.body.raw.length, minimalV1CborBody().length);
  }
});

Deno.test("parser emits frame with nested attachment group", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const nested = `-AAB${sigerToken()}`; // v1 ControllerIdxSigs count=1
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;

  const parser = createParser();
  const frames = parser.feed(encode(ims));

  assertEquals(frames.length, 1);
  assertEquals(frames[0].type, "frame");
  if (frames[0].type === "frame") {
    assertEquals(frames[0].frame.body.ilk, "icp");
    assertEquals(frames[0].frame.attachments.length, 1);
    assertEquals(frames[0].frame.attachments[0].code, "-V");
    assertEquals(frames[0].frame.attachments[0].count, nested.length / 4);
  }
});

Deno.test("parser fail-fast on malformed attachment stream", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const ims = `${body}-AAB`; // truncated group payload

  const parser = createParser();
  const frames = [...parser.feed(encode(ims)), ...parser.flush()];
  assertEquals(frames.some((e) => e.type === "error"), true);
});

Deno.test("parser strict mode rejects mixed-version attachments that need fallback", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const v2OnlyAttachment = `${
    counterV2(selectV2OnlyQuadletGroupCode(), 1)
  }AAAA`;
  const ims = `${body}${v2OnlyAttachment}`;

  const parser = createParser({ attachmentDispatchMode: "strict" });
  const frames = [...parser.feed(encode(ims)), ...parser.flush()];
  assertEquals(frames.some((e) => e.type === "error"), true);
});

Deno.test("parser compat mode uses fallback callback for mixed-version attachments", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const v2OnlyAttachment = `${
    counterV2(selectV2OnlyQuadletGroupCode(), 1)
  }AAAA`;
  const ims = `${body}${v2OnlyAttachment}`;
  const fallbackCalls: Array<{ from: number; to: number }> = [];

  const parser = createParser({
    attachmentDispatchMode: "compat",
    onAttachmentVersionFallback: (info) => {
      fallbackCalls.push({ from: info.from.major, to: info.to.major });
    },
  });
  const frames = [...parser.feed(encode(ims)), ...parser.flush()];
  const messages = frames.filter((e) => e.type === "frame");
  const errors = frames.filter((e) => e.type === "error");

  assertEquals(errors.length, 0);
  assertEquals(messages.length, 1);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(fallbackCalls[0].from, 1);
  assertEquals(fallbackCalls[0].to, 2);
});

Deno.test("parser fail-fast on NonNativeBodyGroup payload size mismatch", () => {
  const ims = `-HAB${sigerToken()}`; // declares 1 quadlet, provides much larger body token
  const parser = createParser();
  const frames = parser.feed(encode(ims));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].type, "error");
});

Deno.test("V-P0-006: parser emits opaque CESR body for size-consistent NonNativeBodyGroup non-serder payload", () => {
  const ims = `${CtrDexV2.NonNativeBodyGroup}ABMAAA`; // count=1 quadlet, payload decodes to raw non-serder bytes
  const parser = createParser();
  const events = [...parser.feed(encode(ims)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].frame.attachments.length, 0);
  assertEquals(frames[0].frame.body.kind, "CESR");
  assertEquals(frames[0].frame.body.ked, null);
  assertEquals(frames[0].frame.body.ilk, null);
  assertEquals(frames[0].frame.body.said, null);
  assertEquals(frames[0].frame.body.pvrsn.major, 2);
  assertEquals(frames[0].frame.body.raw.length, 2);
});

Deno.test("parser handles chunked input", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const nested = `-AAB${sigerToken()}`;
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  const parser = createParser();

  const first = parser.feed(encode(ims.slice(0, 10)));
  assertEquals(first.length, 0);
  const second = parser.feed(encode(ims.slice(10)));
  assertEquals(second.length, 1);
  assertEquals(second[0].type, "frame");
});

Deno.test("native frame emission is split-boundary deterministic", () => {
  const parser = createParser();
  const ims =
    `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  const split = KERIPY_NATIVE_V2_ICP_FIX_BODY.length;

  const first = parser.feed(encode(ims.slice(0, split)));
  assertEquals(first.length, 0);
  const second = parser.feed(encode(ims.slice(split)));
  assertEquals(second.length, 1);
  assertEquals(second[0].type, "frame");
  if (second[0].type === "frame") {
    assertEquals(second[0].frame.body.kind, "CESR");
    assertEquals(second[0].frame.body.ilk, "icp");
  }
});

Deno.test("parser ignores annotation-domain separator bytes between frames", () => {
  const parser = createParser();
  const ims = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}\n`;
  const frames = [...parser.feed(encode(ims)), ...parser.flush()];
  const messages = frames.filter((e) => e.type === "frame");
  const errors = frames.filter((e) => e.type === "error");
  assertEquals(errors.length, 0);
  assertEquals(messages.length, 1);
});

Deno.test("V-P0-010: parser ignores leading and repeated annotation bytes before first frame", () => {
  const baselineParser = createParser();
  const baseline = [
    ...baselineParser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY)),
    ...baselineParser.flush(),
  ];
  const baselineFrames = baseline.filter((event) => event.type === "frame");
  const baselineErrors = baseline.filter((event) => event.type === "error");
  assertEquals(baselineErrors.length, 0);
  assertEquals(baselineFrames.length, 1);

  const prefixed = `\n\n\n${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  const prefixedParser = createParser();
  const prefixedEvents = [
    ...prefixedParser.feed(encode(prefixed)),
    ...prefixedParser.flush(),
  ];
  const prefixedFrames = prefixedEvents.filter((event) =>
    event.type === "frame"
  );
  const prefixedErrors = prefixedEvents.filter((event) =>
    event.type === "error"
  );
  assertEquals(prefixedErrors.length, 0);
  assertEquals(prefixedFrames.length, 1);

  const dec = new TextDecoder();
  assertEquals(
    dec.decode(prefixedFrames[0].frame.body.raw),
    dec.decode(baselineFrames[0].frame.body.raw),
  );

  // Chunked continuation case: leading annotation bytes may arrive separately.
  const chunkedParser = createParser();
  const first = chunkedParser.feed(encode("\n\n"));
  const second = chunkedParser.feed(
    encode(`\n${KERIPY_NATIVE_V2_ICP_FIX_BODY}`),
  );
  const tail = chunkedParser.flush();
  const chunkedEvents = [...first, ...second, ...tail];
  const chunkedFrames = chunkedEvents.filter((event) => event.type === "frame");
  const chunkedErrors = chunkedEvents.filter((event) => event.type === "error");
  assertEquals(chunkedErrors.length, 0);
  assertEquals(chunkedFrames.length, 1);
  assertEquals(
    dec.decode(chunkedFrames[0].frame.body.raw),
    dec.decode(baselineFrames[0].frame.body.raw),
  );
});

Deno.test("parser fail-fast on malformed native fix-body payload tokenization", () => {
  const parser = createParser();
  const bad = `${KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(0, 4)}!${
    KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(5)
  }`;
  const frames = [...parser.feed(encode(bad)), ...parser.flush()];
  assertEquals(frames.some((e) => e.type === "error"), true);
});

Deno.test("sniff throws on empty buffer", () => {
  assertThrows(() => sniff(new Uint8Array(0)));
});
