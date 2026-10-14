/** Bounded KERIpy enst. wire storage; temporary reopened ESSR owners belong to the caller. */
import {
  b,
  type CesrFrame,
  collectPayload,
  Counter,
  discardFrame,
  nestedPayload,
  parse,
  ResourceLimitError,
  t,
  Vrsn_2_0,
} from "cesr-ts";
import type { Baser } from "./basing.ts";
import { suffix, unsuffix } from "./core/keys.ts";
import type { IoSetSuber } from "./subing.ts";

/** Finite LMDB wire-copy ceiling across one parent; this is not a transfer buffer allowance. */
export const MAX_NESTED_WIRE_BYTES = 24 * 1024 ** 2;

/** Remaining parent-tree credit, shared across every independently stored child row. */
export interface NestBudget {
  /** Remaining resident body and ordinary attachment bytes across the parent tree. */
  bytes: number;
  /** Remaining ordinary leaf groups across every child row. */
  groups: number;
  /** Remaining message nodes after reserving the parent. */
  nodes: number;
  /** Remaining decoded ESSR bytes, separate from ordinary metadata. */
  essrBytes: number;
  /** Remaining Texter items, including empty fragments. */
  essrItems: number;
}

/** Charge hydrated metadata and descendants before accepting a manually supplied or reopened tree. */
export function chargeNests(nests: readonly CesrFrame[], budget: NestBudget, depth = 1): void {
  if (depth > 64) throw new ResourceLimitError("Exchange nested tree exceeds depth limit");
  for (const frame of nests) {
    budget.nodes--;
    // Non-native child bodies are qualified Texters on wire; account that finite hydration conservatively.
    budget.bytes -= frame.body.kind === "CESR" ? frame.body.raw.length : 4 * Math.ceil(frame.body.raw.length / 3) + 16;
    budget.groups -= frame.attachments.length;
    for (const group of frame.attachments) budget.bytes -= group.raw.length;
    if (frame.essr) {
      const { count, raw, wire } = frame.essr;
      if (
        [count, raw.size, wire.size].some((value) => !Number.isSafeInteger(value) || value < 0)
        || wire.size > 4 * Math.ceil(raw.size / 3) + 12 * count
      ) {
        throw new RangeError("Invalid nested ESSR extent");
      }
    }
    budget.essrBytes -= frame.essr?.raw.size ?? 0;
    budget.essrItems -= frame.essr?.count ?? 0;
    if (Object.values(budget).some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new ResourceLimitError("Exchange nested tree exceeds aggregate admission limits");
    }
    if (frame.nests?.length) chargeNests(frame.nests, budget, depth + 1);
  }
}

/** Read one physical row and close the LMDB key cursor before any caller suspension. */
function nextRow(
  db: Baser,
  table: IoSetSuber<string>,
  said: string,
  ordinal: number,
  maxBytes: number,
): { wire: Uint8Array; next: number } | null {
  for (const key of table.sdb.getKeys({ start: suffix(b(said), ordinal) })) {
    const [owner, index] = unsuffix(key);
    if (t(owner) !== said) return null;
    const wire = db.getValBounded(table.sdb, key, maxBytes);
    if (!wire) throw new Error("Stored nested row disappeared");
    return { wire, next: index + 1 };
  }
  return null;
}

/** Test row presence without hydrating a potentially large wire value. */
export function hasNests(db: Baser, said: string, ordinal = 0): boolean {
  return hasRow(db.enst, said, ordinal);
}

/** Check a public or private bucket without hydrating any wire value. */
function hasRow(table: IoSetSuber<string>, said: string, ordinal = 0): boolean {
  for (const key of table.sdb.getKeys({ start: suffix(b(said), ordinal) })) return t(unsuffix(key)[0]) === said;
  return false;
}

/** Preserve exact-value set semantics without building hex strings or a collection of prior rows. */
function sameWire(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Prepare replacement rows one bounded child wire at a time in private staging.
 * The caller supplies a unique admission key and removes that bucket on every exit; accepted evidence is untouched.
 */
export async function stageNests(
  db: Baser,
  stage: string,
  nests: readonly CesrFrame[],
  signal?: AbortSignal,
): Promise<void> {
  if (hasRow(db.enstStaging, stage)) throw new Error("Nested stage is already owned");
  let remaining = MAX_NESTED_WIRE_BYTES;
  for (const child of nests) {
    const wire = await collectPayload(nestedPayload(child, Vrsn_2_0), remaining, signal);
    remaining -= wire.length;
    let ordinal = 0;
    let duplicate = false;
    let comparisonBytes = MAX_NESTED_WIRE_BYTES;
    // One finite comparison row at a time preserves Python IoSet ordering and deduplication.
    for (
      let row = nextRow(db, db.enstStaging, stage, ordinal, comparisonBytes);
      row;
      row = nextRow(db, db.enstStaging, stage, ordinal, comparisonBytes)
    ) {
      comparisonBytes -= row.wire.length;
      if (sameWire(row.wire, wire)) {
        duplicate = true;
        break;
      }
      ordinal = row.next;
    }
    signal?.throwIfAborted();
    if (!duplicate) db.enstStaging.sdb.putSync(suffix(b(stage), ordinal), wire);
  }
}

/** Replace the public IoSet within the caller's accepted/escrow transaction; never retain an array of rows. */
export function publishNests(db: Baser, said: string, stage: string): void {
  db.enst.rem([said]);
  let ordinal = 0, remaining = MAX_NESTED_WIRE_BYTES;
  for (
    let row = nextRow(db, db.enstStaging, stage, ordinal, remaining);
    row;
    row = nextRow(db, db.enstStaging, stage, ordinal, remaining)
  ) {
    remaining -= row.wire.length;
    db.enst.sdb.putSync(suffix(b(said), ordinal), row.wire);
    ordinal = row.next;
  }
  db.enstStaging.rem([stage]);
}

/** Select a stored wrapper's genus without copying its entire qualified wire row. */
async function* rowSource(wire: Uint8Array, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  yield Counter.makeGVC(Vrsn_2_0);
  for (let offset = 0; offset < wire.length; offset += 65536) {
    signal?.throwIfAborted();
    yield wire.slice(offset, offset + 65536);
  }
}

/**
 * Hydrate stored substreams with diminishing parent-tree credit and file-backed ESSR staging.
 * No private metadata is required, so unchanged Python-origin rows reopen through the same path.
 */
export async function loadNests(
  db: Baser,
  said: string,
  budget: NestBudget,
  signal?: AbortSignal,
): Promise<CesrFrame[]> {
  const nests: CesrFrame[] = [];
  let ordinal = 0;
  let remainingWire = MAX_NESTED_WIRE_BYTES;
  try {
    for (;;) {
      signal?.throwIfAborted();
      // Check node credit before hydrating the next row, including malicious imported buckets.
      if (budget.nodes < 1) {
        if (hasNests(db, said, ordinal)) throw new ResourceLimitError("Stored nested tree exceeds node limit");
        break;
      }
      const row = nextRow(db, db.enst, said, ordinal, remainingWire);
      if (!row) break;
      ordinal = row.next;
      remainingWire -= row.wire.length;
      const archive = await db.openPayloads(signal);
      let count = 0;
      for await (
        const frame of parse(rowSource(row.wire, signal), {
          signal,
          maxFrameBytes: Math.max(1, budget.bytes),
          maxAttachmentGroups: budget.groups,
          maxTreeNodes: budget.nodes,
          maxEssrBytes: budget.essrBytes,
          maxEssrItems: budget.essrItems,
          maxDepth: 63,
          payloadSink: (limit, stageSignal) => archive.files.stage(limit, stageSignal),
        })
      ) {
        // Claim every owner before cardinality/accounting checks; never parse another row with reset credit.
        nests.push(frame);
        if (++count > 1) throw new Error("Stored nested row must contain exactly one child substream");
        chargeNests([frame], budget);
      }
      if (count !== 1) throw new Error("Stored nested row must contain exactly one child substream");
    }
    return nests;
  } catch (error) {
    try {
      await discardNests(nests);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Nested loading and cleanup failed", { cause: error });
    }
    throw error;
  }
}

/** Release every temporary reopened descendant, even if one owner's cleanup fails. */
export async function discardNests(nests: readonly CesrFrame[]): Promise<void> {
  const results = await Promise.allSettled(nests.map((frame) => discardFrame(frame)));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(failures.map((result) => result.reason), "Nested payload cleanup failed");
  }
}
