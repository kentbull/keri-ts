/** Finite CESR decoding. Counted scopes are complete before any child is decoded. */
import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import { ColdStartError, GroupSizeError, ShortageError } from "../core/errors.ts";
import type { CesrFrame } from "../core/types.ts";
import { decodeGenusVersion, parseCounter } from "../primitives/base/counter.ts";
import { Texter } from "../primitives/values/texter.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseAttachmentGroup, startsFrame } from "./attachments.ts";
import { parseBody, readFrameCounter } from "./body.ts";
import { sniff } from "./cold-start.ts";
import { DEFAULT_GVRSN, FRAME_GROUPS, FRAME_LISTS, FRAME_STARTS, GENUS_VERSION_CODE } from "./common.ts";

/** Root selectors persist between messages; child scopes cannot change their parent. */
interface DecodedExtent {
  consumed: number;
  selected: Versionage | null;
}

/** Advance over presentation separators without inventing a message boundary. */
function separators(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length && sniff(bytes.subarray(offset)) === "ano") offset++;
  return offset;
}

/** Translate a finite reader's shortage to the enclosing byte range. */
function at<T>(bytes: Uint8Array, offset: number, read: (tail: Uint8Array) => T): T {
  try {
    return read(bytes.subarray(offset));
  } catch (error) {
    if (error instanceof ShortageError) throw new ShortageError(offset + error.needed, offset + error.available);
    throw error;
  }
}

/** Require a declared extent before entering it. */
function extent(bytes: Uint8Array, offset: number, size: number): Uint8Array {
  if (size > bytes.length - offset) throw new ShortageError(offset + size, bytes.length);
  return bytes.subarray(offset, offset + size);
}

/** Decode already received enclosure bytes; an inner shortage is malformed wire. */
function* enclosed(
  bytes: Uint8Array,
  selected: Versionage,
  onDecodeFailure: (error: unknown) => void,
  owned = false,
): Generator<CesrFrame> {
  let offset = 0;
  try {
    while (offset < bytes.length) {
      const unit = decodeNext(bytes.subarray(offset), selected, true, onDecodeFailure, owned);
      const result = yield* unit;
      offset += result.consumed;
      selected = result.selected ?? selected;
    }
  } catch (error) {
    if (error instanceof ShortageError) throw new GroupSizeError("Incomplete item inside a complete enclosure");
    throw error;
  }
}

/** Read a single-frame wrapper completely before returning its parent-owned value. */
function oneFrame(bytes: Uint8Array, selected: Versionage, onDecodeFailure: (error: unknown) => void): CesrFrame {
  const children = enclosed(bytes, selected, onDecodeFailure, true);
  const first = children.next();
  if (first.done) throw new ColdStartError("BodyWithAttachmentGroup contained no frame");
  if (!children.next().done) throw new ColdStartError("BodyWithAttachmentGroup contained more than one frame");
  return first.value;
}

/** Hydrate attachment leaves and nested evidence within a finite local range. */
function attachments(
  bytes: Uint8Array,
  frame: CesrFrame,
  gvrsn: Versionage,
  eof: boolean,
  onDecodeFailure: (error: unknown) => void,
  enclosedScope = false,
  insideAttachmentGroup = false,
): number {
  let offset = 0;
  while (true) {
    offset = separators(bytes, offset);
    if (offset === bytes.length) {
      if (!eof) throw new ShortageError(offset + 1, bytes.length);
      return offset;
    }
    const domain = sniff(bytes.subarray(offset));
    if (domain === "msg" && !enclosedScope) return offset;
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported attachment cold code ${domain}`);
    if (!enclosedScope && at(bytes, offset, (tail) => startsFrame(tail, gvrsn, domain))) return offset;
    const counter = at(bytes, offset, (tail) => parseCounter(tail, gvrsn, domain));
    const header = tokenSize(counter, domain);
    if (counter.code === GENUS_VERSION_CODE && enclosedScope) {
      gvrsn = decodeGenusVersion(counter);
      offset += header;
      continue;
    }
    if (enclosedScope && FRAME_STARTS.has(counter.name)) {
      if (FRAME_LISTS.has(counter.name)) throw new ColdStartError("GenericGroup cannot be a nested message attachment");
      const unit = decodeNext(bytes.subarray(offset), gvrsn, true, onDecodeFailure);
      const child = unit.next();
      if (child.done) throw new ColdStartError("Expected nested message");
      (frame.nests ??= []).push(child.value);
      const end = unit.next();
      if (!end.done) throw new ColdStartError("Expected one nested message");
      offset += end.value.consumed;
      continue;
    }
    if (counter.name === "AttachmentGroup" || counter.name === "BigAttachmentGroup") {
      const size = counter.count * unitBytes(domain);
      const payload = extent(bytes, offset + header, size);
      try {
        if (attachments(payload, frame, gvrsn, true, onDecodeFailure, true, true) !== size) {
          throw new GroupSizeError("Attachment group was not exhausted");
        }
      } catch (error) {
        if (error instanceof ShortageError) throw new GroupSizeError("Incomplete item inside AttachmentGroup");
        throw error;
      }
      offset += header + size;
      if (!insideAttachmentGroup) return offset;
      continue;
    }
    const parsed = at(bytes, offset, (tail) => parseAttachmentGroup(tail, gvrsn, domain));
    offset += parsed.consumed;
    if (counter.name === "ESSRPayloadGroup" || counter.name === "BigESSRPayloadGroup") {
      const texters = frame.essrs ??= [];
      for (const item of parsed.group.items) texters.push(item as Texter);
    } else frame.attachments.push(parsed.group);
  }
}

/** Decode one root message or complete group, leaving incomplete network input untouched. */
export function* decodeNext(
  bytes: Uint8Array,
  selected: Versionage | null,
  eof: boolean,
  onDecodeFailure: (error: unknown) => void,
  owned = false,
): Generator<CesrFrame, DecodedExtent> {
  let offset = 0;
  let needsBody = false;
  let bodyGenus: Versionage | null = null;
  while (true) {
    offset = separators(bytes, offset);
    if (offset === bytes.length) {
      if (needsBody) throw new ShortageError(offset + 1, bytes.length);
      return { consumed: offset, selected };
    }
    const domain = sniff(bytes.subarray(offset));
    if (domain === "msg") break;
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported frame cold code ${domain}`);
    const { counter, gvrsn } = at(
      bytes,
      offset,
      (tail) => readFrameCounter(tail, selected ?? DEFAULT_GVRSN, domain, selected === null),
    );
    const header = tokenSize(counter, domain);
    if (counter.code === GENUS_VERSION_CODE) {
      selected = decodeGenusVersion(counter);
      offset += header;
      needsBody = true;
      continue;
    }
    if (FRAME_LISTS.has(counter.name) || FRAME_GROUPS.has(counter.name)) {
      const size = counter.count * unitBytes(domain);
      const payload = extent(bytes, offset + header, size);
      if (FRAME_LISTS.has(counter.name)) {
        let count = 0;
        for (const child of enclosed(payload, gvrsn, onDecodeFailure)) {
          count++;
          yield child;
        }
        if (!count) throw new ColdStartError("GenericGroup contained no frames");
      } else yield oneFrame(payload, gvrsn, onDecodeFailure);
      return { consumed: offset + header + size, selected };
    }
    if (!FRAME_STARTS.has(counter.name)) {
      throw new ColdStartError(`Unsupported body-group counter at frame start: ${counter.code}`);
    }
    // Native/wrapped body bytes must all be present before hydration.
    extent(bytes, offset, header + counter.count * unitBytes(domain));
    bodyGenus = gvrsn;
    break;
  }
  const base = at(bytes, offset, (tail) => parseBody(tail, bodyGenus ?? selected, onDecodeFailure));
  offset += base.consumed;
  const frame: CesrFrame = { body: base.body, attachments: [], gvrsn: base.gvrsn };
  offset += at(bytes, offset, (tail) => attachments(tail, frame, base.gvrsn, eof, onDecodeFailure, owned));
  yield frame;
  return { consumed: offset, selected };
}
