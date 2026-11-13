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
import { PersistenceLatchedError, PersistenceReadError } from "../../core/errors.ts";
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
 * Where a composition's persistence stands:
 * - `healthy`: every task so far succeeded;
 * - `retrying`: the task at the head failed and is being retried in place, so nothing behind it runs yet;
 * - `latched`: a task failed through all its retries, and the composition accepts no more commits.
 */
export type PersistenceStatus = "healthy" | "retrying" | "latched";

/** Delays in milliseconds before each retry of a failed task: four attempts in about half a second. */
export const PERSISTENCE_RETRY_DELAYS: readonly number[] = Object.freeze([25, 100, 400]);

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The persistence order of one composition. Tasks run strictly one at a time,
 * outside any Effection scope, so cancelling a waiter never cancels a write.
 *
 * A failed task is retried in place on a fixed short schedule while it holds
 * the head of the queue, so no later task runs ahead of it. Every task the
 * library enqueues is safe to re-run: an adapter `write` applies one batch
 * atomically and idempotently, `clear` deletes what may already be gone, and
 * `close` releases what may already be released. A task that fails through its
 * retries latches the queue for good: every later task is skipped, because
 * applying a later batch over a lost earlier one would break prefix
 * durability. Recovery is a new composition with a new queue.
 */
export class PersistenceQueue {
  #tail: Promise<void> = Promise.resolve();
  #failure: { readonly error: unknown } | null = null;
  #retrying = false;
  readonly #retryDelays: readonly number[];

  /** @param retryDelays Delays before each retry; its length is the number of retries. */
  constructor(retryDelays: readonly number[] = PERSISTENCE_RETRY_DELAYS) {
    this.#retryDelays = [...retryDelays];
  }

  /** Append a task, retried on failure; skipped once the queue has latched. Run only re-runnable tasks here. */
  enqueue(task: () => Promise<void>): void {
    this.#append(task, false);
  }

  /** Append connection teardown, which still runs, once, after a latch so a handle is not left open. */
  release(task: () => Promise<void>): void {
    this.#append(task, true);
  }

  /**
   * Run `task` after everything enqueued before this call, and resolve with its result. It sees every earlier
   * commit durable, except after a latch, when it runs anyway and sees only the durable prefix; check `status()`.
   * Nothing enqueued after it runs until it settles. A throwing `task` rejects only this caller, with
   * `PersistenceReadError`; it is not retried and never latches the queue.
   */
  read<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => {
      try {
        return await task();
      } catch (error) {
        throw new PersistenceReadError("Persistence read failed", { cause: error });
      }
    });
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  /** The queue's state now; `retrying` lasts only while the head task is between attempts. */
  status(): PersistenceStatus {
    if (this.#failure) return "latched";
    return this.#retrying ? "retrying" : "healthy";
  }

  #append(task: () => Promise<void>, always: boolean): void {
    this.#tail = this.#tail.then(async () => {
      if (!this.#failure) return await this.#attempt(task);
      if (!always) return;
      try {
        await task();
      } catch {
        // Already latched; the recorded failure is the one reported.
      }
    });
  }

  /** Run `task`, retrying it in place on the schedule, and latch with its first failure when every attempt fails. */
  async #attempt(task: () => Promise<void>): Promise<void> {
    let first: { readonly error: unknown } | null = null;
    try {
      for (let attempt = 0;; attempt++) {
        try {
          return await task();
        } catch (error) {
          first ??= { error };
          if (attempt >= this.#retryDelays.length) {
            this.#failure = first;
            return;
          }
        }
        this.#retrying = true;
        await pause(this.#retryDelays[attempt]);
      }
    } finally {
      this.#retrying = false;
    }
  }

  /** Refuse new work once latched, with `PersistenceLatchedError` whose cause is the original failure. */
  assertHealthy(): void {
    if (this.#failure) throw this.#latched(this.#failure.error);
  }

  #latched(cause: unknown): PersistenceLatchedError {
    return new PersistenceLatchedError("Persistence failed; this composition accepts no more commits", { cause });
  }

  /** The outcome of everything enqueued so far, rejecting with `PersistenceLatchedError` once latched. */
  #settled(): Promise<void> {
    return this.#tail.then(() => this.assertHealthy());
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
 * a new queue, loading that prefix; the queue's own retries happen before it latches.
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
