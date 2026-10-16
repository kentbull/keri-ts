/** KERIpy enst. wire storage; temporary reopened ESSR owners belong to the caller. */
import {
  b,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  nestedPayload,
  parseBytes,
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

/** Hydrate each stored wrapper through the finite decoder without parser-owned files. */
export function loadNests(db: Baser, said: string, signal?: AbortSignal): CesrFrame[] {
  const nests: CesrFrame[] = [];
  let ordinal = 0;
  for (;;) {
    signal?.throwIfAborted();
    const row = nextRow(db, db.enst, said, ordinal);
    if (!row) break;
    ordinal = row.next;
    const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), row.wire));
    if (frames.length !== 1) throw new Error("Stored nested row must contain exactly one child substream");
    nests.push(frames[0]);
  }
  return nests;
}
