import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createParser } from "../../../src/parser/stream.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { buildNestedMapBodyV2, parseEvents, splitIntoThirds } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test("parser rejects opaque tail remainder inside AttachmentGroup wrapper payload", () => {
  const nested = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const payload = `${nested}ABCD`; // valid nested group + opaque tail quadlet
  const wrappedAttachmentGroup = `${counterV2(CtrDexV2.AttachmentGroup, payload.length / 4)}${payload}`;
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}`;

  const parser = createParser();
  const events = [...parser.feed(encode(stream)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(frames.length, 0);
  assertEquals(errors.length, 1);
  if (errors[0].type === "error") {
    assertEquals(errors[0].error.name, "DeserializeError");
    assertStringIncludes(errors[0].error.message, "Invalid counter text input");
  }
});

Deno.test("parser rejects a truncated native version prefix inside MapBodyGroup", () => {
  const stream = `${CtrDexV2.MapBodyGroup}ABVAAA`; // The complete enclosure is too short for its native version prefix.
  const parser = createParser();
  const events = parser.feed(encode(stream));
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(frames.length, 0);
  assertEquals(errors.length, 1);
  if (errors[0].type === "error") {
    assertEquals(errors[0].error.name, "GroupSizeError");
    assertStringIncludes(errors[0].error.message, "Incomplete field inside native body payload");
  }
});

Deno.test("parser rejects an invalid native version prefix inside MapBodyGroup", () => {
  // The enclosed bytes fail the native version prefix before any map fields are read.
  const stream = `${CtrDexV2.MapBodyGroup}ACVAAA-KAB`;
  const parser = createParser();
  const events = parser.feed(encode(stream));
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(frames.length, 0);
  assertEquals(errors.length, 1);
  if (errors[0].type === "error") {
    assertEquals(errors[0].error.name, "UnknownCodeError");
  }
});

Deno.test(
  "malformed wrapper payload fails without publishing a partial frame",
  () => {
    const nested = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
    const malformedPayload = `${nested}ABCD`;
    const wrappedAttachmentGroup = `${
      counterV2(CtrDexV2.AttachmentGroup, malformedPayload.length / 4)
    }${malformedPayload}`;
    const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

    const events = parseEvents(
      encode(stream),
      [],
    );
    const frames = events.filter((event) => event.type === "frame");
    const errors = events.filter((event) => event.type === "error");
    assertEquals(frames.length, 0);
    assertEquals(errors.length, 1);
  },
);

Deno.test(
  "invalid top-level MapBodyGroup still fails deterministically across chunk boundaries",
  () => {
    const mapBody = buildNestedMapBodyV2();
    const bytes = encode(mapBody);
    // This vector is intentionally *not* a full top-level message. The point
    // of the regression is that chunking must not turn an invalid top-level
    // native map corpus into a partially accepted frame.
    const events = parseEvents(bytes, splitIntoThirds(bytes));
    const frames = events.filter((event) => event.type === "frame");
    const errors = events.filter((event) => event.type === "error");

    assertEquals(frames.length, 0);
    assertEquals(errors.length, 1);
    assertEquals(
      ["DeserializeError", "UnknownCodeError"].includes(errors[0].error.name),
      true,
    );
  },
);
