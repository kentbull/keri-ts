import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { ShortageError } from "../../src/core/errors.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

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
