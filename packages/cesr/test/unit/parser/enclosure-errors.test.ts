import { assertEquals, assertRejects } from "jsr:@std/assert";
import { DeserializeError, GroupSizeError, ParserError, UnknownCodeError } from "../../../src/core/errors.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { assertWireError } from "../../fixtures/parser-test-helpers.ts";
import { buildNestedMapBodyV2, parseFrames, splitIntoThirds } from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test("parser rejects opaque tail remainder inside AttachmentGroup wrapper payload", async () => {
  const nested = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const payload = `${nested}ABCD`; // valid nested group + opaque tail quadlet
  const wrappedAttachmentGroup = `${counterV2(CtrDexV2.AttachmentGroup, payload.length / 4)}${payload}`;
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}`;

  await assertWireError(() => parseFrames(encode(stream)), DeserializeError, "Invalid counter text input");
});

Deno.test("parser rejects a truncated native version prefix inside MapBodyGroup", async () => {
  const stream = `${CtrDexV2.MapBodyGroup}ABVAAA`; // The complete enclosure is too short for its native version prefix.
  await assertWireError(
    () => parseFrames(encode(stream)),
    GroupSizeError,
    "Incomplete field inside native body payload",
  );
});

Deno.test("parser rejects an invalid native version prefix inside MapBodyGroup", async () => {
  // The enclosed bytes fail the native version prefix before any map fields are read.
  const stream = `${CtrDexV2.MapBodyGroup}ACVAAA-KAB`;
  await assertWireError(() => parseFrames(encode(stream)), UnknownCodeError);
});

Deno.test(
  "malformed wrapper payload fails without publishing a partial frame",
  async () => {
    const nested = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
    const malformedPayload = `${nested}ABCD`;
    const wrappedAttachmentGroup = `${
      counterV2(CtrDexV2.AttachmentGroup, malformedPayload.length / 4)
    }${malformedPayload}`;
    const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

    await assertWireError(() => parseFrames(encode(stream)), DeserializeError);
  },
);

Deno.test(
  "invalid top-level MapBodyGroup still fails deterministically across chunk boundaries",
  async () => {
    const mapBody = buildNestedMapBodyV2();
    const bytes = encode(mapBody);
    // This vector is intentionally *not* a full top-level message. The point
    // of the regression is that chunking must not turn an invalid top-level
    // native map corpus into a partially accepted frame.
    const error = await assertWireError(() => parseFrames(bytes, splitIntoThirds(bytes)), ParserError);
    assertEquals(["DeserializeError", "UnknownCodeError"].includes(error.name), true);
  },
);
