import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

Deno.test("V-P1-001: pending-frame continuation treats next body-group counter as new frame boundary", () => {
  const parser = createParser();
  const firstFrame = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const secondFrame = KERIPY_NATIVE_V2_ICP_FIX_BODY;

  // First feed ends exactly at a body-only frame boundary in unframed mode,
  // so parser defers emission by storing pendingFrame.
  const firstOut = parser.feed(encode(firstFrame));
  assertEquals(firstOut.length, 0);

  // Second feed begins with a native body-group counter (-F...). This must be
  // recognized as a *new frame boundary* and not consumed as attachment data.
  const secondOut = parser.feed(encode(secondFrame));
  assertEquals(secondOut.length, 1);
  assertEquals(secondOut[0].type, "frame");
  if (secondOut[0].type === "frame") {
    assertEquals(secondOut[0].frame.body.kind, "CESR");
    assertEquals(secondOut[0].frame.body.ilk, "icp");
    assertEquals(secondOut[0].frame.attachments.length, 0);
  }

  // The second body-only frame remains pending until end-of-stream flush.
  const tail = parser.flush();
  assertEquals(tail.length, 1);
  assertEquals(tail[0].type, "frame");
  if (tail[0].type === "frame") {
    assertEquals(tail[0].frame.body.kind, "CESR");
    assertEquals(tail[0].frame.body.ilk, "icp");
    assertEquals(tail[0].frame.attachments.length, 0);
  }
});
