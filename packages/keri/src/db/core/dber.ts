/**
 * Backend-neutral store contract shared by every `keri-ts` database backend.
 *
 * ADR-0015 owns the semantics. Backends supply row access and transactions;
 * the ordinal, insertion-ordered set and insertion-ordered duplicate families
 * below are built only on those primitives, so every backend shares them.
 */

import { b, bytesEqual, bytesHex, t } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { Logger } from "../../core/logger.ts";
import { onKey, splitOnKey, suffix, unsuffix } from "./keys.ts";

declare const tableBrand: unique symbol;

/**
 * Opaque handle to one named table in one open store.
 *
 * Valid only until its store closes or reopens. Only the backend that issued a
 * handle can interpret it.
 */
export interface Table {
  readonly [tableBrand]: "Table";
}

/**
 * Backend-neutral identity of one store.
 *
 * `name` and `base` name the store on every backend; where its bytes live is
 * each backend's own concern.
 */
export interface StoreIdentity {
  name?: string;
  base?: string;
  temp?: boolean;
  readonly?: boolean;
  /** Delete the store's contents on close. */
  clear?: boolean;
  /** Keep an existing store's contents when reopening it. */
  reuse?: boolean;
  /** Open on construction where the backend supports it. */
  reopen?: boolean;
  logger?: Logger;
}

/** One physical row. Both arrays are caller-owned copies. */
export interface TableEntry {
  key: Uint8Array;
  value: Uint8Array;
}

/**
 * Ordered scan bounds. `start` is inclusive unless `exclusiveStart` is set and
 * `end` is always exclusive. In reverse, `start` is the upper position and
 * `end` the lower bound. Dupsort entries order by key, then value.
 */
export interface ScanOptions {
  start?: Uint8Array;
  end?: Uint8Array;
  exclusiveStart?: boolean;
  reverse?: boolean;
  limit?: number;
}

/** Default separator used by ordinal/suffix key helpers (`onKey`, `suffix`). */
const DOT_SEP = b(".");
/**
 * Hex chars used for IoDup insertion ordinal prefix.
 * Does not include trailing separator.
 */
const IODUP_PROEM_HEX_SIZE = 32;
/**
 * Full IoDup proem size:
 * 32-hex ordinal + trailing `.` separator.
 */
const IODUP_PROEM_SIZE = 33;

/**
 * Dedupe binary values while preserving first-seen order.
 * Example: `[a, b, a] -> [a, b]`.
 */
function asUniqueVals(vals: Iterable<Uint8Array>): Uint8Array[] {
  const seen = new Set<string>();
  const out: Uint8Array[] = [];
  for (const val of vals) {
    const key = bytesHex(val);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(val);
  }
  return out;
}

/** Build IoDup ordering proem bytes (`000...00a.` for index `10`). */
function iDupProem(index: number): Uint8Array {
  return b(`${index.toString(16).padStart(IODUP_PROEM_HEX_SIZE, "0")}.`);
}

/** Prefix value bytes with IoDup ordering proem for insertion-order semantics. */
function withIoDupProem(index: number, val: Uint8Array): Uint8Array {
  const proem = iDupProem(index);
  const out = new Uint8Array(proem.length + val.length);
  out.set(proem, 0);
  out.set(val, proem.length);
  return out;
}

/** Strip IoDup ordering proem from a stored duplicate value. */
function stripIoDupProem(val: Uint8Array): Uint8Array {
  return val.length >= IODUP_PROEM_SIZE
    ? val.slice(IODUP_PROEM_SIZE)
    : new Uint8Array(0);
}

/** Parse IoDup insertion ordinal from proem-prefixed stored value. */
function parseIoDupOrdinal(val: Uint8Array): number {
  if (val.length < IODUP_PROEM_HEX_SIZE) {
    return 0;
  }
  const parsed = Number.parseInt(t(val.slice(0, IODUP_PROEM_HEX_SIZE)), 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Shared base for every store backend.
 *
 * Subclasses implement the abstract row access. Everything concrete here must
 * stay free of backend types so a new backend inherits identical family
 * behavior.
 */
export abstract class BaseDBer {
  /** Logical database name. */
  abstract get name(): string;
  /** Logical base prefix namespacing `name`. */
  abstract get base(): string;
  /** True while the store can serve reads and writes. */
  abstract get opened(): boolean;
  /** True when this store refuses writes. */
  abstract readonly: boolean;
  /** True for a store that does not outlive its handle. */
  abstract get temp(): boolean;
  /** True while a writer is active, so a caller can tell it is borrowing one. */
  abstract get inWriteTransaction(): boolean;

  /** Open or reopen the store, reporting whether it is now usable. */
  abstract reopen(options?: StoreIdentity): Operation<boolean>;
  /** Close the store, optionally deleting its contents. */
  abstract close(clear?: boolean): Operation<boolean>;
  /** Bind a named table; `dupsort` is fixed when the table is created. */
  abstract openTable(name: string, options?: { dupsort?: boolean }): Table;
  /**
   * Run `fn` synchronously in one atomic transaction and return its result.
   * A throw rolls back every effect and rethrows. Nesting is a savepoint.
   */
  abstract transaction<T>(fn: () => T): T;
  /** Yield rows in order under `options`. Close the scan before suspending. */
  abstract scan(table: Table, options?: ScanOptions): Iterable<TableEntry>;
  /**
   * Yield keys in order under `options`. A dupsort table yields each key once:
   * `limit` counts distinct keys and `exclusiveStart` skips every duplicate.
   */
  abstract scanKeys(table: Table, options?: ScanOptions): Iterable<Uint8Array>;
  /**
   * Increases on every outermost commit that wrote rows. Comparable only within
   * one open handle; increments need not be one.
   */
  abstract get writeVersion(): number;
  /** Complete when every earlier commit is durable, or fail with the recorded persistence failure. */
  abstract flushed(): Operation<void>;
  /** Discard any retained read view so later reads observe the latest commit. */
  abstract refreshRead(): void;
  /** Report whether a named table exists, without creating it. */
  abstract hasTable(name: string): boolean;

  /** Read the `__version__` marker, or `null` when absent or malformed. */
  abstract getVer(): string | null;
  /** Write the `__version__` marker. */
  abstract setVer(val: string): void;

  abstract getVal(table: Table, key: Uint8Array): Uint8Array | null;
  abstract putVal(table: Table, key: Uint8Array, val: Uint8Array): boolean;
  abstract setVal(table: Table, key: Uint8Array, val: Uint8Array): boolean;
  abstract delVal(table: Table, key: Uint8Array, val?: Uint8Array): boolean;
  abstract cnt(table: Table): number;
  abstract cntAll(table: Table): number;
  abstract cntTop(table: Table, top?: Uint8Array): number;
  abstract delTop(table: Table, top?: Uint8Array): boolean;
  abstract getTopItemIter(table: Table, top?: Uint8Array): Generator<[Uint8Array, Uint8Array]>;

  abstract putVals(table: Table, key: Uint8Array, vals: Iterable<Uint8Array>): boolean;
  abstract addVal(table: Table, key: Uint8Array, val: Uint8Array | null): boolean;
  abstract getVals(table: Table, key: Uint8Array): Uint8Array[];
  abstract getValLast(table: Table, key: Uint8Array): Uint8Array | null;
  abstract getValsIter(table: Table, key: Uint8Array): Generator<Uint8Array>;
  abstract cntVals(table: Table, key: Uint8Array): number;
  abstract delVals(table: Table, key: Uint8Array): boolean;
  /** Return the first duplicate at `key` not below `start`, or `null`. */
  abstract seekVal(table: Table, key: Uint8Array, start?: Uint8Array): Uint8Array | null;

  /** Throw the backend's not-open error when the store is closed. */
  protected abstract assertOpen(): void;
  /** Write one physical row inside an active `transaction`, without nesting another. */
  protected abstract putRow(table: Table, key: Uint8Array, val: Uint8Array): void;
  /**
   * Remove a key, or one duplicate when `val` is given, reporting whether a row
   * was removed. Outside a transaction the removal commits by itself.
   */
  protected abstract removeRow(table: Table, key: Uint8Array, val?: Uint8Array): boolean;

  /*
   * Ordinal-key family (`On*`)
   * Logical shape: one logical key -> many values via fixed-width ordinal in key.
   * Multiplicity: synthetic, stored in keyspace as `key.<on>`.
   * Ordering: lexicographic key order matches numeric ordinal order.
   * Parity status: direct KERIpy analogs plus TS rename conveniences.
   */

  /**
   * Write `val` at the ordinal key `onKey(key, on)` only when absent.
   *
   * The ordinal is encoded into the physical key as a fixed-width 32-hex suffix
   * so LMDB key order matches ordinal order. Mirrors KERIpy `putOnVal`.
   */
  putOnVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (val === null) {
      return false;
    }
    return this.putVal(db, onKey(key, on, sep), val);
  }

  /**
   * Write `val` at `onKey(key, on)`, overwriting any existing value.
   *
   * TypeScript-local rename of KERIpy `setOnVal`.
   */
  pinOnVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length || val === null) {
      return false;
    }
    return this.setVal(db, onKey(key, on, sep), val);
  }

  /**
   * Append `val` at the next ordinal slot for `key`.
   *
   * This scans backward from the `key.MaxON` boundary to find the current tail,
   * then writes at the next ordinal. Returns the appended ordinal. Mirrors
   * KERIpy `appendOnVal`.
   */
  appendOnVal(
    db: Table,
    key: Uint8Array,
    val: Uint8Array | null,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.assertOpen();
    if (!key.length || val === null) {
      throw new Error(
        `Bad append parameter: key=${Array.from(key)} val=${val}`,
      );
    }

    // KERIpy parity: seek from key.MaxON boundary and step back to the tail
    // key for this prefix (if any), rather than scanning key.000... upward.
    const maxOnSuffix = b("f".repeat(32));
    const start = new Uint8Array(key.length + sep.length + maxOnSuffix.length);
    start.set(key, 0);
    start.set(sep, key.length);
    start.set(maxOnSuffix, key.length + sep.length);

    let nextOn = 0;
    for (const entry of this.scan(db, { start, reverse: true, limit: 1 })) {
      const tailOnKey = entry.key;
      const [ckey, cn] = splitOnKey(tailOnKey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      if (bytesEqual(tailOnKey, start)) {
        throw new Error(
          `Number part cn=${cn} for key part ckey=${Array.from(ckey)} exceeds maximum size.`,
        );
      }
      nextOn = cn + 1;
      break;
    }

    const targetKey = onKey(key, nextOn, sep);
    const added = this.putVal(db, targetKey, val);
    if (added) {
      return nextOn;
    }

    // Some compat/interop flows still surface LMDB-js range behavior where the
    // reverse tail probe fails to observe the existing highest ordinal entry.
    // Fall back to counting the live branch and append at that count instead of
    // failing a logically valid append.
    const fallbackOn = this.cntOnAll(db, key, 0, sep);
    if (fallbackOn !== nextOn) {
      const fallbackAdded = this.putVal(db, onKey(key, fallbackOn, sep), val);
      if (fallbackAdded) {
        return fallbackOn;
      }
    }

    throw new Error(`Failed appending value at key=${Array.from(key)}.`);
  }

  /**
   * TypeScript-only convenience returning the exact `(key, on, val)` triple.
   *
   * Returns `null` when that exact ordinal entry is missing.
   */
  getOnItem(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): [Uint8Array, number, Uint8Array] | null {
    const val = this.getOnVal(db, key, on, sep);
    return val ? [key, on, val] : null;
  }

  /**
   * Fetch the value stored exactly at `onKey(key, on)`.
   *
   * Returns `null` when the exact ordinal entry is missing. Empty logical keys
   * are treated as absent. Mirrors KERIpy `getOnVal`.
   */
  getOnVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Uint8Array | null {
    if (!key.length) {
      return null;
    }
    return this.getVal(db, onKey(key, on, sep));
  }

  /**
   * Remove the value stored exactly at `onKey(key, on)`.
   *
   * Empty logical keys return `false`. TypeScript-local rename of KERIpy
   * `delOnVal`.
   */
  remOn(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return false;
    }
    return this.delVal(db, onKey(key, on, sep));
  }

  /**
   * Remove all ordinal entries for `key` starting at ordinal `on`.
   *
   * Empty `key` removes the whole DB branch. TypeScript-only convenience built
   * on the same ordinal-key semantics as KERIpy `delOnVal`.
   */
  remOnAll(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return this.delTop(db, new Uint8Array(0));
    }

    this.assertOpen();
    const start = onKey(key, on, sep);
    const keys: Uint8Array[] = [];
    for (const entry of this.scan(db, { start })) {
      const ckey = entry.key;
      const [top] = splitOnKey(ckey, sep);
      if (!bytesEqual(top, key)) {
        break;
      }
      keys.push(new Uint8Array(ckey));
    }

    if (!keys.length) {
      return false;
    }

    this.transaction(() => {
      for (const k of keys) {
        this.removeRow(db, k);
      }
    });
    return true;
  }

  /**
   * Count ordinal-keyed entries for `key` starting at ordinal `on`.
   *
   * Empty `key` counts the whole DB. TypeScript-local rename of KERIpy
   * `cntOnVals`.
   */
  cntOnAll(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.assertOpen();
    const start = key.length ? onKey(key, on, sep) : new Uint8Array(0);
    let count = 0;
    for (const entry of this.scan(db, { start })) {
      const ckey = entry.key;
      const [top] = splitOnKey(ckey, sep);
      if (key.length && !bytesEqual(top, key)) {
        break;
      }
      count += 1;
    }
    return count;
  }

  /**
   * Iterate `(key, on, val)` triples whose physical keys begin with branch `top`.
   *
   * This is the ordinal-key version of `getTopItemIter`, so branch membership is
   * still a lexicographic key-prefix concept. TypeScript-only convenience.
   */
  *getOnTopItemIter(
    db: Table,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [onkey, val] of this.getTopItemIter(db, top)) {
      const [key, on] = splitOnKey(onkey, sep);
      yield [key, on, val];
    }
  }

  /**
   * Iterate `(key, on, val)` triples for ordinals `>= on`.
   *
   * Empty `key` iterates the whole DB. Ordering follows the fixed-width ordinal
   * encoded in the key. TypeScript-local rename of KERIpy `getOnItemIter`.
   */
  *getOnAllItemIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    this.assertOpen();
    const start = key.length ? onKey(key, on, sep) : new Uint8Array(0);
    for (const entry of this.scan(db, { start })) {
      const ckey = entry.key;
      const cval = entry.value;
      const [top, cn] = splitOnKey(ckey, sep);
      if (key.length && !bytesEqual(top, key)) {
        break;
      }
      yield [top, cn, cval];
    }
  }

  /*
   * Synthetic insertion-ordered set family (`IoSet*`)
   * Logical shape: one logical key -> many values without dupsort.
   * Multiplicity: synthetic, stored in keyspace as `key.<ion>`.
   * Ordering: hidden fixed-width insertion suffix in the physical key.
   * Parity status: direct KERIpy analogs with TS naming tweaks.
   */

  /**
   * Add each unique value in `vals` to the insertion-ordered set at `key`.
   *
   * This emulates duplicate-like behavior in keyspace, not native LMDB dupsort:
   * values are stored under hidden suffixed keys `key.<ion>`. Existing logical
   * members are skipped, new members append at the next suffix. Mirrors KERIpy
   * `putIoSetVals`.
   */
  putIoSetVals(
    db: Table,
    key: Uint8Array,
    vals: Iterable<Uint8Array> | null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length || vals === null) {
      return false;
    }

    const uniqueVals = asUniqueVals(vals);
    if (!uniqueVals.length) {
      return false;
    }

    const existing = new Set<string>();
    let ion = 0;
    const start = suffix(key, 0, sep);
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const cval = entry.value;
      const [ckey, cion] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      existing.add(bytesHex(cval));
      ion = cion + 1;
    }

    const insert = uniqueVals.filter((val) => !existing.has(bytesHex(val)));
    if (!insert.length) {
      return false;
    }

    this.assertOpen();
    this.transaction(() => {
      for (const [index, val] of insert.entries()) {
        this.putRow(db, suffix(key, ion + index, sep), val);
      }
    });
    return true;
  }

  /**
   * Replace the insertion-ordered set at `key` with the provided unique values.
   *
   * This clears the existing synthetic key run for `key`, then rewrites fresh
   * hidden suffixes from zero. TypeScript-local rename of KERIpy `setIoSetVals`.
   */
  pinIoSetVals(
    db: Table,
    key: Uint8Array,
    vals: Iterable<Uint8Array> | null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length || vals === null) {
      return false;
    }

    const uniqueVals = asUniqueVals(vals);
    if (!uniqueVals.length) {
      return false;
    }

    this.remIoSet(db, key, sep);
    this.assertOpen();
    this.transaction(() => {
      for (const [index, val] of uniqueVals.entries()) {
        this.putRow(db, suffix(key, index, sep), val);
      }
    });
    return true;
  }

  /**
   * Add one value to the insertion-ordered set at `key` if it is not present.
   *
   * Membership is checked by scanning the synthetic key run for `key`; new
   * values append at the next hidden suffix. Mirrors KERIpy `addIoSetVal`.
   */
  addIoSetVal(
    db: Table,
    key: Uint8Array,
    val: Uint8Array | null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    this.assertOpen();
    if (!key.length || val === null) {
      return false;
    }

    let ion = 0;
    const valHex = bytesHex(val);
    const start = suffix(key, 0, sep);
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const cval = entry.value;
      const [ckey, cion] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      if (bytesHex(cval) === valHex) {
        return false;
      }
      ion = cion + 1;
    }

    return this.putVal(db, suffix(key, ion, sep), val);
  }

  /**
   * Iterate `(key, val)` pairs for the insertion-ordered set at `key`.
   *
   * Iteration starts at hidden insertion ordinal `ion`. Returned keys are the
   * logical effective key with the hidden suffix removed. TypeScript-local item
   * variant corresponding to KERIpy `getIoSetValsIter`.
   */
  *getIoSetItemIter(
    db: Table,
    key: Uint8Array,
    ion = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, Uint8Array]> {
    this.assertOpen();
    if (!key.length) {
      return;
    }
    const start = suffix(key, ion, sep);
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const cval = entry.value;
      const [ckey] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      yield [ckey, cval];
    }
  }

  /**
   * Return the last logical set member at `key`, or `null`.
   *
   * "Last" means the entry stored under the greatest hidden insertion suffix,
   * not the lexicographically greatest value bytes. TypeScript-local item
   * variant corresponding to KERIpy `getIoSetValLast`.
   */
  getIoSetLastItem(
    db: Table,
    key: Uint8Array,
    sep: Uint8Array = DOT_SEP,
  ): [Uint8Array, Uint8Array] | null {
    let last: [Uint8Array, Uint8Array] | null = null;
    for (const item of this.getIoSetItemIter(db, key, 0, sep)) {
      last = item;
    }
    return last;
  }

  /**
   * Remove all insertion-ordered set members at `key`.
   *
   * This deletes the full synthetic key run for the effective key. TypeScript-
   * local rename of KERIpy `delIoSetVals`.
   */
  remIoSet(
    db: Table,
    key: Uint8Array,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return false;
    }

    this.assertOpen();
    const keys: Uint8Array[] = [];
    const start = suffix(key, 0, sep);
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const [ckey] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      keys.push(new Uint8Array(iokey));
    }

    if (!keys.length) {
      return false;
    }

    this.transaction(() => {
      for (const iokey of keys) {
        this.removeRow(db, iokey);
      }
    });
    return true;
  }

  /**
   * Remove one logical set member at `key`, or all members when `val` is `null`.
   *
   * Delete-by-value requires a linear search because the caller does not know
   * the hidden insertion suffix. As in KERIpy, suffix ordinals can grow
   * monotonically over time after deletes and reinserts. TypeScript-local rename
   * of KERIpy `delIoSetVal`.
   */
  remIoSetVal(
    db: Table,
    key: Uint8Array,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (val === null) {
      return this.remIoSet(db, key, sep);
    }
    if (!key.length) {
      return false;
    }

    this.assertOpen();
    const valHex = bytesHex(val);
    let removeKey: Uint8Array | null = null;
    const start = suffix(key, 0, sep);
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const cval = entry.value;
      const [ckey] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      if (bytesHex(cval) === valHex) {
        removeKey = new Uint8Array(iokey);
        break;
      }
    }

    if (!removeKey) {
      return false;
    }

    this.transaction(() => {
      this.removeRow(db, removeKey!);
    });
    return true;
  }

  /**
   * Count logical set members at `key` starting from hidden insertion ordinal `ion`.
   *
   * TypeScript-local item-count variant corresponding to KERIpy `cntIoSetVals`.
   */
  cntIoSet(
    db: Table,
    key: Uint8Array,
    ion = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    if (!key.length) {
      return 0;
    }
    let count = 0;
    for (const _ of this.getIoSetItemIter(db, key, ion, sep)) {
      count += 1;
    }
    return count;
  }

  /**
   * Iterate `(key, val)` pairs for all synthetic-set entries in branch `top`.
   *
   * Branch membership is still a lexicographic key-prefix scan over the
   * physical suffixed keys; returned keys have the hidden insertion suffix
   * removed. Mirrors KERIpy `getTopIoSetItemIter`.
   */
  *getTopIoSetItemIter(
    db: Table,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, Uint8Array]> {
    for (const [iokey, val] of this.getTopItemIter(db, top)) {
      const [key] = unsuffix(iokey, sep);
      yield [key, val];
    }
  }

  /**
   * Iterate the last `(key, val)` member for each effective io-set key.
   *
   * Empty `key` iterates the whole DB. "Last" is determined by hidden suffix
   * order. TypeScript-local item variant built from KERIpy `getIoSetValLast`
   * and branch iteration semantics.
   */
  *getIoSetLastItemIterAll(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, Uint8Array]> {
    this.assertOpen();
    const start = key.length ? suffix(key, 0, sep) : undefined;
    let last: [Uint8Array, Uint8Array] | null = null;
    let lkey: Uint8Array | null = null;
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const cval = entry.value;
      const [ckey] = unsuffix(iokey, sep);
      if (lkey === null) {
        lkey = ckey;
      }
      if (!bytesEqual(ckey, lkey)) {
        if (last) {
          yield last;
        }
        lkey = ckey;
      }
      last = [ckey, cval];
    }
    if (last) {
      yield last;
    }
  }

  /**
   * Iterate only the last logical values for each effective io-set key `>= key`.
   *
   * TypeScript-only convenience built on `getIoSetLastItemIterAll`.
   */
  *getIoSetLastIterAll(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, val] of this.getIoSetLastItemIterAll(db, key, sep)) {
      yield val;
    }
  }

  /*
   * Ordinal synthetic insertion-ordered set family (`OnIoSet*`)
   * Logical shape: ordinal buckets, each bucket holding an insertion-ordered set.
   * Multiplicity: synthetic, stored in keyspace as `key.<on>.<ion>`.
   * Ordering: exposed fixed-width ordinal in the key, then hidden insertion suffix.
   * Parity status: TypeScript-only extension. KERIpy exposes `IoSet*` and
   * `OnIoDup*`, but not `OnIoSet*`. This exists as extension surface for
   * ordinal buckets + insertion-ordered set semantics without dupsort
   * constraints, and currently has no production callers.
   */

  /**
   * TypeScript-only extension. Add set members at ordinal effective key `onKey(key, on)`.
   *
   * This is the `On` + `IoSet` composition: exposed ordinal in keyspace, hidden
   * insertion suffix inside that ordinal bucket.
   */
  putOnIoSetVals(
    db: Table,
    key: Uint8Array,
    on = 0,
    vals: Iterable<Uint8Array> | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return false;
    }
    return this.putIoSetVals(db, onKey(key, on, sep), vals, sep);
  }

  /**
   * TypeScript-only extension. Replace set members at ordinal effective key.
   *
   * This is the ordinal-bucketed counterpart to `pinIoSetVals`.
   */
  pinOnIoSetVals(
    db: Table,
    key: Uint8Array,
    on = 0,
    vals: Iterable<Uint8Array> | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return false;
    }
    return this.pinIoSetVals(db, onKey(key, on, sep), vals, sep);
  }

  /**
   * TypeScript-only extension. Append a new ordinal bucket for `key`.
   *
   * Returns the newly appended exposed ordinal. Within that bucket, the values
   * are stored as an `IoSet` using hidden insertion suffixes.
   */
  appendOnIoSetVals(
    db: Table,
    key: Uint8Array,
    vals: Iterable<Uint8Array> | null,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.assertOpen();
    if (!key.length || vals === null) {
      throw new Error(
        `Bad append parameter: key=${Array.from(key)} vals=${vals}`,
      );
    }

    let on = 0;
    const start = suffix(onKey(key, 0, sep), 0, sep);
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const [onkey] = unsuffix(iokey, sep);
      const [ckey, con] = splitOnKey(onkey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      on = con + 1;
    }

    if (!this.putOnIoSetVals(db, key, on, vals, sep)) {
      throw new Error(`Failed appending set values at key=${Array.from(key)}.`);
    }
    return on;
  }

  /**
   * TypeScript-only extension. Add one set member inside an ordinal bucket.
   *
   * This is the ordinal-bucketed counterpart to `addIoSetVal`.
   */
  addOnIoSetVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.addIoSetVal(db, onKey(key, on, sep), val, sep);
  }

  /**
   * TypeScript-only extension. Iterate `(key, on, val)` members at one exact ordinal.
   *
   * Ordering inside the bucket follows the hidden insertion suffix.
   */
  *getOnIoSetItemIter(
    db: Table,
    key: Uint8Array,
    on = 0,
    ion = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (
      const [onkey, val] of this.getIoSetItemIter(
        db,
        onKey(key, on, sep),
        ion,
        sep,
      )
    ) {
      const [k, o] = splitOnKey(onkey, sep);
      yield [k, o, val];
    }
  }

  /**
   * TypeScript-only extension. Fetch the last member in one ordinal bucket.
   *
   * Returns `null` when that exact ordinal bucket is empty or missing.
   */
  getOnIoSetLastItem(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): [Uint8Array, number, Uint8Array] | null {
    const last = this.getIoSetLastItem(db, onKey(key, on, sep), sep);
    if (!last) {
      return null;
    }
    const [onkey, val] = last;
    const [k, o] = splitOnKey(onkey, sep);
    return [k, o, val];
  }

  /**
   * TypeScript-only extension. Remove one member from an ordinal bucket.
   *
   * When `val` is `null`, removes the whole ordinal bucket.
   */
  remOnIoSetVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.remIoSetVal(db, onKey(key, on, sep), val, sep);
  }

  /**
   * TypeScript-only extension. Remove all ordinal buckets for `key` from `on` onward.
   *
   * Empty `key` removes the whole DB branch.
   */
  remOnAllIoSet(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return this.delTop(db, new Uint8Array(0));
    }

    this.assertOpen();
    const start = suffix(onKey(key, on, sep), 0, sep);
    const keys: Uint8Array[] = [];
    for (const entry of this.scan(db, { start })) {
      const iokey = entry.key;
      const [onkey] = unsuffix(iokey, sep);
      const [ckey] = splitOnKey(onkey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      keys.push(new Uint8Array(iokey));
    }

    if (!keys.length) {
      return false;
    }

    this.transaction(() => {
      for (const iokey of keys) {
        this.removeRow(db, iokey);
      }
    });
    return true;
  }

  /**
   * TypeScript-only extension. Count members in one ordinal bucket from insertion ordinal `ion`.
   */
  cntOnIoSet(
    db: Table,
    key: Uint8Array,
    on = 0,
    ion = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.cntIoSet(db, onKey(key, on, sep), ion, sep);
  }

  /**
   * TypeScript-only extension. Count all members across ordinal buckets for `key` from `on` onward.
   */
  cntOnAllIoSet(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.assertOpen();
    if (!key.length) {
      return this.cntAll(db);
    }
    let count = 0;
    const start = suffix(onKey(key, on, sep), 0, sep);
    for (const entry of this.scan(db, { start })) {
      const [onkey] = unsuffix(entry.key, sep);
      const [ckey] = splitOnKey(onkey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      count += 1;
    }
    return count;
  }

  /**
   * TypeScript-only extension. Iterate `(key, on, val)` members in branch `top`.
   *
   * This is the branch-scan form of `OnIoSet*`, still based on lexicographic
   * physical key-prefix traversal.
   */
  *getOnTopIoSetItemIter(
    db: Table,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [onkey, val] of this.getTopIoSetItemIter(db, top, sep)) {
      const [key, on] = splitOnKey(onkey, sep);
      yield [key, on, val];
    }
  }

  /**
   * TypeScript-only extension. Iterate `(key, on, val)` members for ordinals `>= on`.
   *
   * Empty `key` iterates the whole DB.
   */
  *getOnAllIoSetItemIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    this.assertOpen();
    if (!key.length) {
      yield* this.getOnTopIoSetItemIter(db, new Uint8Array(0), sep);
      return;
    }
    const start = suffix(onKey(key, on, sep), 0, sep);
    for (const entry of this.scan(db, { start })) {
      const [onkey] = unsuffix(entry.key, sep);
      const cval = entry.value;
      const [ckey, con] = splitOnKey(onkey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      yield [ckey, con, cval];
    }
  }

  /**
   * TypeScript-only extension. Iterate the last member for each ordinal bucket.
   *
   * Empty `key` iterates all logical keys and ordinals in the DB.
   */
  *getOnAllIoSetLastItemIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    if (!key.length) {
      for (
        const [onkey, val] of this.getIoSetLastItemIterAll(
          db,
          new Uint8Array(0),
          sep,
        )
      ) {
        const [k, o] = splitOnKey(onkey, sep);
        yield [k, o, val];
      }
      return;
    }

    let last: [Uint8Array, number, Uint8Array] | null = null;
    for (
      const [ckey, con, cval] of this.getOnAllIoSetItemIter(db, key, on, sep)
    ) {
      if (last === null) {
        last = [ckey, con, cval];
        continue;
      }
      if (con !== last[1]) {
        yield last;
      }
      last = [ckey, con, cval];
    }
    if (last) {
      yield last;
    }
  }

  /**
   * TypeScript-only extension. Iterate backward over `(key, on, val)` members.
   *
   * Backward order is materialized from the forward iterator, then reversed.
   */
  *getOnAllIoSetItemBackIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on: number | null = null,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    const items = key.length
      ? [...this.getOnAllIoSetItemIter(db, key, 0, sep)]
      : [...this.getOnTopIoSetItemIter(db, new Uint8Array(0), sep)];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (key.length && on !== null && item[1] > on) {
        continue;
      }
      yield item;
    }
  }

  /**
   * TypeScript-only extension. Iterate backward over the last member per ordinal bucket.
   */
  *getOnAllIoSetLastItemBackIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on: number | null = null,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    const items = [...this.getOnAllIoSetLastItemIter(db, key, 0, sep)];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (key.length && on !== null && item[1] > on) {
        continue;
      }
      yield item;
    }
  }

  /*
   * Insertion-ordered duplicate family (`IoDup*`)
   * Logical shape: one physical key -> many native dupsort values.
   * Multiplicity: native LMDB dupsort values.
   * Ordering: hidden 33-byte value proem makes dupsort order equal insertion order.
   * Parity status: direct KERIpy analogs with TS naming tweaks.
   *
   * Use this when dupsort size constraints are acceptable; use `IoSet*` when
   * values may be too large for dupsort-backed storage.
   */

  /**
   * Add insertion-ordered duplicate values at `key`.
   *
   * Each stored value gets a hidden 33-byte proem (`32 hex chars + '.'`) so
   * LMDB's lexicographic duplicate ordering becomes logical insertion order.
   * Returned values later strip that proem away. Mirrors KERIpy `putIoDupVals`.
   */
  putIoDupVals(
    db: Table,
    key: Uint8Array,
    vals: Iterable<Uint8Array>,
  ): boolean {
    let result = false;
    const existing = new Set<string>(
      this.getIoDupVals(db, key).map((val) => bytesHex(val)),
    );
    let idx = 0;
    const last = this.getValLast(db, key);
    if (last) {
      idx = parseIoDupOrdinal(last) + 1;
    }

    this.assertOpen();
    this.transaction(() => {
      for (const val of vals) {
        const vh = bytesHex(val);
        if (existing.has(vh)) {
          continue;
        }
        this.putRow(db, key, withIoDupProem(idx, val));
        idx += 1;
        existing.add(vh);
        result = true;
      }
    });
    return result;
  }

  /**
   * Add one insertion-ordered duplicate value at `key` if absent.
   *
   * Mirrors KERIpy `addIoDupVal`.
   */
  addIoDupVal(
    db: Table,
    key: Uint8Array,
    val: Uint8Array | null,
  ): boolean {
    const single = val === null ? [new Uint8Array(0)] : [val];
    return this.putIoDupVals(db, key, single);
  }

  /**
   * Get insertion-ordered duplicate values at `key`, with the hidden proem removed.
   *
   * Ordering is logical insertion order because the hidden proem controls LMDB
   * dupsort ordering. Mirrors KERIpy `getIoDupVals`.
   */
  getIoDupVals(db: Table, key: Uint8Array): Uint8Array[] {
    return this.getVals(db, key).map((val) => stripIoDupProem(val));
  }

  /**
   * Iterate insertion-ordered duplicate values at `key`, with the hidden proem removed.
   *
   * Mirrors KERIpy `getIoDupValsIter`.
   */
  *getIoDupValsIter(
    db: Table,
    key: Uint8Array,
  ): Generator<Uint8Array> {
    for (const val of this.getValsIter(db, key)) {
      yield stripIoDupProem(val);
    }
  }

  /**
   * Get the most recently inserted logical duplicate value at `key`.
   *
   * This uses the lexicographically last stored proem-prefixed duplicate and
   * strips the hidden proem before returning. Mirrors KERIpy `getIoDupValLast`.
   */
  getIoDupValLast(
    db: Table,
    key: Uint8Array,
  ): Uint8Array | null {
    const last = this.getValLast(db, key);
    return last ? stripIoDupProem(last) : null;
  }

  /** Delete all insertion-ordered duplicates at `key`. Mirrors KERIpy `delIoDupVals`. */
  delIoDupVals(db: Table, key: Uint8Array): boolean {
    return this.delVals(db, key);
  }

  /**
   * Delete one insertion-ordered duplicate value at `key`, matching the stripped logical value.
   *
   * This performs a linear search over stored proem-prefixed duplicates. Mirrors
   * KERIpy `delIoDupVal`.
   */
  delIoDupVal(
    db: Table,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    this.assertOpen();
    for (const proVal of this.getVals(db, key)) {
      if (bytesEqual(stripIoDupProem(proVal), val)) {
        return this.removeRow(db, key, proVal);
      }
    }
    return false;
  }

  /** Count insertion-ordered duplicates at `key`. Mirrors KERIpy `cntIoDupVals`. */
  cntIoDups(db: Table, key: Uint8Array): number {
    return this.cntVals(db, key);
  }

  /**
   * Iterate `(key, val)` over branch `top`, stripping the hidden IoDup proem from each value.
   *
   * Mirrors KERIpy `getTopIoDupItemIter`.
   */
  *getTopIoDupItemIter(
    db: Table,
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    for (const [key, val] of this.getTopItemIter(db, top)) {
      yield [key, stripIoDupProem(val)];
    }
  }

  /*
   * Ordinal insertion-ordered duplicate family (`OnIoDup*`)
   * Logical shape: ordinal buckets, each bucket holding native dupsort duplicates.
   * Multiplicity: native LMDB dupsort values within each exposed ordinal key.
   * Ordering: exposed fixed-width ordinal in the key, hidden 33-byte proem in each duplicate value.
   * Parity status: direct KERIpy analogs plus a few TS-only convenience methods.
   */

  /**
   * TypeScript-only convenience adding insertion-ordered duplicates at one exact ordinal key.
   *
   * This is the ordinal-bucketed counterpart to `putIoDupVals`. KERIpy exposes
   * `addOnIoDupVal` and iterator-based accessors instead of this bulk helper.
   */
  putOnIoDupVals(
    db: Table,
    key: Uint8Array,
    on = 0,
    vals: Iterable<Uint8Array>,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.putIoDupVals(db, onKey(key, on, sep), vals);
  }

  /** Add one insertion-ordered duplicate at ordinal effective key. Mirrors KERIpy `addOnIoDupVal`. */
  addOnIoDupVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.addIoDupVal(db, onKey(key, on, sep), val);
  }

  /**
   * Append one insertion-ordered duplicate value at the next ordinal bucket for `key`.
   *
   * Mirrors KERIpy `appendOnIoDupVal`.
   */
  appendOnIoDupVal(
    db: Table,
    key: Uint8Array,
    val: Uint8Array,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.appendOnVal(db, key, withIoDupProem(0, val), sep);
  }

  /**
   * TypeScript-only convenience returning all logical duplicates at one exact ordinal.
   *
   * KERIpy exposes scan-style iterators across ordinals rather than this exact
   * per-ordinal list helper.
   */
  getOnIoDupVals(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Uint8Array[] {
    if (!key.length) {
      return [];
    }
    return this.getIoDupVals(db, onKey(key, on, sep));
  }

  /**
   * TypeScript-only convenience iterating logical duplicates at one exact ordinal.
   *
   * No direct KERIpy equivalent: KERIpy `getOnIoDupValIter` scans all ordinals
   * from `on` onward, which maps to `getOnIoDupIterAll` here.
   */
  *getOnIoDupValsIter(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    if (!key.length) {
      return;
    }
    yield* this.getIoDupValsIter(db, onKey(key, on, sep));
  }

  /**
   * TypeScript-only convenience fetching the last logical duplicate at one exact ordinal.
   */
  getOnIoDupLast(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Uint8Array | null {
    return this.getIoDupValLast(db, onKey(key, on, sep));
  }

  /** Iterate the last logical duplicate value per ordinal bucket. Mirrors KERIpy `getOnIoDupLastValIter`. */
  *getOnIoDupLastValIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, __, val] of this.getOnIoDupLastItemIter(db, key, on, sep)) {
      yield val;
    }
  }

  /** Iterate `(key, on, val)` where `val` is the last logical duplicate per ordinal bucket. Mirrors KERIpy `getOnIoDupLastItemIter`. */
  *getOnIoDupLastItemIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    this.assertOpen();
    const start = key.length ? onKey(key, on, sep) : new Uint8Array(0);
    let lonkey: Uint8Array | null = null;
    let lkey: Uint8Array | null = null;
    let lon = 0;
    let last: Uint8Array | null = null;

    for (const entry of this.scan(db, { start })) {
      const onkeyBytes = entry.key;
      const cval = entry.value;
      const [ckey, con] = splitOnKey(onkeyBytes, sep);
      if (key.length && !bytesEqual(ckey, key)) {
        break;
      }

      if (lonkey === null || !bytesEqual(lonkey, onkeyBytes)) {
        if (lonkey !== null && lkey && last) {
          yield [lkey, lon, stripIoDupProem(last)];
        }
        lonkey = new Uint8Array(onkeyBytes);
        lkey = ckey;
        lon = con;
      }
      last = cval;
    }

    if (lonkey !== null && lkey && last) {
      yield [lkey, lon, stripIoDupProem(last)];
    }
  }

  /**
   * Iterate `(key, on, val)` logical duplicates across a top branch.
   *
   * This mirrors the KERIpy helper added for normalized `OnIoDupSuber`
   * branch iteration and strips the hidden insertion-order proem from each
   * duplicate value before yielding it.
   */
  *getOnTopIoDupItemIter(
    db: Table,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [key, on, val] of this.getOnTopItemIter(db, top, sep)) {
      yield [key, on, stripIoDupProem(val)];
    }
  }

  /** Delete all insertion-ordered duplicates at one ordinal effective key. TypeScript-local rename of KERIpy `delOnIoDupVals`. */
  delOnIoDups(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.delIoDupVals(db, onKey(key, on, sep));
  }

  /** Delete one insertion-ordered duplicate at one ordinal effective key. Mirrors KERIpy `delOnIoDupVal`. */
  delOnIoDupVal(
    db: Table,
    key: Uint8Array,
    on = 0,
    val: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.delIoDupVal(db, onKey(key, on, sep), val);
  }

  /**
   * TypeScript-only convenience counting logical duplicates at one exact ordinal.
   *
   * KERIpy does not expose this exact count helper on `LMDBer`.
   */
  cntOnIoDups(
    db: Table,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.cntIoDups(db, onKey(key, on, sep));
  }

  /** Iterate backwards over logical duplicate values. Mirrors KERIpy `getOnIoDupValBackIter`. */
  *getOnIoDupValBackIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, __, val] of this.getOnIoDupItemBackIter(db, key, on, sep)) {
      yield val;
    }
  }

  /** Iterate backwards over `(key, on, val)` logical duplicates. Mirrors KERIpy `getOnIoDupItemBackIter`. */
  *getOnIoDupItemBackIter(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    const items = key.length
      ? [...this.getOnIoDupItemIterAll(db, key, 0, sep)].filter((item) => item[1] <= on)
      : [...this.getOnIoDupItemIterAll(db, new Uint8Array(0), 0, sep)];

    for (let i = items.length - 1; i >= 0; i--) {
      yield items[i];
    }
  }

  /**
   * Iterate logical duplicate values for ordinals `>= on`.
   *
   * TypeScript-local name for KERIpy `getOnIoDupValIter`.
   */
  *getOnIoDupIterAll(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, __, val] of this.getOnIoDupItemIterAll(db, key, on, sep)) {
      yield val;
    }
  }

  /**
   * Iterate `(key, on, val)` logical duplicates for ordinals `>= on`.
   *
   * TypeScript-local name for KERIpy `getOnIoDupItemIter`.
   */
  *getOnIoDupItemIterAll(
    db: Table,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [ckey, con, cval] of this.getOnAllItemIter(db, key, on, sep)) {
      yield [ckey, con, stripIoDupProem(cval)];
    }
  }
}

/** The public store contract from ADR-0015. Depend on this, not on a backend. */
export type DBer = Pick<BaseDBer, keyof BaseDBer>;
