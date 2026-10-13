import { assertEquals } from "jsr:@std/assert";
import { ShortageError } from "../../src/core/errors.ts";
import { createParser } from "../../src/parser/stream.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { groupV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
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

Deno.test("V-P0-009: flush rejects the pending frame when a truncated attachment remains", () => {
  const parser = createParser();
  // Declares one AttachmentGroup quadlet payload but omits payload bytes.
  // This guarantees an attachment-group shortage path.
  const truncatedAttachment = "-CAB";
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${truncatedAttachment}`;
  const feedOut = parser.feed(encode(stream));

  // Attachment parse shortage defers frame and keeps truncated tail buffered.
  assertEquals(feedOut.length, 0);

  const flushed = parser.flush();
  assertEquals(flushed.length, 1);
  assertEquals(flushed[0].type, "error");
  if (flushed[0].type === "error") {
    assertEquals(flushed[0].error instanceof ShortageError, true);
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
  assertEquals(first.length, 1);
  assertEquals(first[0].type, "error");
  if (first[0].type === "error") {
    assertEquals(first[0].error instanceof ShortageError, true);
  }

  const second = parser.flush();
  assertEquals(second.length, 0);
});

Deno.test("flush preserves completed enclosed siblings before a truncated next body", () => {
  const first = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const second = first + groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const generic = groupV2(CtrDexV2.GenericGroup, first + second);
  const parser = createParser({ framed: true });
  const events = [
    ...parser.feed(encode(generic + first.slice(0, -4))),
    ...parser.flush(),
  ];
  assertEquals(events.map((event) => event.type), ["frame", "frame", "error"]);
  if (events[0].type === "frame" && events[1].type === "frame") {
    assertEquals(events[0].frame.attachments.length, 0);
    assertEquals(events[1].frame.attachments.length, 1);
  }
  if (events[2].type === "error") assertEquals(events[2].error instanceof ShortageError, true);
  assertEquals(parser.flush(), []);
});
