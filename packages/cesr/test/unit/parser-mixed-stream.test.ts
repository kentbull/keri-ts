import { assertEquals } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../src/core/bytes.ts";
import { createParser } from "../../src/core/parser-engine.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { chunkByBoundaries, encode } from "../fixtures/stream-byte-fixtures.ts";
import { v2ify } from "../fixtures/versioned-body-fixtures.ts";

/** Parse stream chunks and require error-free frame output for parity assertions. */
function parseFrames(
  input: Uint8Array,
  boundaries: number[],
): Array<CesrFrame> {
  const parser = createParser({
    onAttachmentVersionFallback: () => {
      // Keep split-matrix output deterministic/noiseless in test logs.
    },
  });
  const events: CesrFrame[] = [];
  for (const chunk of chunkByBoundaries(input, boundaries)) {
    events.push(...parser.feed(chunk));
  }
  events.push(...parser.flush());
  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);
  return events.filter((event) => event.type === "frame");
}

/** Compact semantic summary for split-determinism and domain parity comparisons. */
function summarizeFrames(input: Uint8Array, boundaries: number[]): string[] {
  return parseFrames(input, boundaries).map((event) => {
    if (event.type !== "frame") return "";
    const body = event.frame.body;
    const attachments = event.frame.attachments
      .map((attachment) => `${attachment.code}:${attachment.count}`)
      .join(",");
    return `${body.kind}|${body.ilk ?? ""}|${body.said ?? ""}|${attachments}`;
  });
}

Deno.test("V-P1-004: mixed qb64/qb2 parity for JSON body + attachments stream", () => {
  const body = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const attachment = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;

  // Same semantic frame, two attachment domains:
  // - txt stream carries qb64 attachments.
  // - bny stream carries qb2 attachments after the same JSON body bytes.
  const txtStream = encode(`${body}${attachment}`);
  const bnyStream = concatBytes(encode(body), decodeB64(attachment));

  const txtSummary = summarizeFrames(txtStream, []);
  const bnySummary = summarizeFrames(bnyStream, []);
  assertEquals(txtSummary, bnySummary);
  assertEquals(txtSummary.length, 1);
  assertEquals(txtSummary[0], "JSON|icp|Eabc|-K:1");
});

Deno.test("V-P1-005: multi-message mixed stream ordering is split-deterministic", () => {
  const jsonBody = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const jsonAttachment = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const jsonFrame = `${jsonBody}${jsonAttachment}`;

  const wrappedNestedAttachment = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const wrappedPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedNestedAttachment}`;
  const wrappedFrame = `${
    counterV2(CtrDexV2.BodyWithAttachmentGroup, wrappedPayload.length / 4)
  }${wrappedPayload}`;

  const stream = encode(
    `${jsonFrame}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedFrame}`,
  );

  const baseline = summarizeFrames(stream, []);

  // Verification 1: baseline order across three distinct frame types.
  assertEquals(baseline.length, 3);
  assertEquals(baseline[0], "JSON|icp|Eabc|-K:1");
  assertEquals(
    baseline[1],
    "CESR|icp|EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN|",
  );
  assertEquals(
    baseline[2],
    "CESR|icp|EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN|-K:1",
  );

  const frame1End = jsonFrame.length;
  const frame2End = frame1End + KERIPY_NATIVE_V2_ICP_FIX_BODY.length;

  // Verification 2: boundary-aligned and boundary-adjacent chunk cuts.
  const targetedSplits = [
    [frame1End],
    [frame2End],
    [frame1End, frame2End],
    [frame1End - 1, frame2End + 1],
  ];
  for (const splitPoints of targetedSplits) {
    assertEquals(summarizeFrames(stream, splitPoints), baseline);
  }

  // Verification 3: exhaustive single-split determinism across the full stream.
  for (let split = 1; split < stream.length; split++) {
    assertEquals(summarizeFrames(stream, [split]), baseline);
  }
});
