import { assertEquals } from "jsr:@std/assert";
import { parseBytes } from "../../../src/parser/complete.ts";
import { Counter } from "../../../src/primitives/base/counter.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, counterV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Encode the complete versioned fixture for the progressive finite-input API. */
async function parseAll(stream: string) {
  return await parseBytes(encode(stream));
}

/** Encode an explicit stream genus independently of body protocol versions. */
function genusVersionCounter(major: 1 | 2, minor = 0): string {
  return new TextDecoder().decode(Counter.makeGVC({ major, minor }));
}

/** Declare the exact v2 payload extent in quadlets. */
function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

/** Supply a minimal opaque body whose wrapper selects v1 semantics. */
function v1OpaqueNonNativeFrame(): string {
  // `-W` is v1 NonNativeBodyGroup and expects count in quadlets.
  // `MAAA` is a fixed-size 4-char matter token payload.
  return `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
}

Deno.test("top-level genus-version counter persists stream version for subsequent frame parses", async () => {
  const v1Frame = v1OpaqueNonNativeFrame();
  const stream = `${genusVersionCounter(1)}${v1Frame}${v1Frame}`;
  const frames = await parseAll(stream);

  assertEquals(frames.length, 2);
  assertEquals(frames[0].body.pvrsn.major, 1);
  assertEquals(frames[1].body.pvrsn.major, 1);
});

Deno.test("BodyWithAttachmentGroup payload-leading genus-version applies only within enclosed frame", async () => {
  const enclosed = `${genusVersionCounter(1)}${v1OpaqueNonNativeFrame()}`;
  const wrapped = wrapQuadletGroupV2(
    CtrDexV2.BodyWithAttachmentGroup,
    enclosed,
  );
  const stream = `${wrapped}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  const frames = await parseAll(stream);

  assertEquals(frames.length, 2);

  // Enclosed override makes the wrapped frame parse as v1 context.
  assertEquals(frames[0].body.pvrsn.major, 1);
  // Outer stream context remains v2 for the following top-level frame.
  assertEquals(frames[1].body.pvrsn.major, 2);
  assertEquals(frames[1].body.ilk, "icp");
});

Deno.test("enclosed AttachmentGroup payload-leading genus-version overrides outer wrapper version for nested attachment parsing", async () => {
  const enclosedAttachments = `${genusVersionCounter(1)}${counterV1(CtrDexV1.ControllerIdxSigs, 1)}${sigerToken()}`;
  const wrappedAttachmentGroup = wrapQuadletGroupV2(
    CtrDexV2.AttachmentGroup,
    enclosedAttachments,
  );
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}`;
  const frames = await parseAll(stream);

  assertEquals(frames.length, 1);
  assertEquals(frames[0].attachments.length, 1);

  const attachment = frames[0].attachments[0];
  // Structural wrappers are consumed; only their v1 signature leaf is retained.
  assertEquals(attachment.code, CtrDexV1.ControllerIdxSigs);
  assertEquals(attachment.name, "ControllerIdxSigs");
  assertEquals(attachment.items.length, 1);
});
