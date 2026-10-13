import { assertEquals } from "jsr:@std/assert";
import { ShortageError } from "../../../src/core/errors.ts";
import { createParser } from "../../../src/parser/stream.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test("flush idempotency emits pending frame only once", () => {
  const parser = createParser();
  const feedOut = parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  assertEquals(feedOut.length, 0);

  const first = parser.flush();
  assertEquals(first.length, 1);
  assertEquals(first[0].type, "frame");
  if (first[0].type === "frame") {
    assertEquals(first[0].frame.body.kind, "CESR");
    assertEquals(first[0].frame.body.ilk, "icp");
  }

  const second = parser.flush();
  assertEquals(second.length, 0);
});

Deno.test("flush idempotency emits terminal shortage only once", () => {
  const parser = createParser();
  // One declared attachment quadlet is absent, so only EOF can resolve the shortage.
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

Deno.test(
  "truncated twenty-signature attachment emit one terminal shortage and no duplicate flush frames",
  () => {
    const declared = 20;
    const fullAttachment = `${counterV2(CtrDexV2.ControllerIdxSigs, declared * sigerToken().length / 4)}${
      Array.from({ length: declared }, () => sigerToken()).join("")
    }`;
    const truncated = encode(
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${fullAttachment.slice(0, fullAttachment.length - 1)}`,
    );

    const parser = createParser();
    const firstPass = [...parser.feed(truncated), ...parser.flush()];
    const firstFrames = firstPass.filter((event) => event.type === "frame");
    const firstErrors = firstPass.filter((event) => event.type === "error");

    assertEquals(firstFrames.length, 0);
    assertEquals(firstErrors.length, 1);
    if (firstErrors[0].type === "error") {
      assertEquals(firstErrors[0].error.name, "ShortageError");
    }

    const secondFlush = parser.flush();
    assertEquals(secondFlush.length, 0);
  },
);
