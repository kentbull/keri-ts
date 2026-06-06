import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { intToB64 } from "../../src/core/bytes.ts";
import { createParser } from "../../src/core/parser-engine.ts";
import { CounterGroup } from "../../src/primitives/counter.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV1, counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../fixtures/versioned-body-fixtures.ts";

function genusVersionCounter(major: 1 | 2, minor = 0): string {
  return `${CtrDexV2.KERIACDCGenusVersion}${intToB64(major, 1)}${intToB64(minor, 1)}${intToB64(0, 1)}`;
}

function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

Deno.test("V-P1-007: GenericGroup enclosed genus-version override applies across multiple enclosed frames", () => {
  const v1Frame = `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
  const genericPayload = `${genusVersionCounter(1)}${v1Frame}${v1Frame}`;
  const generic = wrapQuadletGroupV2(CtrDexV2.GenericGroup, genericPayload);
  const stream = `${generic}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

  const parser = createParser();
  const events = [...parser.feed(encode(stream)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 3);
  if (
    frames[0].type === "frame"
    && frames[1].type === "frame"
    && frames[2].type === "frame"
  ) {
    assertEquals(frames[0].frame.body.pvrsn.major, 1);
    assertEquals(frames[1].frame.body.pvrsn.major, 1);
    // GenericGroup override is enclosed-only; top-level context remains v2.
    assertEquals(frames[2].frame.body.pvrsn.major, 2);
    assertEquals(frames[2].frame.body.ilk, "icp");
  }
});

Deno.test("V-P1-008: strict mode rejects nested mixed-version wrapper groups that require fallback", () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  // Use a v2-only counter token that fails immediately under v1 dispatch.
  const v2OnlyNested = counterV2(CtrDexV2.BigBlindedStateQuadruples, 1);
  const wrappedV1Attachment = `${counterV1(CtrDexV1.AttachmentGroup, v2OnlyNested.length / 4)}${v2OnlyNested}`;
  const stream = `${body}${wrappedV1Attachment}`;

  const parser = createParser({ attachmentDispatchMode: "strict" });
  const events = [...parser.feed(encode(stream)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(frames.length, 0);
  assertEquals(errors.length, 1);
  if (errors[0].type === "error") {
    assertEquals(errors[0].error.name, "UnknownCodeError");
    assertStringIncludes(errors[0].error.message, "Unsupported counter code");
  }
});

Deno.test("V-P1-010: latest genus-version inside wrapper payload controls subsequent nested groups", () => {
  const nestedV1 = `${counterV1(CtrDexV1.ControllerIdxSigs, 1)}${sigerToken()}`;
  const nestedV2 = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const payload = `${genusVersionCounter(1)}${nestedV1}${genusVersionCounter(2)}${nestedV2}`;
  const wrapper = wrapQuadletGroupV2(CtrDexV2.AttachmentGroup, payload);
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrapper}`;

  const parser = createParser({ attachmentDispatchMode: "strict" });
  const events = [...parser.feed(encode(stream)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  if (frames[0].type === "frame") {
    assertEquals(frames[0].frame.attachments.length, 1);
    const attachmentGroup = frames[0].frame.attachments[0];
    assertEquals(attachmentGroup.code, CtrDexV2.AttachmentGroup);
    assertEquals(attachmentGroup.items.length, 2);

    const first = attachmentGroup.items[0];
    const second = attachmentGroup.items[1];
    assertEquals(first instanceof CounterGroup, true);
    assertEquals(second instanceof CounterGroup, true);
    if (first instanceof CounterGroup && second instanceof CounterGroup) {
      assertEquals(first.name, "ControllerIdxSigs");
      assertEquals(first.code, CtrDexV1.ControllerIdxSigs);
      assertEquals(second.name, "ControllerIdxSigs");
      assertEquals(second.code, CtrDexV2.ControllerIdxSigs);
    }
  }
});
