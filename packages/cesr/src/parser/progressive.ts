import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import { ColdStartError, GroupSizeError, ResourceLimitError, ShortageError } from "../core/errors.ts";
import type { CesrFrame } from "../core/types.ts";
import { decodeGenusVersion } from "../primitives/counter.ts";
import { smell } from "../serder/smell.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseAttachmentGroup, startsFrame } from "./attachments.ts";
import { sniff } from "./cold-start.ts";
import { DEFAULT_GVRSN, FRAME_GROUPS, FRAME_LISTS, FRAME_STARTS, GENUS_VERSION_CODE } from "./common.ts";
import { Cursor, type CursorOptions } from "./cursor.ts";
import { parseFrameStart, readFrameCounter } from "./frames.ts";

/** Resource limits and cancellation for one progressive stream invocation. */
export interface ParseOptions extends CursorOptions {
  /** Admission limit for one materialized body and its attachments, excluding outer wrappers. */
  maxFrameBytes?: number;
}

/** Consume already inspected bytes without copying their remaining suffix. */
async function consume(input: Cursor, size: number): Promise<void> {
  while (size > 0) size -= (await input.take(size)).length;
}

/** Probe a small header or admitted attachment until its declared input is available. */
async function peek<T>(input: Cursor, decode: (bytes: Uint8Array) => T, limit = Infinity): Promise<T> {
  let size = 1;
  while (true) {
    if (size > limit) throw new ResourceLimitError("Frame exceeds materialization limit", input.offset);
    const bytes = await input.peek(size);
    try {
      return decode(bytes);
    } catch (error) {
      if (!(error instanceof ShortageError)) throw error;
      // Nested readers report shortage relative to their own unconsumed tail.
      size += Math.max(1, error.needed - error.available);
    }
  }
}

/** Locate a message header without requiring bytes beyond a short valid body. */
async function messageSize(input: Cursor): Promise<number> {
  let size = Math.min(64, input.remaining, Math.max(1, input.bufferedBytes));
  while (true) {
    const bytes = await input.peek(size);
    try {
      return smell(bytes).smellage.size;
    } catch (error) {
      if (!(error instanceof ShortageError)) throw error;
      // smell's 64-byte search window is not the minimum valid message size.
      size++;
    }
  }
}

/** Skip presentation separators without treating them as a frame boundary. */
async function separators(input: Cursor): Promise<void> {
  while (!await input.atEnd() && sniff(await input.peek(1)) === "ano") await consume(input, 1);
}

/** Collect a frame's attachments until its own completion boundary is proven. */
async function attachments(
  input: Cursor,
  frame: CesrFrame,
  gvrsn: Versionage,
  start: number,
  limit: number,
): Promise<void> {
  while (true) {
    await separators(input);
    if (await input.atEnd()) return;
    const domain = sniff(await input.peek(1));
    if (domain === "msg") return;
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported attachment cold code ${domain}`);
    if (await peek(input, (bytes) => startsFrame(bytes, gvrsn, domain))) return;
    const remaining = limit - (input.offset - start);
    const parsed = await peek(input, (bytes) => parseAttachmentGroup(bytes, gvrsn, domain), remaining);
    await consume(input, parsed.consumed);
    frame.attachments.push(parsed.group);
    if (parsed.group.name === "AttachmentGroup" || parsed.group.name === "BigAttachmentGroup") return;
  }
}

/** Verify a single-frame wrapper entirely before its one result may escape. */
async function oneFrame(input: Cursor, gvrsn: Versionage, limit: number): Promise<CesrFrame> {
  const nested = frames(input, gvrsn, limit);
  try {
    const first = await nested.next();
    if (first.done) throw new ColdStartError("BodyWithAttachmentGroup contained no frame");
    if (!(await nested.next()).done) throw new ColdStartError("BodyWithAttachmentGroup contained more than one frame");
    input.expectEnd();
    return first.value;
  } finally {
    await nested.return(0);
  }
}

/** Parse one scope; generator locals retain genus and progress across input waits. */
async function* frames(input: Cursor, inherited: Versionage | null, limit: number): AsyncGenerator<CesrFrame, number> {
  let selected = inherited;
  let count = 0;
  let needsBody = false;
  while (true) {
    await separators(input);
    if (await input.atEnd()) {
      if (needsBody) await input.peek(1);
      return count;
    }
    const start = input.offset;
    const domain = sniff(await input.peek(1));
    if (domain === "msg") {
      needsBody = false;
      const size = await messageSize(input);
      if (size > limit) throw new ResourceLimitError("Body exceeds frame limit", input.offset);
      const base = parseFrameStart(await input.peek(size), selected);
      await consume(input, base.consumed);
      await attachments(input, base.frame, base.gvrsn, start, limit);
      count++;
      yield base.frame;
      continue;
    }
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported frame cold code ${domain}`);
    const { counter, gvrsn } = await peek(
      input,
      (bytes) => readFrameCounter(bytes, selected ?? DEFAULT_GVRSN, domain, selected === null),
    );
    const headerSize = tokenSize(counter, domain);
    if (counter.code === GENUS_VERSION_CODE) {
      selected = decodeGenusVersion(counter);
      await consume(input, headerSize);
      // A selector does not itself form a frame; EOF here remains incomplete.
      needsBody = true;
      continue;
    }
    needsBody = false;
    const payloadSize = counter.count * unitBytes(domain);
    if (FRAME_LISTS.has(counter.name) || FRAME_GROUPS.has(counter.name)) {
      await consume(input, headerSize);
      const scope = input.scope(payloadSize);
      if (FRAME_LISTS.has(counter.name)) {
        const children = yield* frames(scope, gvrsn, limit);
        scope.expectEnd();
        if (children === 0) throw new ColdStartError("GenericGroup contained no frames");
        count += children;
      } else {
        const frame = await oneFrame(scope, gvrsn, limit);
        count++;
        yield frame;
      }
      continue;
    }
    if (!FRAME_STARTS.has(counter.name)) {
      throw new ColdStartError(`Unsupported body-group counter at frame start: ${counter.code}`);
    }
    // Bodies are admitted finite values; Serder keeps authority over hydration.
    const size = headerSize + payloadSize;
    if (size > limit) throw new ResourceLimitError("Body exceeds frame limit", input.offset);
    const base = parseFrameStart(await input.peek(size), gvrsn);
    if (base.consumed !== size) throw new GroupSizeError("Body did not consume its declared extent", input.offset);
    await consume(input, size);
    await attachments(input, base.frame, base.gvrsn, start, limit);
    count++;
    yield base.frame;
  }
}

/**
 * Parse a byte source progressively, yielding complete children before their
 * enclosing GenericGroup finishes. Earlier frames survive a later parse error.
 *
 * Pulling a result supplies output credit; source EOF closes an open frame.
 * Use a signal-aware source with `signal` to cancel pending I/O. The invocation
 * closes its source on completion, failure, or consumer return.
 */
export async function* parse(
  source: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): AsyncGenerator<CesrFrame> {
  const limit = options.maxFrameBytes ?? 8 * 1024 ** 2;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Frame limit must be a positive safe integer");
  const input = new Cursor(source, options);
  try {
    yield* frames(input, null, limit);
  } finally {
    await input.close();
  }
}
