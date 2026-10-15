import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import {
  ColdStartError,
  GroupSizeError,
  ParserError,
  ShortageError,
  WireParseError,
} from "../core/errors.ts";
import type { CesrFrame, EssrPayload } from "../core/types.ts";
import { decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import { smell } from "../serder/smell.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseAttachmentGroup, startsFrame } from "./attachments.ts";
import { parseBody, readFrameCounter } from "./body.ts";
import { sniff } from "./cold-start.ts";
import { DEFAULT_GVRSN, FRAME_GROUPS, FRAME_LISTS, FRAME_STARTS, GENUS_VERSION_CODE } from "./common.ts";
import { Cursor, type CursorOptions } from "./cursor.ts";
import { essrFactory, type EssrOptions, type EssrWriter } from "./essr.ts";

/** Source cancellation, actual staging, and optional intrinsic-wire classification. */
export interface ParseOptions extends CursorOptions, EssrOptions {
  /** Source, sink, decoder infrastructure and cleanup failures retain their identity. */
  classifyWireErrors?: boolean;
}

/** Consume already inspected bytes without copying their remaining suffix. */
async function consume(input: Cursor, size: number): Promise<void> {
  while (size > 0) size -= (await input.take(size)).length;
}

/** Probe a small header or attachment until its declared input is available. */
async function peek<T>(input: Cursor, decode: (bytes: Uint8Array) => T): Promise<T> {
  let size = 1;
  while (true) {
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

/** A frame under construction or enclosure validation; its stages stay parser-owned until delivery. */
interface PendingFrame {
  /** Hydrated body and ordinary attachment leaves awaiting public delivery. */
  frame: CesrFrame;
  /** Frame genus remains independent of temporary attachment-wrapper selectors. */
  gvrsn: Versionage;
  /** Pending descendants retain their own writers until root delivery. */
  nests: PendingFrame[];
  /** Shared unfinished stage for every ESSR group encountered in this frame. */
  writer?: EssrWriter;
}

/** Actual stage ownership and decoder provenance for one parse invocation. */
interface ParseContext {
  /** Preserve unexpected decoder failures outside this invocation's wire classification. */
  onDecodeFailure: (error: unknown) => void;
  /** Open staging only when a frame actually contains ESSR. */
  openEssr: (gvrsn: Versionage) => Promise<EssrWriter>;
  /** Every unfinished candidate stage, including children held by oneFrame validation. */
  stages: Set<EssrWriter>;
  /** Finished owners remain parser-owned until every descendant finishes. */
  owners: Set<EssrPayload>;
}

/** Structural attachment scopes are traversed, never retained as giant raw containers. */
const WRAPPERS = new Set([
  "AttachmentGroup",
  "BigAttachmentGroup",
]);

/** Read ordinary leaves and owned child messages within their enclosing attachment scope. */
async function attachments(
  input: Cursor,
  pending: PendingFrame,
  gvrsn: Versionage,
  context: ParseContext,
  enclosed = false,
  insideAttachmentGroup = false,
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
    if (enclosed && FRAME_STARTS.has(counter.name)) {
      if (FRAME_LISTS.has(counter.name)) {
        throw new ColdStartError("GenericGroup cannot be a nested message attachment");
      }
      // Read exactly one child with the same stage owner; its own enclosure owns grandchildren.
      const children = frames(input, gvrsn, context);
      try {
        const child = await children.next();
        if (child.done) throw new ColdStartError("Expected nested message");
        pending.nests.push(child.value);
        (pending.frame.nests ??= []).push(child.value.frame);
      } finally {
        await children.return(0);
      }
      continue;
    }
    if (WRAPPERS.has(counter.name)) {
      await consume(input, header);
      // Wrapper bounds and genus changes remain local to the recursive call.
      const scope = input.scope(counter.count * unitBytes(domain));
      await attachments(scope, pending, gvrsn, context, true, true);
      scope.expectEnd();
      // An explicit attachment enclosure closes this message, even inside a body wrapper.
      if (!insideAttachmentGroup) return;
      continue;
    }
    if (counter.name === "ESSRPayloadGroup" || counter.name === "BigESSRPayloadGroup") {
      await consume(input, header);
      if (!pending.writer) {
        pending.writer = await context.openEssr(pending.gvrsn);
        context.stages.add(pending.writer);
      }
      await pending.writer.read(input, counter, gvrsn, domain);
      continue;
    }
    const parsed = await peek(input, (bytes) => parseAttachmentGroup(bytes, gvrsn, domain));
    await consume(input, parsed.consumed);
    pending.frame.attachments.push(parsed.group);
  }
}

/** Verify a single-frame wrapper entirely before its one result may escape. */
async function oneFrame(
  input: Cursor,
  gvrsn: Versionage,
  context: ParseContext,
): Promise<PendingFrame> {
  const nested = frames(input, gvrsn, context, true);
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
async function* frames(
  input: Cursor,
  inherited: Versionage | null,
  context: ParseContext,
  enclosed = false,
): AsyncGenerator<PendingFrame, number> {
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
      const base = parseBody(await input.peek(size), selected, context.onDecodeFailure);
      await consume(input, base.consumed);
      // Keep stage ownership separate from the public frame until its boundary is proven.
      const pending: PendingFrame = {
        frame: { body: base.body, attachments: [], gvrsn: base.gvrsn },
        gvrsn: base.gvrsn,
        nests: [],
      };
      await attachments(input, pending, base.gvrsn, context, enclosed);
      count++;
      yield pending;
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
        const children = yield* frames(scope, gvrsn, context);
        scope.expectEnd();
        if (children === 0) throw new ColdStartError("GenericGroup contained no frames");
        count += children;
      } else {
        const frame = await oneFrame(scope, gvrsn, context);
        count++;
        yield frame;
      }
      continue;
    }
    if (!FRAME_STARTS.has(counter.name)) {
      throw new ColdStartError(`Unsupported body-group counter at frame start: ${counter.code}`);
    }
    // Bodies hydrate as complete values; Serder keeps authority over hydration.
    const size = headerSize + payloadSize;
    const base = parseBody(await input.peek(size), gvrsn, context.onDecodeFailure);
    if (base.consumed !== size) throw new GroupSizeError("Body did not consume its declared extent", input.offset);
    await consume(input, size);
    // Native bodies use the same ownership boundary as non-native messages.
    const pending: PendingFrame = {
      frame: { body: base.body, attachments: [], gvrsn: base.gvrsn },
      gvrsn: base.gvrsn,
      nests: [],
    };
    await attachments(input, pending, base.gvrsn, context, enclosed);
    count++;
    yield pending;
  }
}

/** Finish all descendants while keeping ownership until the root is ready to yield. */
async function finishTree(pending: PendingFrame, context: ParseContext): Promise<void> {
  if (pending.writer) {
    pending.frame.essr = await pending.writer.finish();
    context.stages.delete(pending.writer);
    context.owners.add(pending.frame.essr);
  }
  for (const child of pending.nests) await finishTree(child, context);
}

/** Transfer finished owners together at the sole public delivery boundary. */
function deliverTree(frame: CesrFrame, context: ParseContext): void {
  if (frame.essr) context.owners.delete(frame.essr);
  for (const child of frame.nests ?? []) deliverTree(child, context);
}

/**
 * Parse a byte source progressively, yielding complete children before their
 * enclosing GenericGroup finishes. Earlier frames survive a later parse error.
 *
 * Pulling a result requests the next complete frame; source EOF closes an open frame.
 * Use a signal-aware source with `signal` to cancel pending I/O. The invocation
 * closes its source on completion, failure, or consumer return.
 */
export async function* parse(
  source: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): AsyncGenerator<CesrFrame> {
  // Invocation-local provenance: a caller may throw the very same ParserError class as a decoder.
  const external = new Set<unknown>();
  /** Record injected staging failures without changing the returned storage owner. */
  async function observe<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      external.add(error);
      throw error;
    }
  }
  /** Preserve source factory, iterator and read failures across decoder advancement. */
  async function* supplied(): AsyncGenerator<Uint8Array> {
    try {
      yield* source;
    } catch (error) {
      external.add(error);
      throw error;
    }
  }
  const sinkFactory = options.payloadSink;
  const decodeOptions = options.classifyWireErrors && sinkFactory
    ? {
      ...options,
      payloadSink: async (signal?: AbortSignal) => {
        const sink = await observe(() => sinkFactory(signal));
        return {
          write: (bytes: Uint8Array) => observe(() => sink.write(bytes)),
          finish: () => sink.finish(),
          abort: (reason?: unknown) => sink.abort(reason),
        };
      },
    }
    : options;
  const context: ParseContext = {
    onDecodeFailure: (error) => external.add(error),
    openEssr: essrFactory(decodeOptions, options.signal),
    stages: new Set(),
    owners: new Set(),
  };
  const input = new Cursor(options.classifyWireErrors ? supplied() : source, options);
  /** Classify only decoding; payload finalization and all joined cleanup stay outside this iterator. */
  async function* decoded(): AsyncGenerator<PendingFrame> {
    try {
      yield* frames(input, null, context);
    } catch (error) {
      if (
        options.classifyWireErrors && !options.signal?.aborted && !external.has(error)
        && error instanceof ParserError
      ) {
        throw new WireParseError(error);
      }
      throw error;
    }
  }
  // Preserve the parse failure if releasing another owner also fails.
  const errors: unknown[] = [];
  try {
    for await (const pending of decoded()) {
      // Finishing one descendant does not transfer it before a later finish succeeds.
      await finishTree(pending, context);
      options.signal?.throwIfAborted();
      deliverTree(pending.frame, context);
      yield pending.frame;
    }
  } catch (error) {
    errors.push(error);
    throw error;
  } finally {
    // Async callbacks also capture a custom owner's synchronous throw, so every release runs.
    const cleanup = await Promise.allSettled([
      ...Array.from(context.stages, async (writer) => await writer.abort()),
      ...Array.from(context.owners, async (owner) => await owner.discard()),
    ]);
    try {
      await input.close();
    } catch (error) {
      cleanup.push({ status: "rejected", reason: error });
    }
    const failures = cleanup.filter((result) => result.status === "rejected");
    if (failures.length) {
      // deno-lint-ignore no-unsafe-finally -- Preserve the original failure alongside every cleanup failure.
      throw new AggregateError([...errors, ...failures.map((result) => result.reason)], "Tree cleanup failed");
    }
  }
}
