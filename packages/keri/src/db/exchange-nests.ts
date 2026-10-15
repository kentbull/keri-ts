/** KERIpy enst. wire storage; temporary reopened ESSR owners belong to the caller. */
import {
  b,
  type CesrFrame,
  collectPayload,
  Counter,
  discardFrame,
  nestedPayload,
  parse,
  t,
  Vrsn_2_0,
} from "cesr-ts";
import type { Baser } from "./basing.ts";
import { suffix, unsuffix } from "./core/keys.ts";
import type { IoSetSuber } from "./subing.ts";

/** Read one physical row and close the LMDB key cursor before any caller suspension. */
function nextRow(
  db: Baser,
  table: IoSetSuber<string>,
  said: string,
  ordinal: number,
): { wire: Uint8Array; next: number } | null {
  for (const key of table.sdb.getKeys({ start: suffix(b(said), ordinal) })) {
    const [owner, index] = unsuffix(key);
    if (t(owner) !== said) return null;
    const wire = db.getVal(table.sdb, key);
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
 * Prepare replacement rows one child wire at a time in private staging.
 * The caller supplies a unique admission key and removes that bucket on every exit; accepted evidence is untouched.
 */
export async function stageNests(
  db: Baser,
  stage: string,
  nests: readonly CesrFrame[],
  signal?: AbortSignal,
): Promise<void> {
  if (hasRow(db.enstStaging, stage)) throw new Error("Nested stage is already owned");
  for (const child of nests) {
    const wire = await collectPayload(nestedPayload(child, Vrsn_2_0), signal);
    let ordinal = 0;
    let duplicate = false;
    // One finite comparison row at a time preserves Python IoSet ordering and deduplication.
    for (
      let row = nextRow(db, db.enstStaging, stage, ordinal);
      row;
      row = nextRow(db, db.enstStaging, stage, ordinal)
    ) {
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
  let ordinal = 0;
  for (
    let row = nextRow(db, db.enstStaging, stage, ordinal);
    row;
    row = nextRow(db, db.enstStaging, stage, ordinal)
  ) {
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
 * Hydrate stored substreams with file-backed ESSR staging owned by the caller.
 * No private metadata is required, so unchanged Python-origin rows reopen through the same path.
 */
export async function loadNests(
  db: Baser,
  said: string,
  signal?: AbortSignal,
): Promise<CesrFrame[]> {
  const nests: CesrFrame[] = [];
  let ordinal = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const row = nextRow(db, db.enst, said, ordinal);
      if (!row) break;
      ordinal = row.next;
      const archive = await db.openPayloads(signal);
      let count = 0;
      for await (
        const frame of parse(rowSource(row.wire, signal), {
          signal,
          payloadSink: (stageSignal) => archive.files.stage(stageSignal),
        })
      ) {
        // Claim every owner before checking cardinality so failures dispose all reopened files.
        nests.push(frame);
        if (++count > 1) throw new Error("Stored nested row must contain exactly one child substream");
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
