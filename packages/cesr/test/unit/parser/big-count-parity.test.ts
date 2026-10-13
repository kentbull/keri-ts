import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Write a requested large counter around an aligned v2 enclosure. */
function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

/** Compare semantic body/attachment results independently of input encoding domain. */
function summarizeFrames(frames: CesrFrame[]): string[] {
  return frames.map(({ body, attachments }) => {
    const groups = attachments.map((attachment) => `${attachment.code}:${attachment.count}`).join(",");
    return `${body.kind}|${body.ilk ?? ""}|${body.said ?? ""}|${groups}`;
  });
}

Deno.test("big wrapper counters (--A/--B/--C) preserve txt/qb2 parity", async () => {
  const nestedSigGroup = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());

  const bigBodyPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSigGroup}`;
  const bigBodyWrapped = wrapQuadletGroupV2(
    CtrDexV2.BigBodyWithAttachmentGroup,
    bigBodyPayload,
  );

  const bigAttachmentWrapped = wrapQuadletGroupV2(
    CtrDexV2.BigAttachmentGroup,
    nestedSigGroup,
  );
  const bodyPlusBigAttachment = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${bigAttachmentWrapped}`;

  const genericPayload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${bigBodyWrapped}`;
  const bigGenericWrapped = wrapQuadletGroupV2(
    CtrDexV2.BigGenericGroup,
    genericPayload,
  );

  const cases = [
    { name: "--B", stream: bigBodyWrapped },
    { name: "--C", stream: bodyPlusBigAttachment },
    { name: "--A", stream: bigGenericWrapped },
  ];

  for (const testCase of cases) {
    const txt = summarizeFrames(await parseBytes(encode(testCase.stream)));
    const bny = summarizeFrames(await parseBytes(decodeB64(testCase.stream)));
    assertEquals(bny, txt, `txt/qb2 parity failed for ${testCase.name}`);
  }
});
