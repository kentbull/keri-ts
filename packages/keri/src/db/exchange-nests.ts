/** KERIpy enst. wire storage and finite nested evidence hydration. */
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
  for (const key of db.enst.sdb.getKeys({ start: suffix(b(said), ordinal) })) return t(unsuffix(key)[0]) === said;
  return false;
}

/** Serialize resident children before the caller enters its synchronous evidence writer. */
export async function prepareNests(nests: readonly CesrFrame[], signal?: AbortSignal): Promise<Uint8Array[]> {
  const wires: Uint8Array[] = [];
  for (const child of nests) wires.push(await collectPayload(nestedPayload(child, Vrsn_2_0), signal));
  return wires;
}

/** Publish ordinary KERIpy nested wire rows inside the caller's exchange transaction. */
export function publishNests(db: Baser, said: string, wires: readonly Uint8Array[]): void {
  if (!wires.length) {
    db.enst.rem([said]);
    return;
  }
  if (!db.enst.pin([said], wires.map((wire) => t(wire)))) throw new Error("Nested evidence write failed");
}

/** Hydrate each stored wrapper through the finite decoder without parser-owned files. */
export function loadNests(db: Baser, said: string): CesrFrame[] {
  const nests: CesrFrame[] = [];
  let ordinal = 0;
  for (;;) {
    const row = nextRow(db, db.enst, said, ordinal);
    if (!row) break;
    ordinal = row.next;
    const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), row.wire));
    if (frames.length !== 1) throw new Error("Stored nested row must contain exactly one child substream");
    nests.push(frames[0]);
  }
  return nests;
}
