/**
 * IndexedDB `Persistence` for `WebDBer`.
 *
 * One database per store family and identity holds every logical table in a
 * single `rows` object store, plus a `meta` store for the version marker and one
 * record per table. Tables are not object stores, so adding a table is a plain
 * write, never a schema `versionchange` that another open connection could
 * block indefinitely. This departs from the plan's "one object store per
 * table", which ADR-0015 permits as the alternative to handling `versionchange`.
 *
 * `WebDBer` mirrors the whole store in memory, sorts what it loads and only asks
 * storage to persist rows by exact identity, so storage needs no ordering,
 * ranges or comparable keys. Rows therefore have an out-of-line plain string
 * key `${hex(key)}.${hex(dup)}.${table}`: `dup` is the duplicate value on a
 * dupsort table and empty on a plain one, unique because hex has no `.`. The value is a
 * self-describing record `{t, k, v}` of table name, key and value, the binary
 * parts as `ArrayBuffer`s. A put on the same identity overwrites, and each
 * duplicate has its own id. Meta records are `table:${name}` ->
 * `{kind: "table", name, dupsort}` and `version` -> `{kind: "version", version}`.
 * Because each table has its own record, creating a table is atomic with the
 * batch that first carries it and never a read-modify-write.
 *
 * No key contains a binary element: WebKit's on-disk IndexedDB mis-reads a binary
 * element of an array key that is not the last (format 1 used such keys). Binary
 * lives only in values. Version 2 is a new format under the same database name,
 * and upgrading deletes and recreates both stores without migration.
 *
 * `open` reads `rows` and `meta` in one readonly transaction with two unbounded
 * `getAll` calls and groups rows by table. A row whose table has no record is
 * contradictory durable state and raises `MissingDurableStateError`.
 *
 * The family is part of the database name because a composition's stores share
 * one `name` and `base`; without it a Baser and Keeper would share a database,
 * a version marker and a `clear`. A temp store is named apart from a durable one
 * so clearing it cannot delete durable data of the same name.
 *
 * `write` is one `readwrite` transaction with strict durability and settles on
 * the transaction's `complete` event, never on a request's `success`.
 *
 * Another tab's upgrade or delete fires `versionchange` here, and the browser
 * may kill the connection and fire `close`. The connection closes at once on
 * `versionchange` so that tab is never blocked, and either event leaves this
 * adapter lost with a named error: its next `write` rejects, and so does
 * every retry of it (a write never reconnects), which latches the queue,
 * because writing on after another context deleted the database would break
 * prefix durability. A new `open` reconnects. Single-writer
 * exclusion is the composition's job, not this adapter's.
 *
 * Opening is refused with a named error when an older connection blocks the
 * version upgrade, and a connection that arrives after that refusal is closed.
 * A blocked `clear` rejects. Our own connection is already closed, and ours
 * close on `versionchange`, so only a foreign connection can block. Reads settle on
 * their transaction's `complete`, like writes: WebKit reports `blocked` for a
 * connection whose close is still waiting on a finishing read transaction. The browser
 * keeps the delete request pending and performs it once that connection closes,
 * which is what `clear` asked for.
 */

import { bytesHex } from "cesr-ts";
import { DatabaseOperationError, MissingDurableStateError } from "../../core/errors.ts";
import type { StoreIdentity, TableEntry } from "./dber.ts";
import type { LoadedTable } from "./memstore.ts";
import type { StoreFamily } from "./store-owner.ts";
import type { PersistedStore, Persistence, PersistenceBatch } from "./webdber.ts";

const ROWS = "rows";
const META = "meta";
const VERSION_KEY = "version";
const TABLE_PREFIX = "table:";
const FORMAT_VERSION = 2;

/** One persisted row: its table, and its key and value as exact-length buffers. */
interface RowRecord {
  readonly t: string;
  readonly k: ArrayBuffer;
  readonly v: ArrayBuffer;
}

/** A table's meta record. */
interface TableRecord {
  readonly kind: "table";
  readonly name: string;
  readonly dupsort: boolean;
}

/** The version marker's meta record. */
interface VersionRecord {
  readonly kind: "version";
  readonly version: string;
}

/** An exact-length `ArrayBuffer` copy, since `.buffer` of a view may span more bytes. */
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

/** The row's string key; `duplicate` is the dupsort value, or `undefined` on a plain table. */
function rowId(table: string, key: Uint8Array, duplicate: Uint8Array | undefined): string {
  return `${bytesHex(key)}.${duplicate ? bytesHex(duplicate) : ""}.${table}`;
}

/** Settle with a request's result. Only valid inside a transaction that is still open. */
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Settle on `complete` or fail with the real cause on `abort` or `error`. */
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let cause: unknown;
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => cause ??= (event.target as IDBRequest | null)?.error;
    transaction.onabort = () =>
      reject(
        new DatabaseOperationError("IndexedDB transaction aborted", {
          cause: transaction.error ?? cause,
        }),
      );
  });
}

/** `Persistence` over IndexedDB. Methods are called one at a time by `WebDBer`. */
export class IndexedDbPersistence implements Persistence {
  readonly #databaseName: string;
  readonly #factory: IDBFactory;
  /** Dupsort flag per table, learned from `open` and from each batch that creates one. */
  readonly #dupsort = new Map<string, boolean>();
  #db: IDBDatabase | null = null;
  #lost: Error | null = null;

  /**
   * @param family Store family; with `identity` it chooses the database.
   * @param identity Store identity; `name`, `base` and `temp` choose the database.
   * @param factory Defaults to the global `indexedDB`; inject it outside a browser.
   */
  constructor(family: StoreFamily, identity: StoreIdentity, factory: IDBFactory = globalThis.indexedDB) {
    const place = [identity.base ?? "", identity.name ?? "", family.tail, identity.temp ? "temp" : "durable"];
    this.#databaseName = `keri-ts:${JSON.stringify(place)}`;
    this.#factory = factory;
  }

  #connect(): Promise<IDBDatabase> {
    if (this.#db) return Promise.resolve(this.#db);
    if (!this.#factory) throw new DatabaseOperationError("IndexedDB is not available in this environment");
    return new Promise((resolve, reject) => {
      let refused = false;
      const request = this.#factory.open(this.#databaseName, FORMAT_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        // Format 1 used array keys; it is dropped, not migrated.
        if (event.oldVersion === 1) {
          db.deleteObjectStore(ROWS);
          db.deleteObjectStore(META);
        }
        db.createObjectStore(ROWS);
        db.createObjectStore(META);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        refused = true;
        reject(
          new DatabaseOperationError(
            `Cannot open ${this.#databaseName}: another connection blocks its upgrade to format ${FORMAT_VERSION}`,
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        if (refused) return db.close();
        db.onversionchange = () => this.#abandon(db, "closed by another context's versionchange");
        db.onclose = () => this.#abandon(db, "closed abnormally by the browser");
        this.#lost = null;
        this.#db = db;
        resolve(db);
      };
    });
  }

  /** Drop `db` as this adapter's connection and remember why, so the next use fails with that cause. */
  #abandon(db: IDBDatabase, reason: string): void {
    db.close();
    if (this.#db === db) {
      this.#db = null;
      this.#lost = new DatabaseOperationError(`IndexedDB connection ${reason}`);
    }
  }

  /** The live connection, or the reason there is none. */
  #connection(): IDBDatabase {
    if (this.#db) return this.#db;
    throw this.#lost ?? new DatabaseOperationError("IndexedDB persistence is not connected");
  }

  async open(): Promise<PersistedStore> {
    const db = await this.#connect();
    const transaction = db.transaction([ROWS, META], "readonly");
    // Settle on `complete`: a connection with a transaction still finishing is not yet closed.
    const [, rows, records] = await Promise.all([
      completion(transaction),
      result(transaction.objectStore(ROWS).getAll() as IDBRequest<RowRecord[]>),
      result(transaction.objectStore(META).getAll() as IDBRequest<Array<TableRecord | VersionRecord>>),
    ]);
    this.#dupsort.clear();
    const tables = new Map<string, TableEntry[]>();
    const loaded: LoadedTable[] = [];
    let version: string | null = null;
    for (const record of records) {
      if (record.kind === "version") {
        version = record.version;
      } else {
        const entries: TableEntry[] = [];
        tables.set(record.name, entries);
        this.#dupsort.set(record.name, record.dupsort);
        loaded.push({ name: record.name, dupsort: record.dupsort, rows: entries });
      }
    }
    for (const { t, k, v } of rows) {
      const entries = tables.get(t);
      if (!entries) {
        throw new MissingDurableStateError(`Persisted row belongs to table ${t}, which has no table record`);
      }
      entries.push({ key: new Uint8Array(k), value: new Uint8Array(v) });
    }
    return { version, tables: loaded };
  }

  write(batch: PersistenceBatch): Promise<void> {
    let transaction: IDBTransaction;
    try {
      transaction = this.#connection().transaction([ROWS, META], "readwrite", { durability: "strict" });
    } catch (error) {
      return Promise.reject(error);
    }
    const done = completion(transaction);
    try {
      const meta = transaction.objectStore(META);
      const rows = transaction.objectStore(ROWS);
      for (const { name, dupsort } of batch.tables) {
        this.#dupsort.set(name, dupsort);
        meta.put({ kind: "table", name, dupsort } satisfies TableRecord, `${TABLE_PREFIX}${name}`);
      }
      if (batch.version !== undefined) {
        meta.put({ kind: "version", version: batch.version } satisfies VersionRecord, VERSION_KEY);
      }
      for (const { table, key, value } of batch.puts) {
        const dupsort = this.#dupsort.get(table);
        if (dupsort === undefined) throw new DatabaseOperationError(`Unknown table ${table}`);
        rows.put(
          { t: table, k: buffer(key), v: buffer(value) } satisfies RowRecord,
          rowId(table, key, dupsort ? value : undefined),
        );
      }
      for (const { table, key, value } of batch.deletes) {
        rows.delete(rowId(table, key, value));
      }
    } catch (error) {
      transaction.abort();
      return done.catch(() => {
        throw error;
      });
    }
    return done;
  }

  async clear(): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const request = this.#factory.deleteDatabase(this.#databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new DatabaseOperationError(
            `Cannot clear ${this.#databaseName}: another connection holds it open; the delete stays pending until it closes`,
          ),
        );
    });
    this.#dupsort.clear();
  }

  close(): Promise<void> {
    this.#db?.close();
    this.#db = null;
    this.#lost = null;
    return Promise.resolve();
  }
}
