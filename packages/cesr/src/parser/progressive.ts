import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import { ColdStartError, GroupSizeError, ResourceLimitError, ShortageError } from "../core/errors.ts";
import type { CesrFrame } from "../core/types.ts";
import { decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import { smell } from "../serder/smell.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseAttachmentGroup, startsFrame } from "./attachments.ts";
import { sniff } from "./cold-start.ts";
import { DEFAULT_GVRSN, FRAME_GROUPS, FRAME_LISTS, FRAME_STARTS, GENUS_VERSION_CODE } from "./common.ts";
import { Cursor, type CursorOptions } from "./cursor.ts";
import { essrFactory, type EssrOptions, type EssrWriter } from "./essr.ts";
import { parseFrameStart, readFrameCounter } from "./frames.ts";

/** Resource limits and cancellation for one progressive stream invocation. */
export interface ParseOptions extends CursorOptions, EssrOptions {
  /** Resident body and ordinary attachment byte limit; streamed ESSR is budgeted separately. */
  maxFrameBytes?: number;
  /** Maximum retained ordinary attachment leaves per frame; default 4,096. */
  maxAttachmentGroups?: number;
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

/** A draft retains stage ownership until the outermost public delivery. */
interface Draft {
  /** Hydrated body and bounded ordinary attachment leaves awaiting public delivery. */
  frame: CesrFrame;
  /** Frame genus remains independent of temporary attachment-wrapper selectors. */
  gvrsn: Versionage;
  /** Admitted body/ordinary wire bytes, excluding externally staged ESSR. */
  resident: number;
  /** Shared unfinished stage for every ESSR group encountered in this frame. */
  writer?: EssrWriter;
}

/** Invocation ownership stays bounded by nesting, never by delivered sibling count. */
interface Session {
  /** Maximum admitted body plus ordinary attachment bytes for one frame. */
  limit: number;
  /** Maximum retained leaf objects, including zero-item groups. */
  maxGroups: number;
  /** Open a finite stage only when the frame actually contains ESSR. */
  create: (gvrsn: Versionage) => Promise<EssrWriter>;
  /** Every unfinished candidate stage, including children held by oneFrame validation. */
  pending: Set<EssrWriter>;
}

/** Structural attachment scopes are traversed, never retained as giant raw containers. */
const WRAPPERS = new Set([
  "AttachmentGroup",
  "BigAttachmentGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

/** Read semantic leaves in order, flattening wrappers instead of retaining their raw payload. */
async function attachments(
  input: Cursor,
  draft: Draft,
  gvrsn: Versionage,
  session: Session,
  enclosed = false,
): Promise<void> {
  while (true) {
    await separators(input);
    if (await input.atEnd()) return;
    const domain = sniff(await input.peek(1));
    if (domain === "msg" && !enclosed) return;
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported attachment cold code ${domain}`);
    if (!enclosed && await peek(input, (bytes) => startsFrame(bytes, gvrsn, domain))) return;
    // Read only this selected-genus counter before choosing staged or finite hydration.
    const counter = await peek(input, (bytes) => parseCounter(bytes, gvrsn, domain));
    // Counter header size follows the incoming text/binary domain.
    const header = tokenSize(counter, domain);
    if (counter.code === GENUS_VERSION_CODE && enclosed) {
      gvrsn = decodeGenusVersion(counter);
      await consume(input, header);
      continue;
    }
    if (WRAPPERS.has(counter.name)) {
      await consume(input, header);
      // Wrapper bounds and genus changes remain local to the recursive call.
      const scope = input.scope(counter.count * unitBytes(domain));
      await attachments(scope, draft, gvrsn, session, true);
      scope.expectEnd();
      if (!enclosed && counter.name.includes("AttachmentGroup")) return;
      continue;
    }
    if (counter.name === "ESSRPayloadGroup" || counter.name === "BigESSRPayloadGroup") {
      await consume(input, header);
      if (!draft.writer) {
        draft.writer = await session.create(draft.gvrsn);
        session.pending.add(draft.writer);
      }
      await draft.writer.read(input, counter, gvrsn, domain);
      continue;
    }
    if (draft.frame.attachments.length >= session.maxGroups) {
      throw new ResourceLimitError("Frame exceeds attachment group limit", input.offset);
    }
    // Previously admitted leaves reduce the same frame-wide byte budget.
    const remaining = session.limit - draft.resident;
    // Ordinary semantic groups remain bounded hydrated values under the existing dispatcher.
    const parsed = await peek(input, (bytes) => parseAttachmentGroup(bytes, gvrsn, domain), remaining);
    await consume(input, parsed.consumed);
    draft.resident += parsed.consumed;
    draft.frame.attachments.push(parsed.group);
  }
}

/** Verify a single-frame wrapper entirely before its one result may escape. */
async function oneFrame(input: Cursor, gvrsn: Versionage, session: Session): Promise<Draft> {
  const nested = frames(input, gvrsn, session);
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
async function* frames(input: Cursor, inherited: Versionage | null, session: Session): AsyncGenerator<Draft, number> {
  const limit = session.limit;
  // A selector belongs to this enclosure; recursive children inherit but cannot overwrite it.
  let selected = inherited;
  // The returned child count rejects empty GenericGroups without retaining siblings.
  let count = 0;
  // A trailing genus selector is incomplete even at otherwise clean source EOF.
  let needsBody = false;
  while (true) {
    await separators(input);
    if (await input.atEnd()) {
      if (needsBody) await input.peek(1);
      return count;
    }
    const domain = sniff(await input.peek(1));
    if (domain === "msg") {
      needsBody = false;
      const size = await messageSize(input);
      if (size > limit) throw new ResourceLimitError("Body exceeds frame limit", input.offset);
      const base = parseFrameStart(await input.peek(size), selected);
      await consume(input, base.consumed);
      // Keep stage ownership separate from the public frame until its boundary is proven.
      const draft = { frame: base.frame, gvrsn: base.gvrsn, resident: size };
      await attachments(input, draft, base.gvrsn, session);
      count++;
      yield draft;
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
    // Counted frame enclosures use quadlets in text and triplets in binary.
    const payloadSize = counter.count * unitBytes(domain);
    if (FRAME_LISTS.has(counter.name) || FRAME_GROUPS.has(counter.name)) {
      await consume(input, headerSize);
      const scope = input.scope(payloadSize);
      if (FRAME_LISTS.has(counter.name)) {
        const children = yield* frames(scope, gvrsn, session);
        scope.expectEnd();
        if (children === 0) throw new ColdStartError("GenericGroup contained no frames");
        count += children;
      } else {
        const frame = await oneFrame(scope, gvrsn, session);
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
    // Native bodies use the same ownership boundary as non-native messages.
    const draft = { frame: base.frame, gvrsn: base.gvrsn, resident: size };
    await attachments(input, draft, base.gvrsn, session);
    count++;
    yield draft;
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
  // Empty attachment groups require an object-count cap in addition to the byte cap.
  const maxGroups = options.maxAttachmentGroups ?? 4096;
  if (!Number.isSafeInteger(maxGroups) || maxGroups < 0) {
    throw new RangeError("Attachment group limit must be a non-negative safe integer");
  }
  // One invocation owns every stage that has not crossed the public yield below.
  const session: Session = { limit, maxGroups, create: essrFactory(options, options.signal), pending: new Set() };
  const input = new Cursor(source, options);
  try {
    for await (const draft of frames(input, null, session)) {
      if (draft.writer) {
        // Internal yields are still parser-owned; only this public yield transfers ownership.
        draft.frame.essr = await draft.writer.finish();
        try {
          options.signal?.throwIfAborted();
        } catch (error) {
          // Cancellation during finish occurs before the consumer owns the completed payload.
          await draft.frame.essr.discard();
          throw error;
        }
        session.pending.delete(draft.writer);
      }
      yield draft.frame;
    }
  } finally {
    try {
      // Includes every candidate held while oneFrame checks for an illegal second child.
      await Promise.all(Array.from(session.pending, (writer) => writer.abort()));
    } finally {
      await input.close();
    }
  }
}
