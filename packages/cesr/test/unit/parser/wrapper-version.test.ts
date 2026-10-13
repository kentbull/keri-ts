import { assertEquals, assertRejects } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { parseFrames, splitIntoThirds } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Encode an explicit genus selector with both minor sextets. */
function genusVersionCounter(major: 1 | 2, minor = 0): string {
  return new TextDecoder().decode(Counter.makeGVC({ major, minor }));
}

/** Enclose aligned text in the requested v2 group counter. */
function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

Deno.test("GenericGroup enclosed genus-version override applies across multiple enclosed frames", async () => {
  const v1Frame = `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
  const genericPayload = `${genusVersionCounter(1)}${v1Frame}${v1Frame}`;
  const generic = wrapQuadletGroupV2(CtrDexV2.GenericGroup, genericPayload);
  const stream = `${generic}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

  const frames = await parseFrames(encode(stream));
  assertEquals(frames.length, 3);

  assertEquals(frames[0].body.pvrsn.major, 1);
  assertEquals(frames[1].body.pvrsn.major, 1);
  // GenericGroup override is enclosed-only; top-level context remains v2.
  assertEquals(frames[2].body.pvrsn.major, 2);
  assertEquals(frames[2].body.ilk, "icp");
});

Deno.test("parser rejects nested mixed-version wrapper groups that require fallback", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  // Use a v2-only counter token that fails immediately under v1 dispatch.
  const v2OnlyNested = counterV2(CtrDexV2.BigBlindedStateQuadruples, 1);
  const wrappedV1Attachment = `${counterV1(CtrDexV1.AttachmentGroup, v2OnlyNested.length / 4)}${v2OnlyNested}`;
  const stream = `${body}${wrappedV1Attachment}`;

  await assertRejects(() => parseFrames(encode(stream)), UnknownCodeError, "Unsupported counter code");
});

Deno.test("latest genus-version inside wrapper payload controls subsequent nested groups", async () => {
  const nestedV1 = `${counterV1(CtrDexV1.ControllerIdxSigs, 1)}${sigerToken()}`;
  const nestedV2 = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const payload = `${genusVersionCounter(1)}${nestedV1}${genusVersionCounter(2)}${nestedV2}`;
  const wrapper = wrapQuadletGroupV2(CtrDexV2.AttachmentGroup, payload);
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrapper}`;

  const frames = await parseFrames(encode(stream));
  assertEquals(frames.length, 1);
  // Progressive traversal exposes semantic leaves while keeping each leaf's selected genus.
  assertEquals(frames[0].attachments.map(({ name, code }) => [name, code]), [
    ["ControllerIdxSigs", CtrDexV1.ControllerIdxSigs],
    ["ControllerIdxSigs", CtrDexV2.ControllerIdxSigs],
  ]);
});

Deno.test(
  "alternating nested genus-version selectors preserve wrapper-local version context",
  async () => {
    const v1Opaque = `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
    const enclosedV1 = `${genusVersionCounter(1)}${v1Opaque}`;
    const wrappedV1 = counterV1(CtrDexV1.BodyWithAttachmentGroup, enclosedV1.length / 4) + enclosedV1;
    const payload = `${genusVersionCounter(1)}${v1Opaque}${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${
      genusVersionCounter(1)
    }${wrappedV1}${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const stream = wrapQuadletGroupV2(CtrDexV2.GenericGroup, payload);
    const input = encode(stream);
    const frames = await parseFrames(
      input,
      splitIntoThirds(input),
    );
    const majors = frames.map((frame) => frame.body.pvrsn.major);
    assertEquals(majors, [1, 2, 1, 2]);
  },
);

Deno.test(
  "legacy implicit-v1 outer frame followed by explicit selector wrapper preserves per-frame version context",
  async () => {
    // v1 wrapper intentionally carries explicit v2 selector + v2 body to lock
    // context transition behavior in mixed legacy/explicit streams.
    const v1WrapperPayload = `${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const explicitV2Wrapped = `${counterV1(CtrDexV1.GenericGroup, v1WrapperPayload.length / 4)}${v1WrapperPayload}`;
    const stream = `${(counterV1(CtrDexV1.NonNativeBodyGroup, 1) + "MAAA")}${explicitV2Wrapped}`;
    const frames = await parseFrames(
      encode(stream),
      splitIntoThirds(encode(stream)),
    );

    assertEquals(frames.length, 2);
    assertEquals(frames[0].body.pvrsn.major, 1);
    assertEquals(frames[1].body.pvrsn.major, 2);
  },
);

Deno.test(
  "selector inside attachment wrapper does not bleed into subsequent non-wrapper frame context",
  async () => {
    // Contract: selector contained inside attachment wrapper scope must not
    // alter subsequent top-level frame version resolution.
    const nestedSelectorAttachment = wrapQuadletGroupV2(
      CtrDexV2.AttachmentGroup,
      `${genusVersionCounter(1)}${counterV1(CtrDexV1.ControllerIdxSigs, 1)}${sigerToken()}`,
    );
    const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSelectorAttachment}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const frames = await parseFrames(encode(stream));

    assertEquals(frames.length, 2);
    assertEquals(frames[0].body.pvrsn.major, 2);
    assertEquals(frames[1].body.pvrsn.major, 2);
    assertEquals(frames[1].body.ilk, "icp");
  },
);
