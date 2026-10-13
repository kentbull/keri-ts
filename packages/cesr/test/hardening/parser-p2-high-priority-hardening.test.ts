import { assert, assertEquals } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../src/core/bytes.ts";
import { createParser, type ParserOptions } from "../../src/core/parser-engine.ts";
import type { ParseEvent } from "../../src/core/types.ts";
import { Counter } from "../../src/primitives/counter.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV1, counterV2, groupV2, sigerToken, token } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { chunkByBoundaries, encode } from "../fixtures/stream-byte-fixtures.ts";
import { minimalV1CborBody, minimalV1MgpkBody, v2ify } from "../fixtures/versioned-body-fixtures.ts";

interface FrameSummary {
  kind: string;
  pvrsn: string;
  ilk: string;
  said: string;
  nativeBodyCode: string;
  attachments: string[];
}

function parseEvents(
  input: Uint8Array,
  boundaries: number[] = [],
  options?: ParserOptions,
): ParseEvent[] {
  const parser = createParser(options);
  const out: ParseEvent[] = [];
  for (const chunk of chunkByBoundaries(input, boundaries)) {
    out.push(...parser.feed(chunk));
  }
  out.push(...parser.flush());
  return out;
}

function parseFramesNoError(
  input: Uint8Array,
  boundaries: number[] = [],
  options?: ParserOptions,
) {
  const events = parseEvents(input, boundaries, options);
  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);
  return events.filter((event) => event.type === "frame");
}

function summarizeFrames(frames: ParseEvent[]): FrameSummary[] {
  return frames
    .filter((event) => event.type === "frame")
    .map((event) => ({
      kind: event.frame.body.kind,
      pvrsn: `${event.frame.body.pvrsn.major}.${event.frame.body.pvrsn.minor}`,
      ilk: event.frame.body.ilk ?? "",
      said: event.frame.body.said ?? "",
      nativeBodyCode: event.frame.body.kind === "CESR" && event.frame.body.ked
        ? new Counter({ qb64b: event.frame.body.raw, version: event.frame.body.gvrsn ?? event.frame.body.pvrsn }).code
        : "",
      attachments: event.frame.attachments.map((attachment) => `${attachment.code}:${attachment.count}`),
    }));
}

function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

function splitIntoThirds(input: Uint8Array): number[] {
  const a = Math.max(1, Math.floor(input.length / 3));
  const b = Math.max(a + 1, Math.floor((2 * input.length) / 3));
  return [a, b];
}

function genusVersionCounter(major: 1 | 2, minor = 0): string {
  return new TextDecoder().decode(Counter.makeGVC({ major, minor }));
}

Deno.test(
  "V-P2-001: big-count BodyWithAttachmentGroup with large opaque payload preserves txt/qb2 parity",
  () => {
    const opaqueMatter = token("1AAE");
    const bigOpaqueBody = `${counterV2(CtrDexV2.NonNativeBodyGroup, opaqueMatter.length / 4)}${opaqueMatter}${
      counterV2(CtrDexV2.ControllerIdxSigs, 20 * sigerToken().length / 4)
    }${Array.from({ length: 20 }, () => sigerToken()).join("")}`;
    const wrapped = wrapQuadletGroupV2(
      CtrDexV2.BigBodyWithAttachmentGroup,
      bigOpaqueBody,
    );

    const txtSummary = summarizeFrames(parseFramesNoError(encode(wrapped)));
    const qb2Summary = summarizeFrames(parseFramesNoError(decodeB64(wrapped)));
    assertEquals(qb2Summary, txtSummary);
    assertEquals(txtSummary.length, 1);
    assertEquals(txtSummary[0].kind, "CESR");
    assertEquals(txtSummary[0].ilk, "");
    assertEquals(txtSummary[0].attachments, [
      `${CtrDexV2.ControllerIdxSigs}:440`,
    ]);
  },
);

Deno.test(
  "V-P2-002: deep nested GenericGroup chain with mixed wrapper children remains split-deterministic",
  () => {
    const nestedSigGroup = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
    const wrappedBody = wrapQuadletGroupV2(
      CtrDexV2.BodyWithAttachmentGroup,
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSigGroup}`,
    );
    const nonNative = `${counterV2(CtrDexV2.NonNativeBodyGroup, 1)}MAAA`;

    const g5 = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${wrappedBody}${nonNative}`,
    );
    const g4 = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${g5}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    );
    const g3 = wrapQuadletGroupV2(CtrDexV2.GenericGroup, `${g4}${wrappedBody}`);
    const g2 = wrapQuadletGroupV2(CtrDexV2.GenericGroup, `${g3}${nonNative}`);
    const g1 = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${g2}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    );
    const input = encode(g1);

    const baseline = summarizeFrames(parseFramesNoError(input));
    const split = summarizeFrames(
      parseFramesNoError(input, splitIntoThirds(input)),
    );
    assertEquals(split, baseline);

    assertEquals(baseline.length, 6);
    assertEquals(
      baseline.filter((frame) => frame.attachments.includes(`${CtrDexV2.ControllerIdxSigs}:22`))
        .length,
      2,
    );
    assertEquals(baseline.filter((frame) => frame.ilk === "").length, 2);
    assertEquals(
      baseline.filter((frame) =>
        frame.said
          === "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN"
      ).length,
      4,
    );
  },
);

Deno.test(
  "V-P2-008: alternating nested genus-version selectors preserve wrapper-local version context",
  () => {
    const v1Opaque = `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
    const enclosedV1 = `${genusVersionCounter(1)}${v1Opaque}`;
    const wrappedV1 = counterV1(CtrDexV1.BodyWithAttachmentGroup, enclosedV1.length / 4) + enclosedV1;
    const payload = `${genusVersionCounter(1)}${v1Opaque}${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${
      genusVersionCounter(1)
    }${wrappedV1}${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const stream = wrapQuadletGroupV2(CtrDexV2.GenericGroup, payload);
    const input = encode(stream);
    const frames = parseFramesNoError(
      input,
      splitIntoThirds(input),
    );
    const majors = frames.map((event) => event.type === "frame" ? event.frame.body.pvrsn.major : -1);
    assertEquals(majors, [1, 2, 1, 2]);
  },
);

Deno.test(
  "V-P2-011: long heterogeneous stream (JSON + MGPK + CBOR + native + wrapper) parses in order",
  () => {
    const json = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
    const wrappedNative = wrapQuadletGroupV2(
      CtrDexV2.BodyWithAttachmentGroup,
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${groupV2(CtrDexV2.ControllerIdxSigs, sigerToken())}`,
    );

    const part1 = encode(json);
    const part2 = minimalV1MgpkBody();
    const part3 = minimalV1CborBody();
    const part4 = encode(
      `${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedNative}`,
    );

    const stream = concatBytes(part1, part2, part3, part4);
    const boundaries = [
      part1.length,
      part1.length + part2.length,
      part1.length + part2.length + part3.length,
      part1.length + part2.length + part3.length + 1,
    ];
    const summary = summarizeFrames(parseFramesNoError(stream, boundaries));

    assertEquals(summary.length, 5);
    assertEquals(summary.map((frame) => frame.kind), [
      "JSON",
      "MGPK",
      "CBOR",
      "CESR",
      "CESR",
    ]);
    assertEquals(summary.map((frame) => frame.pvrsn), [
      "2.0",
      "1.0",
      "1.0",
      "2.0",
      "2.0",
    ]);
    assertEquals(summary[4].attachments, [`${CtrDexV2.ControllerIdxSigs}:22`]);
  },
);

Deno.test(
  "V-P2-012: same semantic wrapper-heavy corpus preserves txt/qb2 summary and metadata parity",
  () => {
    const nestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken().repeat(2));
    const wrapped = wrapQuadletGroupV2(
      CtrDexV2.BodyWithAttachmentGroup,
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`,
    );
    const generic = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${wrapped}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    );
    const corpus = `${generic}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

    const txtInput = encode(corpus);
    const qb2Input = decodeB64(corpus);
    const txtSummary = summarizeFrames(
      parseFramesNoError(txtInput, splitIntoThirds(txtInput)),
    );
    const qb2Summary = summarizeFrames(
      parseFramesNoError(qb2Input, splitIntoThirds(qb2Input)),
    );

    assertEquals(qb2Summary, txtSummary);
    assertEquals(txtSummary.length, 3);
    assertEquals(txtSummary[0].attachments, [
      `${CtrDexV2.ControllerIdxSigs}:44`,
    ]);
  },
);

Deno.test(
  "V-P2-014: large declared attachment counts with early EOF emit one terminal shortage and no duplicate flush frames",
  () => {
    const declared = 20;
    const fullAttachment = `${counterV2(CtrDexV2.ControllerIdxSigs, declared * sigerToken().length / 4)}${
      Array.from({ length: declared }, () => sigerToken()).join("")
    }`;
    const truncated = encode(
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${fullAttachment.slice(0, fullAttachment.length - 1)}`,
    );

    const parser = createParser();
    const firstPass = [...parser.feed(truncated), ...parser.flush()];
    const firstFrames = firstPass.filter((event) => event.type === "frame");
    const firstErrors = firstPass.filter((event) => event.type === "error");

    assertEquals(firstFrames.length, 0);
    assertEquals(firstErrors.length, 1);
    if (firstErrors[0].type === "error") {
      assertEquals(firstErrors[0].error.name, "ShortageError");
    }

    const secondFlush = parser.flush();
    assertEquals(secondFlush.length, 0);
  },
);

Deno.test(
  "V-P2-015: malformed wrapper payload fails without publishing a partial frame",
  () => {
    const nested = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
    const malformedPayload = `${nested}ABCD`;
    const wrappedAttachmentGroup = `${
      counterV2(CtrDexV2.AttachmentGroup, malformedPayload.length / 4)
    }${malformedPayload}`;
    const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

    const strictEvents = parseEvents(
      encode(stream),
      [],
    );
    const strictFrames = strictEvents.filter((event) => event.type === "frame");
    const strictErrors = strictEvents.filter((event) => event.type === "error");
    assertEquals(strictFrames.length, 0);
    assertEquals(strictErrors.length, 1);
  },
);
