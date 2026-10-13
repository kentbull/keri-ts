import { assertEquals } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import {
  concatWithAno,
  genusVersionCounter,
  parseFrames as collectFrames,
  summarizeFrames as summarizeDetails,
  wrapQuadletGroupV2,
} from "../../fixtures/parser-test-helpers.ts";
import { chunkByBoundaries, encode } from "../../fixtures/stream-byte-fixtures.ts";
import { minimalV1CborBody, minimalV1MgpkBody, v2ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Parse stream chunks and require error-free frame output for parity assertions. */
async function parseFrames(input: Uint8Array, boundaries: number[]): Promise<CesrFrame[]> {
  /** Model producer chunk boundaries without adding a second parser lifecycle. */
  async function* chunks() {
    yield* chunkByBoundaries(input, boundaries);
  }
  return await Array.fromAsync(parse(chunks()));
}

/** Compact semantic summary for split-determinism and domain parity comparisons. */
async function summarizeFrames(input: Uint8Array, boundaries: number[]): Promise<string[]> {
  return (await parseFrames(input, boundaries)).map((frame) => {
    const body = frame.body;
    const attachments = frame.attachments
      .map((attachment) => `${attachment.code}:${attachment.count}`)
      .join(",");
    return `${body.kind}|${body.ilk ?? ""}|${body.said ?? ""}|${attachments}`;
  });
}

Deno.test("mixed qb64/qb2 parity for JSON body + attachments stream", async () => {
  const body = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const attachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());

  // Same semantic frame, two attachment domains:
  // - txt stream carries qb64 attachments.
  // - bny stream carries qb2 attachments after the same JSON body bytes.
  const txtStream = encode(`${body}${attachment}`);
  const bnyStream = concatBytes(encode(body), decodeB64(attachment));

  const txtSummary = await summarizeFrames(txtStream, []);
  const bnySummary = await summarizeFrames(bnyStream, []);
  assertEquals(txtSummary, bnySummary);
  assertEquals(txtSummary.length, 1);
  assertEquals(txtSummary[0], "JSON|icp|Eabc|-K:22");
});

Deno.test("multi-message mixed stream ordering is split-deterministic", async () => {
  const jsonBody = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const jsonAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const jsonFrame = `${jsonBody}${jsonAttachment}`;

  const wrappedNestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const wrappedPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedNestedAttachment}`;
  const wrappedFrame = `${counterV2(CtrDexV2.BodyWithAttachmentGroup, wrappedPayload.length / 4)}${wrappedPayload}`;

  const stream = encode(
    `${jsonFrame}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedFrame}`,
  );

  const baseline = await summarizeFrames(stream, []);

  // Verification 1: baseline order across three distinct frame types.
  assertEquals(baseline.length, 3);
  assertEquals(baseline[0], "JSON|icp|Eabc|-K:22");
  assertEquals(
    baseline[1],
    "CESR|icp|EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN|",
  );
  assertEquals(
    baseline[2],
    "CESR|icp|EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN|-K:22",
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
    assertEquals(await summarizeFrames(stream, splitPoints), baseline);
  }

  // Verification 3: exhaustive single-split determinism across the full stream.
  for (let split = 1; split < stream.length; split++) {
    assertEquals(await summarizeFrames(stream, [split]), baseline);
  }
});

Deno.test(
  "long heterogeneous stream (JSON + MGPK + CBOR + native + wrapper) parses in order",
  async () => {
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
    const summary = summarizeDetails(await collectFrames(stream, boundaries));

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
  "interleaved annotation bytes between heterogeneous domains and wrapper styles preserve ordering",
  async () => {
    // JSON + CESR-wrapper + MGPK with `ano` separators exercises domain
    // transitions that commonly break if `ano` skipping becomes stateful/leaky.
    const json = encode(
      v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}"),
    );
    const wrapped = encode(
      wrapQuadletGroupV2(
        CtrDexV2.BodyWithAttachmentGroup,
        `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${groupV2(CtrDexV2.ControllerIdxSigs, sigerToken())}`,
      ),
    );
    const mgpk = minimalV1MgpkBody();
    const stream = concatWithAno([json, wrapped, mgpk], 3);
    const boundaries = [
      Math.floor(stream.length / 5),
      Math.floor((2 * stream.length) / 5),
      Math.floor((3 * stream.length) / 5),
      Math.floor((4 * stream.length) / 5),
    ];

    const summary = summarizeDetails(await collectFrames(stream, boundaries));
    assertEquals(summary.length, 3);
    assertEquals(summary.map((frame) => frame.kind), ["JSON", "CESR", "MGPK"]);
    assertEquals(summary[1].attachments, [`${CtrDexV2.ControllerIdxSigs}:22`]);
  },
);
