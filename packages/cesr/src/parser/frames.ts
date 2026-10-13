import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import { ColdStartError, GroupSizeError, ShortageError } from "../core/errors.ts";
import type { CesrDomain, CesrFrame } from "../core/types.ts";
import { type Counter, decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseAttachments } from "./attachments.ts";
import { parseBody, readFrameCounter } from "./body.ts";
import { sniff } from "./cold-start.ts";
import {
  DEFAULT_GVRSN,
  FRAME_GROUPS,
  FRAME_LISTS,
  GENUS_VERSION_CODE,
  NATIVE_BODIES,
  WRAPPED_BODIES,
} from "./common.ts";

/** Parsed frame-start result consumed by top-level parser orchestration. */
export interface FrameStart {
  frame: CesrFrame;
  /** True only when an enclosure proves the entire frame is present. */
  complete?: boolean;
  /** Further complete frames from the same enclosure, in stream order. */
  siblings?: CesrFrame[];
  consumed: number;
  /** Genus used to decode this frame and its attachments. */
  gvrsn: Versionage;
  /** Explicit stream selection; null leaves subsequent frames in legacy inference mode. */
  streamGvrsn: Versionage | null;
}

/**
 * Parse one frame start from the current head.
 * Does not parse trailing top-level attachments.
 */
export function parseFrameStart(
  input: Uint8Array,
  inheritedGvrsn: Versionage | null = null,
): FrameStart {
  let offset = 0;
  let activeGvrsn = inheritedGvrsn;

  let cold = sniff(input.slice(offset));
  while (cold === "ano") {
    offset += 1;
    if (input.length <= offset) {
      throw new ShortageError(offset + 1, input.length);
    }
    cold = sniff(input.slice(offset));
  }

  if (cold === "txt" || cold === "bny") {
    const peek = parseCounter(input.slice(offset), activeGvrsn ?? DEFAULT_GVRSN, cold);
    if (peek.code === GENUS_VERSION_CODE) {
      offset += tokenSize(peek, cold);
      activeGvrsn = decodeGenusVersion(peek);
      if (input.length <= offset) {
        throw new ShortageError(offset + 1, input.length);
      }
      cold = sniff(input.slice(offset));
    }
  }

  if (cold === "msg") {
    const { body, consumed, gvrsn } = parseBody(input.subarray(offset), activeGvrsn);
    return {
      frame: { body, attachments: [] },
      consumed: offset + consumed,
      gvrsn,
      streamGvrsn: activeGvrsn,
    };
  }

  if (!isCesrDomain(cold)) {
    throw new ColdStartError(
      `Expected message or CESR body group at frame start but got ${cold}`,
    );
  }

  const {
    counter,
    gvrsn: frameGvrsn,
  } = readFrameCounter(
    input.slice(offset),
    activeGvrsn ?? DEFAULT_GVRSN,
    cold,
    activeGvrsn === null,
  );
  if (FRAME_GROUPS.has(counter.name)) {
    return parseEnclosedFrame(input, offset, counter, cold, frameGvrsn, activeGvrsn);
  }
  if (WRAPPED_BODIES.has(counter.name) || NATIVE_BODIES.has(counter.name)) {
    const { body, consumed, gvrsn } = parseBody(input.subarray(offset), frameGvrsn);
    return { frame: { body, attachments: [] }, consumed: offset + consumed, gvrsn, streamGvrsn: activeGvrsn };
  }
  if (FRAME_LISTS.has(counter.name)) {
    return parseEnclosedFrames(input, offset, counter, cold, frameGvrsn, activeGvrsn);
  }
  throw new ColdStartError(
    `Unsupported body-group counter at frame start: ${counter.code}`,
  );
}

/** Parse nested `BodyWithAttachmentGroup` payload as one complete enclosed frame. */
function parseEnclosedFrame(
  input: Uint8Array,
  offset: number,
  counter: Counter,
  cold: CesrDomain,
  gvrsn: Versionage,
  streamGvrsn: Versionage | null,
): FrameStart {
  const headerSize = tokenSize(counter, cold);
  const payloadSize = counter.count * unitBytes(cold);
  const total = headerSize + payloadSize;
  if (input.length < offset + total) {
    throw new ShortageError(offset + total, input.length);
  }
  const payload = input.slice(offset + headerSize, offset + total);
  let nested: ReturnType<typeof parseFrame>;
  try {
    nested = parseFrame(payload, gvrsn);
  } catch (error) {
    if (error instanceof ShortageError) throw new GroupSizeError("Incomplete frame inside BodyWithAttachmentGroup");
    throw error;
  }
  if (nested.consumed !== payload.length) {
    throw new ColdStartError(
      "BodyWithAttachmentGroup payload did not parse to a complete frame",
    );
  }
  return {
    frame: nested.frame,
    complete: true,
    consumed: offset + total,
    gvrsn,
    streamGvrsn,
  };
}

/**
 * Parse bounded `GenericGroup` payload into enclosed frames.
 * Returns the first complete frame and its ordered siblings.
 */
function parseEnclosedFrames(
  input: Uint8Array,
  offset: number,
  counter: Counter,
  cold: CesrDomain,
  gvrsn: Versionage,
  streamGvrsn: Versionage | null,
): FrameStart {
  const headerSize = tokenSize(counter, cold);
  const payloadSize = counter.count * unitBytes(cold);
  const total = headerSize + payloadSize;
  if (input.length < offset + total) {
    throw new ShortageError(offset + total, input.length);
  }

  const payload = input.slice(offset + headerSize, offset + total);
  let frames: CesrFrame[];
  try {
    frames = parseFrames(payload, gvrsn);
  } catch (error) {
    if (error instanceof ShortageError) throw new GroupSizeError("Incomplete frame inside GenericGroup");
    throw error;
  }
  if (frames.length === 0) {
    throw new ColdStartError(
      "GenericGroup payload contained no enclosed frames",
    );
  }

  const [first, ...rest] = frames;

  return {
    frame: first,
    complete: true,
    siblings: rest,
    consumed: offset + total,
    gvrsn,
    streamGvrsn,
  };
}

/** Parse all enclosed frames inside a bounded payload slice, in order. */
function parseFrames(
  input: Uint8Array,
  inheritedGvrsn: Versionage | null,
): CesrFrame[] {
  const out: CesrFrame[] = [];
  let offset = 0;
  let activeGvrsn = inheritedGvrsn;

  while (offset < input.length) {
    while (offset < input.length && sniff(input.slice(offset)) === "ano") {
      offset += 1;
    }
    if (offset >= input.length) {
      break;
    }

    const base = parseFrameStart(input.slice(offset), activeGvrsn);
    offset += base.consumed;
    if (base.complete) {
      out.push(base.frame, ...(base.siblings ?? []));
      activeGvrsn = base.streamGvrsn;
      continue;
    }

    const { attachments, consumed } = parseAttachments(input.slice(offset), base.gvrsn, base.frame.attachments, true);
    offset += consumed;

    out.push({
      body: base.frame.body,
      attachments,
    });
    activeGvrsn = base.streamGvrsn;
  }

  return out;
}

/** Parse one complete frame from a bounded slice, including trailing attachments. */
function parseFrame(
  input: Uint8Array,
  inheritedGvrsn: Versionage | null = null,
): { frame: CesrFrame; consumed: number } {
  const base = parseFrameStart(input, inheritedGvrsn);
  if (base.complete) {
    if (base.siblings?.length) throw new ColdStartError("Expected one enclosed frame");
    return { frame: base.frame, consumed: base.consumed };
  }
  const { attachments, consumed } = parseAttachments(
    input.slice(base.consumed),
    base.gvrsn,
    base.frame.attachments,
    true,
  );

  return {
    frame: { body: base.frame.body, attachments },
    consumed: base.consumed + consumed,
  };
}
