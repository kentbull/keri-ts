/**
 * IndexedDB `Persistence` for `WebDBer`.
 *
 * One database per store family and identity holds every logical table in a
 * single `rows` object store, plus a `meta` store for the version marker and each table's
 * dupsort flag. Tables are not object stores. Adding a table is therefore a
 * plain write, never a schema `versionchange`, which another open connection
 * could block indefinitely. This departs from the plan's "one object store per
 * table", which ADR-0015 permits as the alternative to handling `versionchange`.
 *
 * Rows have out-of-line array keys `[table, keyBytes, valueOrEmpty]`. On a
 * dupsort table the third part is the duplicate value, so each duplicate is its
 * own row. On a plain table it is empty and the record holds the value. Empty
 * dupsort values are rejected upstream, so an empty third part always means
 * "plain". Binary parts are `ArrayBuffer`s. IndexedDB's key order is never
 * relied on, because `WebDBer` sorts what it loads.
 *
 * The family is part of the database name because a composition's stores share
 * one `name` and `base`; without it a Baser and Keeper would share a database,
 * a version marker and a `clear`. A temp store is named apart from a durable one
 * so clearing it cannot delete durable data of the same name.
 *
 * `write` is one `readwrite` transaction with strict durability and settles on
 * the transaction's `complete` event, never on a request's `success`.
 *
 * Another tab's upgrade or delete fires `versionchange` here. The connection
 * closes at once so that tab is never blocked, and this adapter is then lost:
 * its next `load` or `write` rejects, which latches the queue, because writing
 * on after another context deleted the database would break prefix durability.
 * Recovery is a new open, whose `meta` reconnects. Single-writer exclusion is
 * the composition's job, not this adapter's.
 *
 * A blocked `clear` rejects. Our own connection is already closed, and ours
 * close on `versionchange`, so only a foreign connection can block. Reads settle on
 * their transaction's `complete`, like writes: WebKit reports `blocked` for a
 * connection whose close is still waiting on a finishing read transaction. The browser
 * keeps the delete request pending and performs it once that connection closes,
 * which is what `clear` asked for.
 */

import { DatabaseOperationError } from "../../core/errors.ts";
import type { StoreIdentity, TableEntry } from "./dber.ts";
import type { StoreFamily } from "./store-owner.ts";
import type { PersistedMeta, Persistence, PersistenceBatch } from "./webdber.ts";

const ROWS = "rows";
const META = "meta";
const VERSION_KEY = "version";
const TABLE_PREFIX = "table:";

const EMPTY = new ArrayBuffer(0);
/** An exact-length `ArrayBuffer` copy, since `.buffer` of a view may span more bytes. */
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

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
  readonly #keyRange: typeof IDBKeyRange;
  /** Dupsort flag per table, learned from `meta` and from each batch that creates one. */
  readonly #dupsort = new Map<string, boolean>();
  #db: IDBDatabase | null = null;
  #lost: Error | null = null;

  /**
   * @param family Store family; with `identity` it chooses the database.
   * @param identity Store identity; `name`, `base` and `temp` choose the database.
   * @param factory Defaults to the global `indexedDB`.
   * @param keyRange Defaults to the global `IDBKeyRange`; inject it with `factory` outside a browser.
   */
  constructor(
    family: StoreFamily,
    identity: StoreIdentity,
    factory: IDBFactory = globalThis.indexedDB,
    keyRange: typeof IDBKeyRange = globalThis.IDBKeyRange,
  ) {
    const place = [identity.base ?? "", identity.name ?? "", family.tail, identity.temp ? "temp" : "durable"];
    this.#databaseName = `keri-ts:${JSON.stringify(place)}`;
    this.#factory = factory;
    this.#keyRange = keyRange;
  }

  #connect(): Promise<IDBDatabase> {
    if (this.#db) return Promise.resolve(this.#db);
    if (!this.#factory) throw new DatabaseOperationError("IndexedDB is not available in this environment");
    return new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(ROWS);
        db.createObjectStore(META);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (this.#db === db) {
            this.#db = null;
            this.#lost = new DatabaseOperationError("IndexedDB connection closed by another context's versionchange");
          }
        };
        this.#lost = null;
        this.#db = db;
        resolve(db);
      };
    });
  }

  /** The live connection, or the reason there is none. */
  #connection(): IDBDatabase {
    if (this.#db) return this.#db;
    throw this.#lost ?? new DatabaseOperationError("IndexedDB persistence is not connected");
  }

  async meta(): Promise<PersistedMeta> {
    const db = await this.#connect();
    const transaction = db.transaction(META, "readonly");
    const store = transaction.objectStore(META);
    const range = this.#keyRange.bound(TABLE_PREFIX, `${TABLE_PREFIX}￿`);
    // Settle on `complete`: a connection with a transaction still finishing is not yet closed.
    const [, version, names, flags] = await Promise.all([
      completion(transaction),
      result(store.get(VERSION_KEY)),
      result(store.getAllKeys(range)),
      result(store.getAll(range)),
    ]);
    this.#dupsort.clear();
    const tables = names.map((key, index) => {
      const name = String(key).slice(TABLE_PREFIX.length);
      const dupsort = flags[index] === true;
      this.#dupsort.set(name, dupsort);
      return { name, dupsort };
    });
    return { version: typeof version === "string" ? version : null, tables };
  }

  async load(table: string): Promise<TableEntry[]> {
    const transaction = this.#connection().transaction(ROWS, "readonly");
    const store = transaction.objectStore(ROWS);
    // Binary sorts below array, so `[table, []]` bounds every `[table, key, value]`.
    const range = this.#keyRange.bound([table], [table, []]);
    const [, keys, records] = await Promise.all([
      completion(transaction),
      result(store.getAllKeys(range)),
      result(store.getAll(range)),
    ]);
    return keys.map((row, index) => {
      const [, key, duplicate] = row as [string, ArrayBuffer, ArrayBuffer];
      const value = duplicate.byteLength > 0 ? duplicate : records[index] as ArrayBuffer;
      return { key: new Uint8Array(key), value: new Uint8Array(value) };
    });
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
        meta.put(dupsort, `${TABLE_PREFIX}${name}`);
      }
      if (batch.version !== undefined) meta.put(batch.version, VERSION_KEY);
      for (const { table, key, value } of batch.puts) {
        const dupsort = this.#dupsort.get(table);
        if (dupsort === undefined) throw new DatabaseOperationError(`Unknown table ${table}`);
        rows.put(dupsort ? null : buffer(value), [table, buffer(key), dupsort ? buffer(value) : EMPTY]);
      }
      for (const { table, key, value } of batch.deletes) {
        rows.delete([table, buffer(key), value ? buffer(value) : EMPTY]);
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
