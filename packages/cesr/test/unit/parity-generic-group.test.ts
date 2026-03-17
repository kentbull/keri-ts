import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { annotate, type CesrFrame, denot, t } from "../../src/index.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { chunkByBoundaries, encode } from "../fixtures/stream-byte-fixtures.ts";

/** Wrap payload with a quadlet-counted v2 group counter. */
function wrapQuadletGroup(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

/**
 * Parse a stream and summarize frame shape for parity assertions.
 * Summary format: `kind|ilk|said|attachmentCodesCsv`.
 */
function summarizeFrames(input: Uint8Array, boundaries: number[]): string[] {
  const parser = createParser();
  const out: CesrFrame[] = [];
  for (const chunk of chunkByBoundaries(input, boundaries)) {
    out.push(...parser.feed(chunk));
  }
  out.push(...parser.flush());

  const errors = out.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);

  const messages = out.filter((event) => event.type === "frame");
  return messages.map((event) => {
    const att = event.frame.attachments.map((group) => group.code).join(",");
    return `${event.frame.body.kind}|${event.frame.body.ilk ?? ""}|${
      event.frame.body.said ?? ""
    }|${att}`;
  });
}

Deno.test("V-P0-001: top-level GenericGroup enclosing one BodyWithAttachmentGroup", () => {
  const nestedAttachment = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const bodyWithAttachmentPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const bodyWithAttachment = wrapQuadletGroup(
    CtrDexV2.BodyWithAttachmentGroup,
    bodyWithAttachmentPayload,
  );
  const stream = wrapQuadletGroup(CtrDexV2.GenericGroup, bodyWithAttachment); // -A

  const annotated = annotate(stream);
  assertStringIncludes(annotated, "GenericGroup count=");
  assertStringIncludes(annotated, "BodyWithAttachmentGroup count=");
  assertEquals(t(denot(annotated)), stream);

  const summary = summarizeFrames(encode(stream), []);
  assertEquals(summary.length, 1);
  assertEquals(summary[0].startsWith("CESR|icp|"), true);
  assertEquals(summary[0].endsWith(`|${CtrDexV2.ControllerIdxSigs}`), true);
});

Deno.test("V-P0-002: nested GenericGroup two levels deep with mixed enclosed content is split-deterministic", () => {
  const nestedAttachment = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const wrappedBodyPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const wrappedBody = wrapQuadletGroup(
    CtrDexV2.BodyWithAttachmentGroup,
    wrappedBodyPayload,
  );
  const innerGeneric = wrapQuadletGroup(CtrDexV2.GenericGroup, wrappedBody);
  const outerPayload = `${innerGeneric}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  const stream = wrapQuadletGroup(CtrDexV2.GenericGroup, outerPayload);
  const input = encode(stream);
  const annotated = annotate(stream);

  // Verification type 1: annotated CESR preserves wrapper counters and round-trips.
  assertStringIncludes(annotated, "GenericGroup count=");
  assertStringIncludes(annotated, "BodyWithAttachmentGroup count=");
  assertEquals(t(denot(annotated)), stream);

  // Verification type 2: whole-stream parse yields the expected frame shapes.
  const baseline = summarizeFrames(input, []);
  assertEquals(baseline.length, 2);
  assertEquals(baseline[0].endsWith(`|${CtrDexV2.ControllerIdxSigs}`), true);
  assertEquals(baseline[1].endsWith("|"), true);

  // Verification type 3: streaming is split-deterministic at every single boundary.
  // Any one-cut chunking [0..split] + [split..end] must match whole-stream baseline.
  for (let split = 1; split < input.length; split++) {
    assertEquals(summarizeFrames(input, [split]), baseline);
  }
});
