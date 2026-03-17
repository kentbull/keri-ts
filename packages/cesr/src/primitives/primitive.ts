import type { Counter } from "./counter.ts";
import type { Indexer } from "./indexer.ts";
import type { Matter } from "./matter.ts";
import type { UnknownPrimitive } from "./unknown.ts";

/**
 * Structural contract used by parser outputs for counted group payloads.
 *
 * Parsers return concrete `CounterGroup` instances, but this interface keeps
 * downstream typing stable without creating an import cycle on `counter.ts`.
 */
export interface CounterGroupLike extends Counter {
  readonly raw: Uint8Array;
  readonly items: readonly GroupEntry[];
}

/** Any first-class hydrated CESR primitive returned by parser hydration. */
export type Primitive = Matter | Indexer | Counter | UnknownPrimitive;
/** Ordered tuple payload used by grouped attachments (for fixed small tuples). */
export type PrimitiveTuple = readonly GroupEntry[];
/** Recursive parser graph entry for attachment/native payloads. */
export type GroupEntry = Primitive | PrimitiveTuple | CounterGroupLike;

/** Runtime guard for tuple-shaped group entries. */
export function isPrimitiveTuple(entry: GroupEntry): entry is PrimitiveTuple {
  return Array.isArray(entry);
}

/** Runtime guard for parsed counter-group nodes in recursive payload graphs. */
export function isCounterGroupLike(
  entry: GroupEntry,
): entry is CounterGroupLike {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry)
    && "items" in entry && "count" in entry && "code" in entry;
}
