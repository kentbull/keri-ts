import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { ShortageError } from "../../src/core/errors.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

Deno.test("V-P0-008: flush emits pending frame and no error when no remainder bytes exist", () => {
  const parser = createParser();
  const feedOut = parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));

  // Unframed mode defers body-only end-of-buffer emission until flush/more bytes.
  assertEquals(feedOut.length, 0);

  const flushed = parser.flush();
  assertEquals(flushed.length, 1);
  assertEquals(flushed[0].type, "frame");
  if (flushed[0].type === "frame") {
    assertEquals(flushed[0].frame.body.kind, "CESR");
    assertEquals(flushed[0].frame.body.ilk, "icp");
  }
});

Deno.test("V-P0-009: flush emits pending frame then ShortageError when truncated tail remains", () => {
  const parser = createParser();
  // Declares one AttachmentGroup quadlet payload but omits payload bytes.
  // This guarantees an attachment-group shortage path.
  const truncatedAttachment = "-CAB";
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${truncatedAttachment}`;
  const feedOut = parser.feed(encode(stream));

  // Attachment parse shortage defers frame and keeps truncated tail buffered.
  assertEquals(feedOut.length, 0);

  const flushed = parser.flush();
  assertEquals(flushed.length, 2);
  assertEquals(flushed[0].type, "frame");
  assertEquals(flushed[1].type, "error");
  if (flushed[1].type === "error") {
    assertEquals(flushed[1].error instanceof ShortageError, true);
  }
});

Deno.test("V-P1-012: flush idempotency emits pending frame only once", () => {
  const parser = createParser();
  const feedOut = parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  assertEquals(feedOut.length, 0);

  const first = parser.flush();
  assertEquals(first.length, 1);
  assertEquals(first[0].type, "frame");

  const second = parser.flush();
  assertEquals(second.length, 0);
});

Deno.test("V-P1-012: flush idempotency emits terminal shortage only once", () => {
  const parser = createParser();
  const truncatedAttachment = "-CAB";
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${truncatedAttachment}`;
  const feedOut = parser.feed(encode(stream));
  assertEquals(feedOut.length, 0);

  const first = parser.flush();
  assertEquals(first.length, 2);
  assertEquals(first[0].type, "frame");
  assertEquals(first[1].type, "error");
  if (first[1].type === "error") {
    assertEquals(first[1].error instanceof ShortageError, true);
  }

  const second = parser.flush();
  assertEquals(second.length, 0);
});

Deno.test("V-P1-014: flush preserves stream order when pendingFrame and queuedFrames coexist", () => {
  const parser = createParser();
  const nestedAttachment = `${
    counterV2(CtrDexV2.ControllerIdxSigs, 1)
  }${sigerToken()}`;
  const firstEnclosed = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const secondEnclosed = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const genericPayload = `${firstEnclosed}${secondEnclosed}`;
  const generic = `${
    counterV2(CtrDexV2.GenericGroup, genericPayload.length / 4)
  }${genericPayload}`;

  // Truncated top-level attachment token triggers shortage after first enclosed
  // frame is selected, leaving second enclosed frame queued.
  const stream = `${generic}-CAB`;
  const feedOut = parser.feed(encode(stream));
  assertEquals(feedOut.length, 0);

  // Empty follow-up feed must remain deterministic and not force emission.
  const followUp = parser.feed(new Uint8Array(0));
  assertEquals(followUp.length, 0);

  const flushed = parser.flush();
  assertEquals(flushed.length, 3);
  assertEquals(flushed[0].type, "frame");
  assertEquals(flushed[1].type, "frame");
  assertEquals(flushed[2].type, "error");

  if (flushed[0].type === "frame" && flushed[1].type === "frame") {
    // First enclosed frame had no nested attachments.
    assertEquals(flushed[0].frame.attachments.length, 0);
    // Second enclosed frame carried one nested attachment group.
    assertEquals(flushed[1].frame.attachments.length, 1);
    assertEquals(
      flushed[1].frame.attachments[0].code,
      CtrDexV2.ControllerIdxSigs,
    );
  }
  if (flushed[2].type === "error") {
    assertEquals(flushed[2].error instanceof ShortageError, true);
  }
});
