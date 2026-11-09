/**
 * In-memory `DBer` backend: one bytewise-sorted row array per table.
 *
 * ADR-0015 owns the semantics and `LMDBer` is the reference where the ADR is
 * silent. Nothing here may reach `lmdb`, `node:` or the `Deno` global.
 *
 * Invariants:
 * - each table's `rows` stay sorted by key, then by value on a dupsort table;
 * - stored rows are immutable and every byte array entering or leaving is a
 *   fresh copy, so callers can neither reach nor alias store state;
 * - every mutation runs inside `transaction` and logs its exact inverse.
 */

import { b, bytesHex, t } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { compareBytes, startsWith } from "../../core/bytes.ts";
import { DatabaseKeyError, DatabaseNotOpenError, DatabaseOperationError } from "../../core/errors.ts";
import { BaseDBer, MAX_KEY_BYTES, type ScanOptions, type StoreIdentity, type Table, type TableEntry } from "./dber.ts";
import type { StoreFamily, StoreOpener } from "./store-owner.ts";

const DEFAULT_DB_VERSION = "1.0.0";
const EMPTY = new Uint8Array(0);

/** One physical row. Never mutated in place, so rollback can reinstall it. */
interface Row {
  readonly key: Uint8Array;
  readonly value: Uint8Array;
}

/** One logged inverse. `rowEffect` separates row writes from table creation for `writeVersion`. */
interface UndoEntry {
  readonly rowEffect: boolean;
  revert(): void;
}

/** Copy into a plain `Uint8Array`; `slice` on a Node `Buffer` would alias its source. */
function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function assertWritableKey(key: Uint8Array): void {
  if (key.length === 0 || key.length > MAX_KEY_BYTES) {
    throw new DatabaseKeyError(`Key is empty, too big, or wrong size: ${key.length} bytes`);
  }
}

function assertDupValueSize(val: Uint8Array): void {
  if (val.length === 0 || val.length > MAX_KEY_BYTES) {
    throw new DatabaseKeyError(`Duplicate value is empty or larger than ${MAX_KEY_BYTES} bytes: ${val.length} bytes`);
  }
}

/** Point reads and deletes reject an empty key; an over-long key can only be absent. */
function isStorableKey(key: Uint8Array): boolean {
  if (key.length === 0) throw new DatabaseKeyError("Key is empty, too big, or wrong size: 0 bytes");
  return key.length <= MAX_KEY_BYTES;
}

function isThenable(value: unknown): boolean {
  return (typeof value === "object" || typeof value === "function") && value !== null
    && typeof (value as { then?: unknown }).then === "function";
}

/** One named table. A plain table ignores values when ordering and identifying rows. */
class MemTable {
  constructor(
    readonly name: string,
    readonly dupsort: boolean,
    readonly rows: Row[] = [],
  ) {}

  /** Binary search for the first row satisfying a predicate monotone in sort order. */
  private seek(isPast: (row: Row) => boolean): number {
    let low = 0;
    let high = this.rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (isPast(this.rows[mid])) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    return low;
  }

  private compare(row: Row, key: Uint8Array, value?: Uint8Array): number {
    const order = compareBytes(row.key, key);
    return order !== 0 || !this.dupsort || value === undefined ? order : compareBytes(row.value, value);
  }

  /** First row not below `(key, value)`; without a value, the key's first duplicate. */
  lowerBound(key: Uint8Array, value?: Uint8Array): number {
    return this.seek((row) => this.compare(row, key, value) >= 0);
  }

  /** First row above `(key, value)`; without a value, the row past every duplicate of the key. */
  upperBound(key: Uint8Array, value?: Uint8Array): number {
    return this.seek((row) => this.compare(row, key, value) > 0);
  }

  /** True when `index` holds exactly `(key, value)`, or `key` when no value is given. */
  matches(index: number, key: Uint8Array, value?: Uint8Array): boolean {
    return index < this.rows.length && this.compare(this.rows[index], key, value) === 0;
  }

  /** The `[low, high)` row range whose keys begin with `top`. */
  branch(top: Uint8Array): [number, number] {
    return [
      this.lowerBound(top),
      this.seek((row) => compareBytes(row.key, top) > 0 && !startsWith(row.key, top)),
    ];
  }
}

/**
 * Sorted in-memory store with real commit and rollback.
 *
 * Contents belong to the instance. They survive `close` and `reopen` until
 * `close(true)` or `reopen({ clear: true })`, including on a `temp` store,
 * which is what `LMDBer` does with its reused temp path. Each reopen rebinds
 * table handles, so a handle from before it is refused.
 *
 * Scans hold a position, not an index: each step re-seeks past the last row
 * yielded, so a concurrent insert, delete or rollback cannot skip or repeat an
 * untouched row. A scan inside a writer sees that writer's rows as they change.
 */
export class MemStore extends BaseDBer {
  readonly #name: string;
  readonly #base: string;
  #temp: boolean;
  #opened = false;
  /** True once a writable open has created the contents, like LMDB's data file. */
  #created = false;
  #tables = new Map<string, MemTable>();
  #version: string | null = null;
  #writeVersion = 0;
  /** One log for every transaction depth; a savepoint is just an index into it. */
  #undo: UndoEntry[] = [];
  #depth = 0;
  public readonly: boolean;

  constructor(options: StoreIdentity = {}) {
    super();
    this.#name = options.name || "main";
    this.#base = options.base || "";
    this.#temp = options.temp ?? false;
    this.readonly = options.readonly ?? false;
  }

  get name(): string {
    return this.#name;
  }

  get base(): string {
    return this.#base;
  }

  get opened(): boolean {
    return this.#opened;
  }

  get temp(): boolean {
    return this.#temp;
  }

  get inWriteTransaction(): boolean {
    this.assertOpen();
    return this.#depth > 0;
  }

  /** Counts commits that wrote rows; it keeps counting across reopen of one instance. */
  get writeVersion(): number {
    this.assertOpen();
    return this.#writeVersion;
  }

  /** Open or reopen the contents. A readonly open of never-created contents reports `false`. */
  *reopen(options: StoreIdentity = {}): Operation<boolean> {
    this.readonly = options.readonly ?? this.readonly;
    this.#temp = options.temp ?? this.#temp;
    if (options.clear) {
      this.#discard();
    }
    this.#opened = false;
    if (this.readonly && !this.#created) return false;
    const existed = this.#created;
    this.#tables = new Map(
      [...this.#tables].map(([name, table]) => [name, new MemTable(name, table.dupsort, table.rows)]),
    );
    this.#created = true;
    this.#opened = true;
    if (!this.readonly && (!existed || this.#temp)) {
      this.setVer(DEFAULT_DB_VERSION);
    }
    return true;
  }

  /** Close the store, deleting its contents when `clear` is set. Repeating is harmless. */
  *close(clear = false): Operation<boolean> {
    if (clear) {
      this.#discard();
    }
    this.#opened = false;
    return true;
  }

  #discard(): void {
    this.#tables = new Map();
    this.#version = null;
    this.#created = false;
  }

  /**
   * Bind a table, creating it on a writable store. The flag from creation wins
   * over a later differing request. An absent table on a readonly store yields
   * no handle, as `LMDBer` does, so optional bindings can probe `hasTable`.
   */
  openTable(name: string, options: { dupsort?: boolean } = {}): Table {
    this.assertOpen();
    if (!name) throw new DatabaseKeyError("Table name must not be empty");
    const existing = this.#tables.get(name);
    if (existing) return existing as unknown as Table;
    if (this.readonly) return undefined as unknown as Table;
    const table = new MemTable(name, options.dupsort ?? false);
    this.#tables.set(name, table);
    if (this.#depth > 0) {
      this.#undo.push({ rowEffect: false, revert: () => this.#tables.delete(name) });
    }
    return table as unknown as Table;
  }

  hasTable(name: string): boolean {
    this.assertOpen();
    if (!name) throw new DatabaseKeyError("Table name must not be empty");
    return this.#tables.has(name);
  }

  /**
   * Run `fn` atomically. Only the outermost commit publishes; a nested
   * transaction is a savepoint, and any throw restores the state at its start.
   * A thenable result is a caller-contract error, rolled back like a throw.
   */
  transaction<T>(fn: () => T): T {
    this.assertOpen();
    if (this.readonly) throw new DatabaseOperationError(`Store "${this.#name}" is read-only`);
    const savepoint = this.#undo.length;
    this.#depth += 1;
    try {
      const result = fn();
      if (isThenable(result)) throw new DatabaseOperationError("Transaction callback must be synchronous");
      if (this.#depth === 1) {
        if (this.#undo.some((entry) => entry.rowEffect)) {
          this.#writeVersion += 1;
        }
        this.#undo.length = 0;
      }
      return result;
    } catch (error) {
      while (this.#undo.length > savepoint) {
        this.#undo.pop()!.revert();
      }
      throw error;
    } finally {
      this.#depth -= 1;
    }
  }
  *flushed(): Operation<void> {
    this.assertOpen();
  }

  /** This backend retains no read view, so an open store has nothing to discard. */
  refreshRead(): void {
    this.assertOpen();
  }

  getVer(): string | null {
    this.assertOpen();
    return this.#version || null;
  }

  setVer(val: string): void {
    this.transaction(() => {
      const prior = this.#version;
      this.#version = t(b(val));
      this.#undo.push({ rowEffect: true, revert: () => this.#version = prior });
    });
  }

  /**
   * Walk rows in order, re-seeking from the last row after every yield so the
   * table may change between steps. Empty bounds count as absent and a bound
   * applies to the whole key, including all of its duplicates.
   */
  *#walk(table: Table, options: ScanOptions, distinct: boolean): Generator<Row> {
    const reverse = options.reverse ?? false;
    const start = options.start?.length ? options.start : undefined;
    const end = options.end?.length ? options.end : undefined;
    let mem = this.#resolve(table);
    let index: number;
    if (start === undefined) {
      index = reverse ? mem.rows.length - 1 : 0;
    } else if (reverse) {
      index = (options.exclusiveStart ? mem.lowerBound(start) : mem.upperBound(start)) - 1;
    } else {
      index = options.exclusiveStart ? mem.upperBound(start) : mem.lowerBound(start);
    }
    for (let count = 0; options.limit === undefined || count < options.limit; count++) {
      const row: Row | undefined = mem.rows[index];
      if (row === undefined) return;
      if (end !== undefined && (reverse ? compareBytes(row.key, end) <= 0 : compareBytes(row.key, end) >= 0)) return;
      yield row;
      mem = this.#resolve(table);
      const value = distinct ? undefined : row.value;
      index = reverse ? mem.lowerBound(row.key, value) - 1 : mem.upperBound(row.key, value);
    }
  }

  *scan(table: Table, options: ScanOptions = {}): Generator<TableEntry> {
    for (const row of this.#walk(table, options, false)) {
      yield { key: copyBytes(row.key), value: copyBytes(row.value) };
    }
  }

  *scanKeys(table: Table, options: ScanOptions = {}): Generator<Uint8Array> {
    for (const row of this.#walk(table, options, true)) {
      yield copyBytes(row.key);
    }
  }

  protected assertOpen(): void {
    if (!this.#opened) throw new DatabaseNotOpenError(`Store "${this.#name}" is not open`);
  }

  /** Reach the table behind a handle, refusing one this open store did not issue. */
  #resolve(table: Table): MemTable {
    this.assertOpen();
    const mem = table as unknown as MemTable | undefined;
    if (!mem || this.#tables.get(mem.name) !== mem) {
      throw new DatabaseOperationError("Table handle is not valid for this open store");
    }
    return mem;
  }

  /** Validate and store one row inside the active transaction. An identical dupsort pair is a no-op. */
  #insert(mem: MemTable, key: Uint8Array, val: Uint8Array): void {
    assertWritableKey(key);
    if (mem.dupsort) {
      assertDupValueSize(val);
    }
    const index = mem.lowerBound(key, val);
    const row: Row = { key: copyBytes(key), value: copyBytes(val) };
    if (!mem.matches(index, key, val)) {
      mem.rows.splice(index, 0, row);
      this.#undo.push({ rowEffect: true, revert: () => mem.rows.splice(index, 1) });
    } else if (!mem.dupsort) {
      const prior = mem.rows[index];
      mem.rows[index] = row;
      this.#undo.push({ rowEffect: true, revert: () => mem.rows[index] = prior });
    }
  }

  #removeAt(mem: MemTable, index: number): void {
    const [row] = mem.rows.splice(index, 1);
    this.#undo.push({ rowEffect: true, revert: () => mem.rows.splice(index, 0, row) });
  }

  /** Remove `[low, high)` from the tail, which also makes a whole-table delete linear. */
  #removeRange(mem: MemTable, low: number, high: number): boolean {
    for (let index = high - 1; index >= low; index--) {
      this.#removeAt(mem, index);
    }
    return high > low;
  }

  protected putRow(table: Table, key: Uint8Array, val: Uint8Array): void {
    const mem = this.#resolve(table);
    this.transaction(() => this.#insert(mem, key, val));
  }

  /** On a dupsort table `val` selects one duplicate; a plain table ignores it, as LMDB does. */
  protected removeRow(table: Table, key: Uint8Array, val?: Uint8Array): boolean {
    const mem = this.#resolve(table);
    return this.transaction(() => {
      if (!isStorableKey(key)) return false;
      if (val === undefined || !mem.dupsort) return this.#removeRange(mem, mem.lowerBound(key), mem.upperBound(key));
      if (val.length === 0) return false; // an empty duplicate can never be stored
      assertDupValueSize(val);
      const index = mem.lowerBound(key, val);
      if (!mem.matches(index, key, val)) return false;
      this.#removeAt(mem, index);
      return true;
    });
  }

  /** Insert only when `key` is absent; on a dupsort table any existing duplicate counts. */
  putVal(table: Table, key: Uint8Array, val: Uint8Array): boolean {
    const mem = this.#resolve(table);
    return this.transaction(() => {
      assertWritableKey(key);
      if (mem.matches(mem.lowerBound(key), key)) return false;
      this.#insert(mem, key, val);
      return true;
    });
  }

  /** Overwrite a plain key's value; on a dupsort table this adds a duplicate. */
  setVal(table: Table, key: Uint8Array, val: Uint8Array): boolean {
    this.putRow(table, key, val);
    return true;
  }

  getVal(table: Table, key: Uint8Array): Uint8Array | null {
    const mem = this.#resolve(table);
    if (!isStorableKey(key)) return null;
    const index = mem.lowerBound(key);
    return mem.matches(index, key) ? copyBytes(mem.rows[index].value) : null;
  }

  delVal(table: Table, key: Uint8Array, val?: Uint8Array): boolean {
    return this.removeRow(table, key, val);
  }

  cnt(table: Table): number {
    return this.#resolve(table).rows.length;
  }

  cntAll(table: Table): number {
    return this.cnt(table);
  }

  cntTop(table: Table, top: Uint8Array = EMPTY): number {
    const [low, high] = this.#resolve(table).branch(top);
    return high - low;
  }

  delTop(table: Table, top: Uint8Array = EMPTY): boolean {
    const mem = this.#resolve(table);
    const [low, high] = mem.branch(top);
    return high > low && this.transaction(() => this.#removeRange(mem, low, high));
  }

  *getTopItemIter(table: Table, top: Uint8Array = EMPTY): Generator<[Uint8Array, Uint8Array]> {
    for (const row of this.#walk(table, { start: top }, false)) {
      if (!startsWith(row.key, top)) return;
      yield [copyBytes(row.key), copyBytes(row.value)];
    }
  }

  /** Add each value not already present; reports `false` if any supplied value existed. */
  putVals(table: Table, key: Uint8Array, vals: Iterable<Uint8Array>): boolean {
    const mem = this.#resolve(table);
    const existing = new Set(this.getVals(table, key).map((val) => bytesHex(val)));
    let result = true;
    this.transaction(() => {
      for (const val of vals) {
        const hex = bytesHex(val);
        if (existing.has(hex)) {
          result = false;
          continue;
        }
        this.#insert(mem, key, val);
        existing.add(hex);
      }
    });
    return result;
  }

  addVal(table: Table, key: Uint8Array, val: Uint8Array): boolean {
    return this.putVals(table, key, [val]);
  }

  /** Duplicate reads treat an empty or over-long key as simply absent, as `LMDBer` does. */
  getVals(table: Table, key: Uint8Array): Uint8Array[] {
    const mem = this.#resolve(table);
    if (key.length === 0 || key.length > MAX_KEY_BYTES) return [];
    return mem.rows.slice(mem.lowerBound(key), mem.upperBound(key)).map((row) => copyBytes(row.value));
  }

  getValLast(table: Table, key: Uint8Array): Uint8Array | null {
    return this.getVals(table, key).at(-1) ?? null;
  }

  *getValsIter(table: Table, key: Uint8Array): Generator<Uint8Array> {
    yield* this.getVals(table, key);
  }

  /** Count duplicates. Like LMDB, a plain table holding `key` refuses this dupsort-only call. */
  cntVals(table: Table, key: Uint8Array): number {
    const mem = this.#resolve(table);
    if (key.length === 0 || key.length > MAX_KEY_BYTES) return 0;
    const count = mem.upperBound(key) - mem.lowerBound(key);
    if (count > 0 && !mem.dupsort) throw new DatabaseOperationError("Duplicate count requires a dupsort table");
    return count;
  }

  delVals(table: Table, key: Uint8Array): boolean {
    return this.removeRow(table, key);
  }

  /** First duplicate at `key` not below `start`; `start` is an unvalidated scan-style bound. */
  seekVal(table: Table, key: Uint8Array, start?: Uint8Array): Uint8Array | null {
    const mem = this.#resolve(table);
    if (key.length === 0 || key.length > MAX_KEY_BYTES) return null;
    const bound = start?.length ? start : undefined;
    const index = mem.lowerBound(key, bound);
    if (!mem.matches(index, key)) return null;
    if (bound !== undefined && !mem.dupsort) {
      throw new DatabaseOperationError("Duplicate seek requires a dupsort table");
    }
    return copyBytes(mem.rows[index].value);
  }
}

/** A `StoreOpener` of closed, independent in-memory stores. Place is meaningless here. */
export class MemStoreOpener implements StoreOpener {
  create(_family: StoreFamily, identity: StoreIdentity): MemStore {
    return new MemStore(identity);
  }
}
