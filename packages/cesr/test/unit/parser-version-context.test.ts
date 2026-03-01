import { assert, assertEquals } from "jsr:@std/assert";
import {
  createParser,
  type ParserOptions,
} from "../../src/core/parser-engine.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import { annotate, CesrFrame } from "../../src/index.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function parseAll(
  stream: string,
  options?: ParserOptions,
): CesrFrame[] {
  const parser = createParser(options);
  return [...parser.feed(encode(stream)), ...parser.flush()];
}

function counterV1(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V1.get(code);
  if (!sizage) throw new Error(`Unknown v1 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown v2 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function genusVersionCounter(major: 1 | 2, minor = 0): string {
  const patch = 0;
  return `${CtrDexV2.KERIACDCGenusVersion}${intToB64(major, 1)}${
    intToB64(minor, 1)
  }${intToB64(patch, 1)}`;
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

function v1OpaqueNonNativeFrame(): string {
  // `-W` is v1 NonNativeBodyGroup and expects count in quadlets.
  // `MAAA` is a fixed-size 4-char matter token payload.
  return `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
}

Deno.test("V-P0-003: top-level genus-version counter persists stream version for subsequent frame parses", () => {
  const v1Frame = v1OpaqueNonNativeFrame();
  const stream = `${genusVersionCounter(1)}${v1Frame}${v1Frame}`;
  const out = parseAll(stream);

  const errors = out.filter((event) => event.type === "error");
  const frames = out.filter((event) => event.type === "frame");
  assertEquals(errors.length, 0);
  assertEquals(frames.length, 2);
  assertEquals(frames[0].frame.body.pvrsn.major, 1);
  assertEquals(frames[1].frame.body.pvrsn.major, 1);
});

Deno.test("V-P0-004: BodyWithAttachmentGroup payload-leading genus-version applies only within enclosed frame", () => {
  const enclosed = `${genusVersionCounter(1)}${v1OpaqueNonNativeFrame()}`;
  const wrapped = wrapQuadletGroupV2(
    CtrDexV2.BodyWithAttachmentGroup,
    enclosed,
  );
  const stream = `${wrapped}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  const out = parseAll(stream);

  const errors = out.filter((event) => event.type === "error");
  const frames = out.filter((event) => event.type === "frame");
  assertEquals(errors.length, 0);
  assertEquals(frames.length, 2);

  // Enclosed override makes the wrapped frame parse as v1 context.
  assertEquals(frames[0].frame.body.pvrsn.major, 1);
  // Outer stream context remains v2 for the following top-level frame.
  assertEquals(frames[1].frame.body.pvrsn.major, 2);
  assertEquals(frames[1].frame.body.ilk, "icp");
});

Deno.test("V-P0-005: enclosed AttachmentGroup payload-leading genus-version overrides outer wrapper version for nested attachment parsing", () => {
  const enclosedAttachments = `${genusVersionCounter(1)}${
    counterV1(CtrDexV1.ControllerIdxSigs, 1)
  }${sigerToken()}`;
  const wrappedAttachmentGroup = wrapQuadletGroupV2(
    CtrDexV2.AttachmentGroup,
    enclosedAttachments,
  );
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}`;
  const out = parseAll(stream, { attachmentDispatchMode: "strict" });

  const errors = out.filter((event) => event.type === "error");
  const frames = out.filter((event) => event.type === "frame");
  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].frame.attachments.length, 1);

  const attachment = frames[0].frame.attachments[0];
  assertEquals(attachment.code, CtrDexV2.AttachmentGroup);
  assertEquals(
    attachment.items.some(
      (item) => item.kind === "group" && item.name === "KERIACDCGenusVersion",
    ),
    false,
  );

  const nestedControllerSigs = attachment.items.find(
    (item) =>
      item.kind === "group" &&
      item.name === "ControllerIdxSigs" &&
      item.code === CtrDexV1.ControllerIdxSigs,
  );
  assert(nestedControllerSigs);
});
