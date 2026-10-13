import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../src/core/bytes.ts";
import type { ParseEvent } from "../../src/core/types.ts";
import { createParser } from "../../src/parser/stream.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

function parseEvents(stream: Uint8Array): ParseEvent[] {
  const parser = createParser();
  return [...parser.feed(stream), ...parser.flush()];
}

function summarizeFrames(events: ParseEvent[]): string[] {
  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);
  return events
    .filter((event) => event.type === "frame")
    .map((event) => {
      if (event.type !== "frame") return "";
      const body = event.frame.body;
      const attachments = event.frame.attachments
        .map((attachment) => `${attachment.code}:${attachment.count}`)
        .join(",");
      return `${body.kind}|${body.ilk ?? ""}|${body.said ?? ""}|${attachments}`;
    });
}

Deno.test("V-P1-006: big wrapper counters (--A/--B/--C) preserve txt/qb2 parity", () => {
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
    const txt = summarizeFrames(parseEvents(encode(testCase.stream)));
    const bny = summarizeFrames(parseEvents(decodeB64(testCase.stream)));
    assertEquals(bny, txt, `txt/qb2 parity failed for ${testCase.name}`);
  }
});
