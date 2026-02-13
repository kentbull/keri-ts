import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import { sniff } from "../../src/parser/cold-start.ts";
import { smell } from "../../src/serder/smell.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function v1ify(raw: string): string {
  const size = new TextEncoder().encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI10JSON000000_", `KERI10JSON${sizeHex}_`);
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function counterV1(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V1.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

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
});

Deno.test("smell parses v1 version string", () => {
  const raw = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const result = smell(encode(raw));
  assertEquals(result.smellage.proto, "KERI");
  assertEquals(result.smellage.kind, "JSON");
  assertEquals(result.smellage.pvrsn.major, 1);
});

Deno.test("parser emits frame with nested attachment group", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const nested = `-AAB${sigerToken()}`; // v1 ControllerIdxSigs count=1
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;

  const parser = createParser();
  const emissions = parser.feed(encode(ims));

  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    assertEquals(emissions[0].frame.serder.ilk, "icp");
    assertEquals(emissions[0].frame.attachments.length, 1);
    assertEquals(emissions[0].frame.attachments[0].code, "-V");
    assertEquals(emissions[0].frame.attachments[0].count, nested.length / 4);
  }
});

Deno.test("parser fail-fast on malformed attachment stream", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const ims = `${body}-AAB`; // truncated group payload

  const parser = createParser();
  const emissions = [...parser.feed(encode(ims)), ...parser.flush()];
  assertEquals(emissions.some((e) => e.type === "error"), true);
});

Deno.test("parser strict mode rejects mixed-version attachments that need fallback", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const v2OnlyAttachment = `${
    counterV2(selectV2OnlyQuadletGroupCode(), 1)
  }AAAA`;
  const ims = `${body}${v2OnlyAttachment}`;

  const parser = createParser({ attachmentDispatchMode: "strict" });
  const emissions = [...parser.feed(encode(ims)), ...parser.flush()];
  assertEquals(emissions.some((e) => e.type === "error"), true);
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
  const emissions = [...parser.feed(encode(ims)), ...parser.flush()];
  const frames = emissions.filter((e) => e.type === "frame");
  const errors = emissions.filter((e) => e.type === "error");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(fallbackCalls[0].from, 1);
  assertEquals(fallbackCalls[0].to, 2);
});

Deno.test("parser fail-fast on NonNativeBodyGroup payload size mismatch", () => {
  const ims = `-HAB${sigerToken()}`; // declares 1 quadlet, provides much larger body token
  const parser = createParser();
  const emissions = parser.feed(encode(ims));
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "error");
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
    assertEquals(second[0].frame.serder.kind, "CESR");
    assertEquals(second[0].frame.serder.ilk, "icp");
  }
});

Deno.test("parser ignores annotation-domain separator bytes between frames", () => {
  const parser = createParser();
  const ims = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}\n`;
  const emissions = [...parser.feed(encode(ims)), ...parser.flush()];
  const frames = emissions.filter((e) => e.type === "frame");
  const errors = emissions.filter((e) => e.type === "error");
  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
});

Deno.test("parser fail-fast on malformed native fix-body payload tokenization", () => {
  const parser = createParser();
  const bad = `${KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(0, 4)}!${
    KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(5)
  }`;
  const emissions = [...parser.feed(encode(bad)), ...parser.flush()];
  assertEquals(emissions.some((e) => e.type === "error"), true);
});

Deno.test("sniff throws on empty buffer", () => {
  assertThrows(() => sniff(new Uint8Array(0)));
});
