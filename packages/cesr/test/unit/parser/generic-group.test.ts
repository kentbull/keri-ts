import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { annotate, denot, t } from "../../../src/index.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { parseFrames } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

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
async function summarizeFrames(input: Uint8Array, boundaries: number[]): Promise<string[]> {
  return (await parseFrames(input, boundaries)).map(({ body, attachments }) => {
    const codes = attachments.map((group) => group.code).join(",");
    return `${body.kind}|${body.ilk ?? ""}|${body.said ?? ""}|${codes}`;
  });
}

Deno.test("top-level GenericGroup enclosing one BodyWithAttachmentGroup", async () => {
  const nestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const bodyWithAttachmentPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const bodyWithAttachment = wrapQuadletGroup(
    CtrDexV2.BodyWithAttachmentGroup,
    bodyWithAttachmentPayload,
  );
  const stream = wrapQuadletGroup(CtrDexV2.GenericGroup, bodyWithAttachment); // -A

  const annotated = await annotate(stream);
  assertStringIncludes(annotated, "GenericGroup count=");
  assertStringIncludes(annotated, "BodyWithAttachmentGroup count=");
  assertEquals(t(denot(annotated)), stream);

  const summary = await summarizeFrames(encode(stream), []);
  assertEquals(summary.length, 1);
  assertEquals(summary[0].startsWith("CESR|icp|"), true);
  assertEquals(summary[0].endsWith(`|${CtrDexV2.ControllerIdxSigs}`), true);
});

Deno.test("nested GenericGroup two levels deep with mixed enclosed content is split-deterministic", async () => {
  const nestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const wrappedBodyPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const wrappedBody = wrapQuadletGroup(
    CtrDexV2.BodyWithAttachmentGroup,
    wrappedBodyPayload,
  );
  const innerGeneric = wrapQuadletGroup(CtrDexV2.GenericGroup, wrappedBody);
  const outerPayload = `${innerGeneric}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  const stream = wrapQuadletGroup(CtrDexV2.GenericGroup, outerPayload);
  const input = encode(stream);
  const annotated = await annotate(stream);

  // Verification type 1: annotated CESR preserves wrapper counters and round-trips.
  assertStringIncludes(annotated, "GenericGroup count=");
  assertStringIncludes(annotated, "BodyWithAttachmentGroup count=");
  assertEquals(t(denot(annotated)), stream);

  // Verification type 2: whole-stream parse yields the expected frame shapes.
  const baseline = await summarizeFrames(input, []);
  assertEquals(baseline.length, 2);
  assertEquals(baseline[0].endsWith(`|${CtrDexV2.ControllerIdxSigs}`), true);
  assertEquals(baseline[1].endsWith("|"), true);

  // Bytewise input visits every token boundary without reparsing once per possible cut.
  assertEquals(
    await summarizeFrames(input, Array.from({ length: input.length - 1 }, (_, index) => index + 1)),
    baseline,
  );
  assertEquals(await summarizeFrames(input, [stream.length - KERIPY_NATIVE_V2_ICP_FIX_BODY.length]), baseline);
});
