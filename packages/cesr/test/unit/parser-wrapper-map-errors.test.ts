import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createParser } from "../../src/parser/stream.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

Deno.test("V-P1-002: parser rejects opaque tail remainder inside AttachmentGroup wrapper payload", () => {
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

Deno.test("V-P1-003: parser rejects MapBodyGroup with dangling label and no value", () => {
  const stream = `${CtrDexV2.MapBodyGroup}ABVAAA`; // count=1 quadlet: label only
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

Deno.test("V-P1-003: parser rejects MapBodyGroup boundary-mismatched nested value tokenization", () => {
  // count=2 quadlets with payload: label + truncated nested counter value.
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
