/**
 * Browser-capable `DBer`: a `MemStore` mirror with write-behind persistence.
 *
 * ADR-0015 owns the durability model. Reads and writes are synchronous against
 * the mirror; each outermost commit enqueues one batch holding its net effect,
 * and a queue shared by a composition applies batches one at a time in global
 * commit order. Nothing here may reach `lmdb`, `node:` or the `Deno` global.
 *
 * Invariant: once the queue is joined with no failure, the mirror and the
 * persisted rows are byte-identical, which is why `reopen` joins before it loads.
 */

import { bytesEqual, bytesHex } from "cesr-ts";
import { call, ensure, type Operation } from "npm:effection@^3.6.0";
import { DatabaseOperationError } from "../../core/errors.ts";
import type { StoreIdentity, Table, TableEntry } from "./dber.ts";
import { MemStore, type StoreChange } from "./memstore.ts";
import type { StoreFamily, StoreOpener } from "./store-owner.ts";

/** One persisted table and the dupsort flag fixed when it was created. */
export interface PersistedTable {
  readonly name: string;
  readonly dupsort: boolean;
}

/** What one store has persisted, apart from its rows. */
export interface PersistedMeta {
  /** The `__version__` marker, or `null` when none was written. */
  readonly version: string | null;
  readonly tables: readonly PersistedTable[];
}

/** Store one row. Replaces `(table, key)` on a plain table; adds `(table, key, value)` on a dupsort one. */
export interface RowPut {
  readonly table: string;
  readonly key: Uint8Array;
  readonly value: Uint8Array;
}

/** Remove one row. `value` is set exactly when the table is dupsort, selecting that one duplicate. */
export interface RowDelete {
  readonly table: string;
  readonly key: Uint8Array;
  readonly value?: Uint8Array;
}

/**
 * The net effect of one commit. Row identities are distinct across `puts` and
 * `deletes`, so an adapter may apply them in any order.
 */
export interface PersistenceBatch {
  /** Tables first carried by this batch; the adapter creates them before writing rows. */
  readonly tables: readonly PersistedTable[];
  /** Present only when this commit changed the version marker. */
  readonly version?: string;
  readonly puts: readonly RowPut[];
  readonly deletes: readonly RowDelete[];
}

/**
 * Storage adapter behind one `WebDBer`. Its methods are only ever called one
 * at a time per store, never overlapping a `write`. A batch is the adapter's
 * to keep: it shares no bytes with the mirror.
 */
export interface Persistence {
  /** Describe what is persisted, connecting if needed; called first on every open. */
  meta(): Promise<PersistedMeta>;
  /** Every row of one table, in any order. */
  load(table: string): Promise<TableEntry[]>;
  /** Apply one batch atomically across its tables. Resolves only once it is durable. */
  write(batch: PersistenceBatch): Promise<void>;
  /** Delete everything persisted. Called with the connection released. */
  clear(): Promise<void>;
  /** Release the connection. A later `meta` reconnects. */
  close(): Promise<void>;
}

/**
 * The persistence order of one composition. Tasks run strictly one at a time,
 * outside any Effection scope, so cancelling a waiter never cancels a write.
 *
 * The first failure latches: every later task is skipped, because applying a
 * later batch over a lost earlier one would break prefix durability.
 */
export class PersistenceQueue {
  #tail: Promise<void> = Promise.resolve();
  #failure: { readonly error: unknown } | null = null;

  /** Append a task, which is skipped if an earlier one failed. */
  enqueue(task: () => Promise<void>): void {
    this.#append(task, false);
  }

  /** Append connection teardown, which still runs after a failure so a handle is not left open. */
  release(task: () => Promise<void>): void {
    this.#append(task, true);
  }

  #append(task: () => Promise<void>, always: boolean): void {
    this.#tail = this.#tail.then(async () => {
      if (this.#failure && !always) return;
      try {
        await task();
      } catch (error) {
        this.#failure ??= { error };
      }
    });
  }

  /** Refuse new work once latched. The original failure is the cause. */
  assertHealthy(): void {
    if (this.#failure) {
      throw new DatabaseOperationError("Persistence failed; this composition accepts no more commits", {
        cause: this.#failure.error,
      });
    }
  }

  /** The outcome of everything enqueued so far, rejecting with the recorded failure. */
  #settled(): Promise<void> {
    return this.#tail.then(() => {
      if (this.#failure) throw this.#failure.error;
    });
  }

  /** Wait until everything enqueued before this call is durable. Halting cancels only the wait. */
  *flushed(): Operation<void> {
    const settled = this.#settled();
    yield* call(() => settled);
  }

  /** Like `flushed`, but a halted caller still waits for the queue and still reports its failure. */
  *joined(): Operation<void> {
    const settled = this.#settled();
    yield* call(function*() {
      yield* ensure(() => call(() => settled));
      yield* call(() => settled);
    });
  }
}

/** A row identity's first prior state and its latest state within one commit. */
interface NetRow {
  readonly table: string;
  readonly dupsort: boolean;
  readonly key: Uint8Array;
  readonly before: Uint8Array | null;
  after: Uint8Array | null;
}

function sameValue(a: Uint8Array | null, c: Uint8Array | null): boolean {
  return a === null || c === null ? a === c : bytesEqual(a, c);
}

/** Collapse a commit's writes to the first prior and latest state of each row identity. */
function netRows(changes: readonly StoreChange[]): NetRow[] {
  const net = new Map<string, NetRow>();
  for (const change of changes) {
    if (change.kind !== "row") continue;
    const duplicate = change.dupsort ? bytesHex((change.before ?? change.after)!) : "";
    const identity = `${bytesHex(change.key)}/${duplicate}/${change.table}`;
    const seen = net.get(identity);
    if (seen) {
      seen.after = change.after;
    } else {
      net.set(identity, { ...change });
    }
  }
  return [...net.values()].filter((row) => !sameValue(row.before, row.after));
}

/** The version a commit leaves behind, or `undefined` when it ends where it began. */
function netVersion(changes: readonly StoreChange[]): string | undefined {
  const versions = changes.filter((change) => change.kind === "version");
  const first = versions.at(0);
  const last = versions.at(-1);
  return first && last && first.before !== last.after ? last.after : undefined;
}

/**
 * `MemStore` mirror whose commits persist through a `Persistence` adapter.
 *
 * After the queue latches, a commit already in the mirror stays there and stays
 * readable even though it was never persisted, and every later transaction
 * throws before touching the mirror, so the mirror stops changing. The durable
 * state is a prefix of the commit sequence. Recovery is a new composition, with
 * a new queue, loading that prefix; there is no retry.
 */
export class WebDBer extends MemStore {
  readonly #persistence: Persistence;
  readonly #queue: PersistenceQueue;
  /** Tables not yet carried by a batch, so an unwritten table still persists its dupsort flag. */
  readonly #pendingTables = new Map<string, boolean>();
  #connected = false;

  constructor(options: StoreIdentity, persistence: Persistence, queue: PersistenceQueue) {
    super(options);
    this.#persistence = persistence;
    this.#queue = queue;
  }

  /**
   * Join the queue, then bulk-load every persisted table before returning, so
   * reads never suspend. A latched queue refuses, reporting its failure.
   */
  override *reopen(options: StoreIdentity = {}): Operation<boolean> {
    yield* this.close(options.clear ?? false);
    const persistence = this.#persistence;
    this.#connected = true;
    const meta = yield* call(() => persistence.meta());
    const tables = [];
    for (const { name, dupsort } of meta.tables) {
      tables.push({ name, dupsort, rows: yield* call(() => persistence.load(name)) });
    }
    this.loadContents(tables, meta.version);
    return yield* super.reopen(options);
  }

  /**
   * Stop accepting work, drain and join the queue even when cancelled, and
   * report any failure. A latched store is neither cleared nor reusable, and
   * every later close reports the same failure.
   */
  override *close(clear = false): Operation<boolean> {
    if (clear) {
      this.#pendingTables.clear();
    } else if (this.opened && !this.readonly) {
      this.#carryPendingTables();
    }
    yield* super.close();
    const persistence = this.#persistence;
    if (this.#connected) {
      this.#connected = false;
      this.#queue.release(() => persistence.close());
    }
    if (clear) this.#queue.enqueue(() => persistence.clear());
    yield* this.#queue.joined();
    if (clear) yield* super.close(true);
    return true;
  }

  /** Bind a table; a new one is physically created by the batch that first carries it. */
  override openTable(name: string, options: { dupsort?: boolean } = {}): Table {
    if (this.readonly || !this.opened || !name || this.hasTable(name)) return super.openTable(name, options);
    this.#queue.assertHealthy();
    const table = super.openTable(name, options);
    this.#pendingTables.set(name, options.dupsort ?? false);
    return table;
  }

  override transaction<T>(fn: () => T): T {
    this.assertOpen();
    this.#queue.assertHealthy();
    return super.transaction(fn);
  }

  /** Completes when every earlier commit in this composition is durable, or fails with its recorded failure. */
  override *flushed(): Operation<void> {
    this.assertOpen();
    if (!this.readonly) this.#carryPendingTables();
    yield* this.#queue.flushed();
  }

  protected override committed(changes: readonly StoreChange[]): void {
    const rows = netRows(changes);
    const version = netVersion(changes);
    if (rows.length === 0 && version === undefined) return;
    const copy = (bytes: Uint8Array) => new Uint8Array(bytes);
    this.#enqueue({
      tables: this.#takePendingTables(),
      ...(version === undefined ? {} : { version }),
      puts: rows.filter(({ after }) => after !== null).map(({ table, key, after }) => ({
        table,
        key: copy(key),
        value: copy(after!),
      })),
      deletes: rows.filter(({ after }) => after === null).map(({ table, dupsort, key, before }) => ({
        table,
        key: copy(key),
        ...(dupsort ? { value: copy(before!) } : {}),
      })),
    });
  }

  #enqueue(batch: PersistenceBatch): void {
    const persistence = this.#persistence;
    this.#queue.enqueue(() => persistence.write(batch));
  }

  /** Drain pending creations, dropping any a rollback undid. */
  #takePendingTables(): PersistedTable[] {
    const tables = [...this.#pendingTables].filter(([name]) => this.hasTable(name));
    this.#pendingTables.clear();
    return tables.map(([name, dupsort]) => ({ name, dupsort }));
  }

  /** Persist creations no commit carried, so `flushed` and `close` cover a table left empty. */
  #carryPendingTables(): void {
    const tables = this.#takePendingTables();
    if (tables.length > 0) this.#enqueue({ tables, puts: [], deletes: [] });
  }
}

/** A `StoreOpener` of `WebDBer`s bound to one queue, which is what makes a composition one commit order. */
export class WebStoreOpener implements StoreOpener {
  readonly queue = new PersistenceQueue();

  constructor(readonly persistenceFor: (family: StoreFamily, identity: StoreIdentity) => Persistence) {}

  create(family: StoreFamily, identity: StoreIdentity): WebDBer {
    return new WebDBer(identity, this.persistenceFor(family, identity), this.queue);
  }
}
