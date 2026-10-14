import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import { ColdStartError, GroupSizeError, ResourceLimitError, ShortageError } from "../core/errors.ts";
import { retainFrameCredit } from "../core/frame-credit.ts";
import type { ResourcePolicy, ResourceReservation } from "../core/resource-policy.ts";
import type { CesrFrame, EssrPayload } from "../core/types.ts";
import { decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import { smell } from "../serder/smell.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseAttachmentGroup, startsFrame } from "./attachments.ts";
import { parseBody, readFrameCounter } from "./body.ts";
import { sniff } from "./cold-start.ts";
import { DEFAULT_GVRSN, FRAME_GROUPS, FRAME_LISTS, FRAME_STARTS, GENUS_VERSION_CODE } from "./common.ts";
import { Cursor, type CursorOptions } from "./cursor.ts";
import { type EssrBudget, essrFactory, type EssrOptions, type EssrWriter } from "./essr.ts";

/** Resource limits and cancellation for one progressive stream invocation. */
export interface ParseOptions extends CursorOptions, EssrOptions {
  /** Shared ordinary-tree allowance; delivered roots retain credit until discardFrame(). */
  resources?: ResourcePolicy;
  /** Resident body and ordinary attachment byte limit per owned tree; streamed ESSR is budgeted separately. */
  maxFrameBytes?: number;
  /** Maximum retained ordinary attachment leaves per owned tree; default 4,096. */
  maxAttachmentGroups?: number;
  /** Maximum body nodes in one owned tree, including the root; default 256. */
  maxTreeNodes?: number;
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

/** A frame under construction or enclosure validation; its stages stay parser-owned until delivery. */
interface PendingFrame {
  /** Hydrated body and bounded ordinary attachment leaves awaiting public delivery. */
  frame: CesrFrame;
  /** Frame genus remains independent of temporary attachment-wrapper selectors. */
  gvrsn: Versionage;
  /** Admission credit shared with descendants; streamed ESSR is charged separately. */
  tree: TreeBudget;
  /** Pending descendants retain their own writers until root delivery. */
  nests: PendingFrame[];
  /** Shared unfinished stage for every ESSR group encountered in this frame. */
  writer?: EssrWriter;
}

/** Remaining admission credit shared only by one pending message and its descendants. */
interface TreeBudget extends EssrBudget {
  /** One root owns the admission allowance for all parent-owned descendants. */
  credit?: ResourceReservation;
  /** Ordinary body and attachment wire bytes retained so far. */
  resident: number;
  /** Ordinary attachment groups retained so far, including empty groups. */
  groups: number;
  /** Number of admitted body nodes, including the root. */
  nodes: number;
}

/** Limits and stage ownership shared by nested readers during one parse invocation. */
interface ParseContext {
  /** Maximum admitted body plus ordinary attachment bytes for one owned tree. */
  limit: number;
  /** Maximum retained leaf objects, including zero-item groups. */
  maxGroups: number;
  /** Maximum body nodes in one pending owned tree. */
  maxNodes: number;
  /** Start independent credit for each top-level or GenericGroup message. */
  newTree: () => TreeBudget;
  /** Open a finite stage only when the frame actually contains ESSR. */
  openEssr: (gvrsn: Versionage, budget: EssrBudget) => Promise<EssrWriter>;
  /** Every unfinished candidate stage, including children held by oneFrame validation. */
  stages: Set<EssrWriter>;
  /** Finished owners remain parser-owned until every descendant finishes. */
  owners: Set<EssrPayload>;
  /** Reserved ordinary-tree allowances not yet transferred at public delivery. */
  credits: Set<ResourceReservation>;
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
      // Read exactly one child with the same tree credit; its own enclosure owns grandchildren.
      const children = frames(input, gvrsn, context, pending.tree);
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
        pending.writer = await context.openEssr(pending.gvrsn, pending.tree);
        context.stages.add(pending.writer);
      }
      await pending.writer.read(input, counter, gvrsn, domain);
      continue;
    }
    if (pending.tree.groups >= context.maxGroups) {
      throw new ResourceLimitError("Frame exceeds attachment group limit", input.offset);
    }
    // Previously admitted leaves reduce the same frame-wide byte budget.
    const remaining = context.limit - pending.tree.resident;
    // Ordinary semantic groups remain bounded hydrated values under the existing dispatcher.
    const parsed = await peek(input, (bytes) => parseAttachmentGroup(bytes, gvrsn, domain), remaining);
    await consume(input, parsed.consumed);
    pending.tree.resident += parsed.consumed;
    pending.tree.groups++;
    pending.frame.attachments.push(parsed.group);
  }
}

/** Verify a single-frame wrapper entirely before its one result may escape. */
async function oneFrame(
  input: Cursor,
  gvrsn: Versionage,
  context: ParseContext,
  tree: TreeBudget,
): Promise<PendingFrame> {
  const nested = frames(input, gvrsn, context, tree, true);
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
  tree?: TreeBudget,
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
      const budget = tree ?? context.newTree();
      admitBody(budget, size, context, input.offset);
      const base = parseBody(await input.peek(size), selected);
      await consume(input, base.consumed);
      // Keep stage ownership separate from the public frame until its boundary is proven.
      const pending: PendingFrame = {
        frame: { body: base.body, attachments: [], gvrsn: base.gvrsn },
        gvrsn: base.gvrsn,
        tree: budget,
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
        const children = yield* frames(scope, gvrsn, context, tree);
        scope.expectEnd();
        if (children === 0) throw new ColdStartError("GenericGroup contained no frames");
        count += children;
      } else {
        const frame = await oneFrame(scope, gvrsn, context, tree ?? context.newTree());
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
    const budget = tree ?? context.newTree();
    admitBody(budget, size, context, input.offset);
    const base = parseBody(await input.peek(size), gvrsn);
    if (base.consumed !== size) throw new GroupSizeError("Body did not consume its declared extent", input.offset);
    await consume(input, size);
    // Native bodies use the same ownership boundary as non-native messages.
    const pending: PendingFrame = {
      frame: { body: base.body, attachments: [], gvrsn: base.gvrsn },
      gvrsn: base.gvrsn,
      tree: budget,
      nests: [],
    };
    await attachments(input, pending, base.gvrsn, context, enclosed);
    count++;
    yield pending;
  }
}

/** Charge body retention before hydration; enclosing wire is never charged a second time. */
function admitBody(tree: TreeBudget, size: number, context: ParseContext, offset: number): void {
  if (tree.nodes >= context.maxNodes) throw new ResourceLimitError("Tree exceeds message node limit", offset);
  if (size > context.limit - tree.resident) throw new ResourceLimitError("Body exceeds frame tree limit", offset);
  tree.nodes++;
  tree.resident += size;
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
 * Pulling a result supplies output credit; source EOF closes an open frame.
 * Use a signal-aware source with `signal` to cancel pending I/O. The invocation
 * closes its source on completion, failure, or consumer return.
 */
export async function* parse(
  source: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): AsyncGenerator<CesrFrame> {
  const resources = options.resources;
  const limit = options.maxFrameBytes ?? 8 * 1024 ** 2;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Frame limit must be a positive safe integer");
  // Empty attachment groups require an object-count cap in addition to the byte cap.
  const maxGroups = options.maxAttachmentGroups ?? 4096;
  if (!Number.isSafeInteger(maxGroups) || maxGroups < 0) {
    throw new RangeError("Attachment group limit must be a non-negative safe integer");
  }
  const maxNodes = options.maxTreeNodes ?? 256;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    throw new RangeError("Tree node limit must be a positive safe integer");
  }
  // One invocation owns every stage that has not crossed the public yield below.
  const context: ParseContext = {
    limit,
    maxGroups,
    maxNodes,
    openEssr: essrFactory(options, options.signal),
    stages: new Set(),
    owners: new Set(),
    credits: new Set(),
    newTree: () => {
      const decision = resources?.reserve({ bytes: limit });
      if (decision?.kind === "refuse") {
        throw new ResourceLimitError(`Tree admission refused: ${decision.reason}`);
      }
      const credit = decision?.reservation;
      if (credit) context.credits.add(credit);
      return {
        credit,
        resident: 0,
        groups: 0,
        nodes: 0,
        bytes: options.maxEssrBytes ?? 8 * 1024 ** 2,
        items: options.maxEssrItems ?? 16384,
      };
    },
  };
  const input = new Cursor(source, options);
  // Preserve the parse failure if releasing another owner also fails.
  const errors: unknown[] = [];
  try {
    for await (const pending of frames(input, null, context)) {
      // Finishing one descendant does not transfer it before a later finish succeeds.
      await finishTree(pending, context);
      options.signal?.throwIfAborted();
      const released = pending.tree.credit && retainFrameCredit(pending.frame, pending.tree.credit);
      if (pending.tree.credit) context.credits.delete(pending.tree.credit);
      deliverTree(pending.frame, context);
      try {
        yield pending.frame;
      } finally {
        // A suspended generator still retains the delivered tree until next()/return().
        released?.();
      }
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
    for (const credit of context.credits) credit.release();
    const failures = cleanup.filter((result) => result.status === "rejected");
    if (failures.length) {
      // deno-lint-ignore no-unsafe-finally -- Preserve the original failure alongside every cleanup failure.
      throw new AggregateError([...errors, ...failures.map((result) => result.reason)], "Tree cleanup failed");
    }
  }
}
