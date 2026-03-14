/**
 * Core LMDB manager used by higher-level DB abstractions.
 */

import { action, type Operation } from "npm:effection@^3.6.0";
import { Database, Key, open, RootDatabase } from "npm:lmdb@3.4.4";
import { startsWith } from "../../core/bytes.ts";
import {
  DatabaseKeyError,
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";
import { onKey, splitOnKey, suffix, unsuffix } from "./keys.ts";
import {
  PathManager,
  PathManagerDefaults,
  PathManagerOptions,
} from "./path-manager.ts";
import { b, bytesEqual, bytesHex, t, toBytes } from "../../../../cesr/mod.ts";

// type aliases for the binary keys and values of LMDB
export type BinKey = Uint8Array;
export type BinVal = Uint8Array;

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
 * LMDBer can be configured with read only, dupsort for storing values in keyspace,
 * and a logger.
 */
export interface LMDBerOptions extends PathManagerOptions {
  readonly?: boolean;
  dupsort?: boolean;
  logger?: Logger;
}

export interface LMDBerDefaults extends PathManagerDefaults {
  maxNamedDBs: number;
  mapSize: number;
}

export const LMDBER_DEFAULTS: LMDBerDefaults = {
  headDirPath: "/usr/local/var",
  tailDirPath: "keri/db",
  cleanTailDirPath: "keri/clean/db",
  altHeadDirPath: "~",
  altTailDirPath: ".tufa/db",
  altCleanTailDirPath: ".tufa/clean/db",
  tempHeadDir: "/tmp",
  tempPrefix: "keri_lmdb_",
  tempSuffix: "_test",
  perm: 0o1700,
  mode: "r+",
  fext: "text",
  maxNamedDBs: 96,
  mapSize: 4 * 1024 * 1024 * 1024, // 4GB default
};

const DEFAULT_DB_VERSION = "1.0.0";

/** LMDB env lifecycle + core CRUD/branch operations. */
export class LMDBer {
  private pathManager: PathManager;
  public env: RootDatabase<any, Key> | null;
  public readonly: boolean;
  private defaults: LMDBerDefaults;
  private readonly logger: Logger;

  // Class constants
  static readonly HeadDirPath = "/usr/local/var";
  static readonly TailDirPath = "keri/db";
  static readonly CleanTailDirPath = "keri/clean/db";
  static readonly AltHeadDirPath = "~";
  static readonly AltTailDirPath = ".tufa/db";
  static readonly AltCleanTailDirPath = ".tufa/clean/db";
  static readonly TempHeadDir = "/tmp";
  static readonly TempPrefix = "keri_lmdb_";
  static readonly TempSuffix = "_test";
  static readonly Perm = 0o1700;
  static readonly MaxNamedDBs = 96;

  constructor(options: LMDBerOptions = {}, defaults?: Partial<LMDBerDefaults>) {
    this.defaults = { ...LMDBER_DEFAULTS, ...defaults };
    this.logger = options.logger ?? consoleLogger;

    // Create PathManager with composition
    const pathDefaults: Partial<PathManagerDefaults> = {
      headDirPath: this.defaults.headDirPath,
      tailDirPath: this.defaults.tailDirPath,
      cleanTailDirPath: this.defaults.cleanTailDirPath,
      altHeadDirPath: this.defaults.altHeadDirPath,
      altTailDirPath: this.defaults.altTailDirPath,
      altCleanTailDirPath: this.defaults.altCleanTailDirPath,
      tempHeadDir: this.defaults.tempHeadDir,
      tempPrefix: this.defaults.tempPrefix,
      tempSuffix: this.defaults.tempSuffix,
      perm: this.defaults.perm,
    };

    this.pathManager = new PathManager(options, pathDefaults);
    this.env = null;
    this.readonly = options.readonly || false;
  }

  get name(): string {
    return this.pathManager.name;
  }

  get base(): string {
    return this.pathManager.base;
  }

  get opened(): boolean {
    return this.pathManager.opened && this.env !== null;
  }

  get temp(): boolean {
    return this.pathManager.temp;
  }

  get path(): string | null {
    return this.pathManager.path;
  }

  private requireEnv(): RootDatabase<any, Key> {
    if (!this.env) {
      throw new DatabaseNotOpenError("LMDB environment is not open");
    }
    return this.env;
  }

  private formatDbKeyError(key: Uint8Array, error: unknown): DatabaseKeyError {
    const message = error instanceof Error ? error.message : String(error);
    return new DatabaseKeyError(
      `Key is empty, too big, or wrong size: ${message}`,
      {
        key: Array.from(key),
      },
    );
  }

  /** Bridge async LMDB close into an Effection operation. */
  private *closeEnv(env: RootDatabase<any, Key>): Operation<void> {
    yield* action<void>((resolve, reject) => {
      env.close().then(() => resolve(undefined)).catch(reject);
      return () => {};
    });
  }

  /**
   * Allow LMDB-js internal read-reset timers to flush before test/resource
   * teardown completes. LMDB uses setTimeout(0/1) internally around read txn
   * renewal/reset and deferred close paths.
   */
  private *quiesceEnvTimers(): Operation<void> {
    yield* action<void>((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 1);
      return () => clearTimeout(timeout);
    });
  }

  /**
   * Reopen the LMDB environment with updated options.
   * Closes any existing env first, then opens at the resolved path.
   */
  *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    const readonly = options.readonly ?? this.readonly;
    this.readonly = readonly;

    // Close existing database if open (prevents double-free when reopening)
    if (this.env) {
      try {
        yield* this.closeEnv(this.env);
      } catch (error) {
        // Ignore close errors (database might already be closed)
        this.logger.warn(
          `Warning: Error closing existing LMDB environment: ${error}`,
        );
      }
      this.env = null;
    }

    // Reopen path manager (now an Effection operation)
    yield* this.pathManager.reopen(options);
    if (!this.pathManager.path) {
      return false;
    }
    let dbPath = this.pathManager.path;

    // Get map size from environment variable or use default
    const mapSizeEnv = Deno.env.get("KERI_LMDB_MAP_SIZE");
    const mapSize = mapSizeEnv
      ? parseInt(mapSizeEnv, 10)
      : this.defaults.mapSize;

    // Check if database files exist before opening
    const dbExists = yield* this.checkDatabaseExists();

    // If readonly and database doesn't exist, we need to handle that gracefully
    // For readonly mode, database files must exist
    if (readonly && !dbExists) {
      this.logger.error(
        `Cannot open readonly database: database files do not exist at ${dbPath}`,
      );
      this.env = null;
      return false;
    }

    // For readonly opens of existing databases, use a large mapSize that's safe
    // LMDB will use the actual map size from the database file, but the Node.js
    // lmdb package requires mapSize to be >= the database's actual map size
    // Use 4GB (KERIpy default) or larger to ensure compatibility
    const effectiveMapSize = readonly && dbExists
      ? Math.max(mapSize, 4 * 1024 * 1024 * 1024) // At least 4GB for existing databases
      : mapSize;

    const dbConfig = {
      path: dbPath, // Use directory path (Node.js lmdb should handle this)
      maxDbs: this.defaults.maxNamedDBs,
      mapSize: effectiveMapSize,
      readOnly: readonly,
      compression: false, // Disable compression for compatibility
      encoding: "binary" as const, // to mimic KERIpy behavior
      keyEncoding: "binary" as const, // to mimic KERIpy behavior
    };
    this.logger.info(
      `Opening LMDB at: ${dbPath} (readonly: ${readonly}, mapSize: ${effectiveMapSize})`,
    );

    // Open LMDB environment
    // LMDB's open() will create data.mdb and lock.mdb if they don't exist
    try {
      // do sync because wrapping synchronous native operations in action() can cause
      // memory management issues with native bindings (double-free errors)
      this.env = open(dbConfig);
      this.logger.info(`LMDB environment opened successfully`);

      // KERIpy parity: stamp version metadata on newly-created DBs and temp DBs.
      if (this.opened && !readonly && (!dbExists || this.temp)) {
        this.setVer(DEFAULT_DB_VERSION);
      }

      return this.opened;
    } catch (error) {
      this.env = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to open LMDB environment: ${message}`,
        {
          path: dbPath,
          readonly,
          mapSize: effectiveMapSize,
        },
      );
    }
  }

  /** True if the current env path already has a `data.mdb` file. */
  private *checkDatabaseExists(): Operation<boolean> {
    if (!this.pathManager.path) {
      return false;
    }

    // Check if database files exist (now an Effection operation)
    const dataMdbPath = `${this.path}/data.mdb`;
    const pathStat = yield* this.pathManager.statFileOp(dataMdbPath);
    return pathStat.isFile ?? false;
  }

  /** Close the env and path manager. Optionally clear backing files. */
  *close(clear = false): Operation<boolean> {
    if (this.env) {
      try {
        yield* this.closeEnv(this.env);
        yield* this.quiesceEnvTimers(); // lmdb-js uses internal teardown timers to manage post-close; this lets them finish
      } catch (error) {
        // Intentional recovery: close errors are non-fatal during shutdown paths.
        this.logger.warn(`Error closing LMDB: ${error}`);
      }
      this.env = null;
    }

    // Close path manager (now an Effection operation)
    yield* this.pathManager.close(clear);

    return true;
  }

  /** Read the `__version__` marker from the root DB. */
  getVer(): string | null {
    const env = this.requireEnv();

    try {
      const versionBytes: Uint8Array = env.get(b("__version__"));
      const version = t(versionBytes);
      return version || null;
    } catch {
      // Intentional recovery: absent/malformed version metadata is treated as unknown.
      return null;
    }
  }

  /** Write the `__version__` marker in the root DB. */
  setVer(val: string): void {
    const env = this.requireEnv();

    try {
      env.transactionSync(() => {
        env.putSync(b("__version__"), b(val));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to set database version: ${message}`,
        {
          version: val,
        },
      );
    }
  }

  /** Open a named sub-database with binary key/value encoding. */
  openDB(name: string, dupsort = false): Database<BinVal, BinKey> {
    const env = this.requireEnv();
    return env.openDB(name, {
      keyEncoding: "binary",
      encoding: "binary", // Use binary encoding for values (raw bytes) to match KERIpy
      dupSort: dupsort,
    });
  }

  /** Insert key/value only if key is absent. Returns `false` on existing key. */
  putVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    const env = this.requireEnv();

    try {
      const result = env.transactionSync(() => {
        const existing = db.get(key);
        if (existing !== null && existing !== undefined) {
          return false;
        }
        db.put(key, val);
        return true;
      });
      return result;
    } catch (error) {
      throw this.formatDbKeyError(key, error);
    }
  }

  /** Upsert key/value. Overwrites existing value. */
  setVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    const env = this.requireEnv();

    try {
      env.transactionSync(() => {
        db.put(key, val);
      });
      return true;
    } catch (error) {
      throw this.formatDbKeyError(key, error);
    }
  }

  /** Fetch value by key. Returns `null` when missing. */
  getVal(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array | null {
    this.requireEnv();
    try {
      const val = db.get(key);
      if (val === null || val === undefined) {
        return null;
      } else {
        return val instanceof Uint8Array ? val : new Uint8Array(val);
      }
    } catch (error) {
      throw this.formatDbKeyError(key, error);
    }
  }

  /** Delete one key, or one duplicate value when `val` is provided. */
  delVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val?: Uint8Array,
  ): boolean {
    const env = this.requireEnv();

    try {
      const result = env.transactionSync(() => {
        if (val !== undefined) {
          return db.removeSync(key, val);
        }

        const exists = db.get(key) !== null && db.get(key) !== undefined;
        if (exists) {
          db.removeSync(key);
        }
        return exists;
      });
      return result;
    } catch (error) {
      throw this.formatDbKeyError(key, error);
    }
  }

  /** Count all entries in the sub-database. */
  cnt(db: Database<BinVal, BinKey>): number {
    this.requireEnv();
    try {
      let count = 0;
      for (const _ of db.getRange({})) {
        count++;
      }
      return count;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to count database entries: ${message}`,
      );
    }
  }

  /**
   * Count values for keys that share the given byte-prefix (`top`).
   * Empty `top` counts the whole database.
   * Example: `top=b("alpha.")` counts `alpha.1`, `alpha.2`, ...
   *
   * Review note: keep/remove decision is deferred until post
   * `kli-init/incept/rotate` implementation usage review.
   */
  cntTop(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
  ): number {
    this.requireEnv();
    try {
      let count = 0;
      const startKey = top.length > 0 ? top : undefined;
      for (const entry of db.getRange({ start: startKey })) {
        const keyBytes = entry.key as Uint8Array;
        if (top.length > 0 && !startsWith(keyBytes, top)) {
          break;
        }
        count++;
      }
      return count;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to count database branch: ${message}`,
        {
          top: Array.from(top),
        },
      );
    }
  }

  /**
   * KERIpy parity-style alias for full-database count.
   *
   * Review note: keep/remove decision is deferred until post
   * `kli-init/incept/rotate` implementation usage review.
   */
  cntAll(db: Database<BinVal, BinKey>): number {
    return this.cnt(db);
  }

  /**
   * Delete entries whose keys share the given byte-prefix (`top`).
   * Empty `top` deletes the whole database.
   */
  delTop(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
  ): boolean {
    const env = this.requireEnv();
    try {
      const keys: Uint8Array[] = [];
      const startKey = top.length > 0 ? top : undefined;
      for (const entry of db.getRange({ start: startKey })) {
        const keyBytes = entry.key as Uint8Array;
        if (top.length > 0 && !startsWith(keyBytes, top)) {
          break;
        }
        keys.push(new Uint8Array(keyBytes));
      }

      if (keys.length === 0) {
        return false;
      }

      env.transactionSync(() => {
        for (const key of keys) {
          db.remove(key);
        }
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to delete database branch: ${message}`,
        {
          top: Array.from(top),
        },
      );
    }
  }

  /**
   * Iterate `(key, value)` entries whose keys share the prefix `top`, returning
   * the suffixed key per entry.
   * Empty `top` iterates the whole database.
   */
  *getTopItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    this.requireEnv();
    try {
      // Use getRange with start position at top key
      // With binary encoding, keys and values are always Uint8Array
      const startKey = top.length > 0 ? top : undefined;

      for (const entry of db.getRange({ start: startKey })) {
        const keyBytes = entry.key as Uint8Array;
        const valBytes = entry.value as Uint8Array;

        // Check if key starts with top prefix
        // If top is empty, match all keys (empty prefix matches everything)
        if (top.length > 0 && !startsWith(keyBytes, top)) {
          break; // Done - no more keys in this branch
        }

        yield [keyBytes, valBytes];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to iterate database branch: ${message}`,
        {
          top: Array.from(top),
        },
      );
    }
  }

  /** Insert value at `onKey(key, on)` only when absent. */
  putOnVal(
    db: Database<BinVal, BinKey>,
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

  /** Upsert value at `onKey(key, on)`. */
  pinOnVal(
    db: Database<BinVal, BinKey>,
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
   * Append value at the next ordinal for `key`.
   * Returns appended ordinal.
   */
  appendOnVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array | null,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.requireEnv();
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
    for (const entry of db.getRange({ start, reverse: true, limit: 1 })) {
      const tailOnKey = toBytes(entry.key);
      const [ckey, cn] = splitOnKey(tailOnKey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      if (bytesEqual(tailOnKey, start)) {
        throw new Error(
          `Number part cn=${cn} for key part ckey=${
            Array.from(ckey)
          } exceeds maximum size.`,
        );
      }
      nextOn = cn + 1;
      break;
    }

    const added = this.putVal(db, onKey(key, nextOn, sep), val);
    if (!added) {
      throw new Error(`Failed appending value at key=${Array.from(key)}.`);
    }
    return nextOn;
  }

  /** Fetch `(key, on, val)` at `onKey(key, on)` or `null`. */
  getOnItem(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): [Uint8Array, number, Uint8Array] | null {
    const val = this.getOnVal(db, key, on, sep);
    return val ? [key, on, val] : null;
  }

  /** Fetch value at `onKey(key, on)` or `null`. */
  getOnVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Uint8Array | null {
    if (!key.length) {
      return null;
    }
    return this.getVal(db, onKey(key, on, sep));
  }

  /** Remove value at `onKey(key, on)`. */
  remOn(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return false;
    }
    return this.delVal(db, onKey(key, on, sep));
  }

  /** Remove all ordinals at `key` from `on` onward. Empty key removes whole DB. */
  remOnAll(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return this.delTop(db, new Uint8Array(0));
    }

    const env = this.requireEnv();
    const start = onKey(key, on, sep);
    const keys: Uint8Array[] = [];
    for (const entry of db.getRange({ start })) {
      const ckey = toBytes(entry.key);
      const [top] = splitOnKey(ckey, sep);
      if (!bytesEqual(top, key)) {
        break;
      }
      keys.push(new Uint8Array(ckey));
    }

    if (!keys.length) {
      return false;
    }

    env.transactionSync(() => {
      for (const k of keys) {
        db.removeSync(k);
      }
    });
    return true;
  }

  /**
   * Count ordinal-keyed values for `key` from ordinal `on` onward.
   * TypeScript-local name for KERIpy `cntOnVals`.
   */
  cntOnAll(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.requireEnv();
    const start = key.length ? onKey(key, on, sep) : new Uint8Array(0);
    let count = 0;
    for (const entry of db.getRange({ start })) {
      const ckey = toBytes(entry.key);
      const [top] = splitOnKey(ckey, sep);
      if (key.length && !bytesEqual(top, key)) {
        break;
      }
      count += 1;
    }
    return count;
  }

  /** Iterate `(key, on, val)` for all ordinal entries in branch `top`. */
  *getOnTopItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [onkey, val] of this.getTopItemIter(db, top)) {
      const [key, on] = splitOnKey(onkey, sep);
      yield [key, on, val];
    }
  }

  /**
   * Iterate `(key, on, val)` for key ordinals `>= on`. Empty key iterates all.
   * TypeScript-local name for KERIpy `getOnItemIter`.
   */
  *getOnAllItemIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    this.requireEnv();
    const start = key.length ? onKey(key, on, sep) : new Uint8Array(0);
    for (const entry of db.getRange({ start })) {
      const ckey = toBytes(entry.key);
      const cval = toBytes(entry.value);
      const [top, cn] = splitOnKey(ckey, sep);
      if (key.length && !bytesEqual(top, key)) {
        break;
      }
      yield [top, cn, cval];
    }
  }

  /** Add values to insertion-ordered set at `key` (dups emulated in keyspace). */
  putIoSetVals(
    db: Database<BinVal, BinKey>,
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
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
      const cval = toBytes(entry.value);
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

    const env = this.requireEnv();
    env.transactionSync(() => {
      for (const [index, val] of insert.entries()) {
        db.putSync(suffix(key, ion + index, sep), val);
      }
    });
    return true;
  }

  /**
   * Replace insertion-ordered set at `key`.
   * Mirrors setIoSetVals in KERIpy.
   */
  pinIoSetVals(
    db: Database<BinVal, BinKey>,
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
    const env = this.requireEnv();
    env.transactionSync(() => {
      for (const [index, val] of uniqueVals.entries()) {
        db.putSync(suffix(key, index, sep), val);
      }
    });
    return true;
  }

  /** Add one value to insertion-ordered set at `key` if absent. */
  addIoSetVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array | null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    this.requireEnv();
    if (!key.length || val === null) {
      return false;
    }

    let ion = 0;
    const valHex = bytesHex(val);
    const start = suffix(key, 0, sep);
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
      const cval = toBytes(entry.value);
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
   * Iterate set items `(key, val)` at `key` from insertion ordinal `ion`.
   * Mirrors getIoSetValsIter.
   * Used in place of getIoSetVals from KERIpy for cntIoSet
   */
  *getIoSetItemIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    ion = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, Uint8Array]> {
    this.requireEnv();
    if (!key.length) {
      return;
    }
    const start = suffix(key, ion, sep);
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
      const cval = toBytes(entry.value);
      const [ckey] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      yield [ckey, cval];
    }
  }

  /** Return last set item `(key, val)` at `key`, or `null`. */
  getIoSetLastItem(
    db: Database<BinVal, BinKey>,
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
   * Mirrors delIoSetVals in KERIpy.
   */
  remIoSet(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return false;
    }

    const env = this.requireEnv();
    const keys: Uint8Array[] = [];
    const start = suffix(key, 0, sep);
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
      const [ckey] = unsuffix(iokey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      keys.push(new Uint8Array(iokey));
    }

    if (!keys.length) {
      return false;
    }

    env.transactionSync(() => {
      for (const iokey of keys) {
        db.removeSync(iokey);
      }
    });
    return true;
  }

  /**
   * Remove one set member at `key`, or all if `val` is `null`.
   * Mirrors delIoSetVal in KERIpy.
   */
  remIoSetVal(
    db: Database<BinVal, BinKey>,
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

    const env = this.requireEnv();
    const valHex = bytesHex(val);
    let removeKey: Uint8Array | null = null;
    const start = suffix(key, 0, sep);
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
      const cval = toBytes(entry.value);
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

    env.transactionSync(() => {
      db.removeSync(removeKey!);
    });
    return true;
  }

  /** Count set members at `key` from insertion ordinal `ion`. */
  cntIoSet(
    db: Database<BinVal, BinKey>,
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
   * Iterate branch `(key, val)` where db keys are io-suffixed, returning the
   * unsuffixed key per item.
   */
  *getTopIoSetItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, Uint8Array]> {
    for (const [iokey, val] of this.getTopItemIter(db, top)) {
      const [key] = unsuffix(iokey, sep);
      yield [key, val];
    }
  }

  /**
   * Iterate last set item `(key, val)` for each effective key `>= key`.
   * Empty key iterates whole DB.
   */
  *getIoSetLastItemIterAll(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, Uint8Array]> {
    this.requireEnv();
    const start = key.length ? suffix(key, 0, sep) : undefined;
    let last: [Uint8Array, Uint8Array] | null = null;
    let lkey: Uint8Array | null = null;
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
      const cval = toBytes(entry.value);
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

  /** Iterate only last values for each effective io-set key `>= key`. */
  *getIoSetLastIterAll(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, val] of this.getIoSetLastItemIterAll(db, key, sep)) {
      yield val;
    }
  }

  /** Add set members at ordinal effective key `onKey(key, on)`. */
  putOnIoSetVals(
    db: Database<BinVal, BinKey>,
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

  /** Replace set members at ordinal effective key `onKey(key, on)`. */
  pinOnIoSetVals(
    db: Database<BinVal, BinKey>,
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
   * Append a new ordinal set for `key`.
   * Returns appended ordinal.
   */
  appendOnIoSetVals(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    vals: Iterable<Uint8Array> | null,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.requireEnv();
    if (!key.length || vals === null) {
      throw new Error(
        `Bad append parameter: key=${Array.from(key)} vals=${vals}`,
      );
    }

    let on = 0;
    const start = suffix(onKey(key, 0, sep), 0, sep);
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
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

  /** Add one set member at ordinal effective key `onKey(key, on)`. */
  addOnIoSetVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.addIoSetVal(db, onKey(key, on, sep), val, sep);
  }

  /** Iterate `(key, on, val)` set members at ordinal effective key. */
  *getOnIoSetItemIter(
    db: Database<BinVal, BinKey>,
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

  /** Fetch last set member `(key, on, val)` at ordinal effective key or `null`. */
  getOnIoSetLastItem(
    db: Database<BinVal, BinKey>,
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

  /** Remove set member at ordinal effective key, or all members when `val` is `null`. */
  remOnIoSetVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.remIoSetVal(db, onKey(key, on, sep), val, sep);
  }

  /** Remove all ordinal sets for `key` from `on` onward. Empty key removes whole DB. */
  remOnAllIoSet(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    if (!key.length) {
      return this.delTop(db, new Uint8Array(0));
    }

    const env = this.requireEnv();
    const start = suffix(onKey(key, on, sep), 0, sep);
    const keys: Uint8Array[] = [];
    for (const entry of db.getRange({ start })) {
      const iokey = toBytes(entry.key);
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

    env.transactionSync(() => {
      for (const iokey of keys) {
        db.removeSync(iokey);
      }
    });
    return true;
  }

  /** Count set members at ordinal effective key from insertion ordinal `ion`. */
  cntOnIoSet(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    ion = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.cntIoSet(db, onKey(key, on, sep), ion, sep);
  }

  /** Count all set members for ordinals of `key` from `on` onward. */
  cntOnAllIoSet(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    this.requireEnv();
    if (!key.length) {
      return this.cntAll(db);
    }
    let count = 0;
    const start = suffix(onKey(key, on, sep), 0, sep);
    for (const entry of db.getRange({ start })) {
      const [onkey] = unsuffix(toBytes(entry.key), sep);
      const [ckey] = splitOnKey(onkey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      count += 1;
    }
    return count;
  }

  /**
   * Iterate `(key, on, val)` io-set members in branch `top`.
   * Assumes the key for an insertion-ordered set is an ordinal prefixed key.
   */
  *getOnTopIoSetItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [onkey, val] of this.getTopIoSetItemIter(db, top, sep)) {
      const [key, on] = splitOnKey(onkey, sep);
      yield [key, on, val];
    }
  }

  /**
   * Iterate `(key, on, val)` io-set members for ordinals `>= on`. Empty key iterates all.
   * Assumes both the ordinal number segment and insertion order suffix are present in the key.
   */
  *getOnAllIoSetItemIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    this.requireEnv();
    if (!key.length) {
      yield* this.getOnTopIoSetItemIter(db, new Uint8Array(0), sep);
      return;
    }
    const start = suffix(onKey(key, on, sep), 0, sep);
    for (const entry of db.getRange({ start })) {
      const [onkey] = unsuffix(toBytes(entry.key), sep);
      const cval = toBytes(entry.value);
      const [ckey, con] = splitOnKey(onkey, sep);
      if (!bytesEqual(ckey, key)) {
        break;
      }
      yield [ckey, con, cval];
    }
  }

  /** Iterate last set member `(key, on, val)` for each ordinal at `key` from `on`. */
  *getOnAllIoSetLastItemIter(
    db: Database<BinVal, BinKey>,
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

  /** Iterate backward over io-set members `(key, on, val)`. */
  *getOnAllIoSetItemBackIter(
    db: Database<BinVal, BinKey>,
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

  /** Iterate backward over last io-set member per ordinal `(key, on, val)`. */
  *getOnAllIoSetLastItemBackIter(
    db: Database<BinVal, BinKey>,
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

  /** Add duplicate values at `key` in dupsort DB. Returns false if any pre-existed. */
  putVals(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    vals: Iterable<Uint8Array>,
  ): boolean {
    let result = true;
    const existing = new Set<string>(
      this.getVals(db, key).map((val) => bytesHex(val)),
    );
    const env = this.requireEnv();
    env.transactionSync(() => {
      for (const val of vals) {
        const vh = bytesHex(val);
        if (existing.has(vh)) {
          result = false;
          continue;
        }
        db.putSync(key, val);
        existing.add(vh);
      }
    });
    return result;
  }

  /** Add one duplicate value at `key` in lexicographic value order. */
  addVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array | null,
  ): boolean {
    const single = val === null ? [new Uint8Array(0)] : [val];
    return this.putVals(db, key, single);
  }

  /**
   * Get duplicate values at `key` (empty list when missing) sorted lexicographically.
   */
  getVals(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array[] {
    this.requireEnv();
    return [...db.getValues(key)].map((val) => toBytes(val));
  }

  /** Get last duplicate value at `key`, or `null` sorted lexicographically. */
  getValLast(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array | null {
    const vals = this.getVals(db, key);
    return vals.length ? vals[vals.length - 1] : null;
  }

  /** Iterate duplicate values at `key`. */
  *getValsIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
  ): Generator<Uint8Array> {
    this.requireEnv();
    for (const val of db.getValues(key)) {
      yield toBytes(val);
    }
  }

  /** Count duplicate values at `key`. */
  cntVals(db: Database<BinVal, BinKey>, key: Uint8Array): number {
    this.requireEnv();
    return db.getValuesCount(key);
  }

  /** Delete all duplicate values at `key`. */
  delVals(db: Database<BinVal, BinKey>, key: Uint8Array): boolean {
    this.requireEnv();
    return db.removeSync(key);
  }

  /** Add insertion-ordered duplicates at `key` using a 33-byte proem. */
  putIoDupVals(
    db: Database<BinVal, BinKey>,
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

    const env = this.requireEnv();
    env.transactionSync(() => {
      for (const val of vals) {
        const vh = bytesHex(val);
        if (existing.has(vh)) {
          continue;
        }
        db.putSync(key, withIoDupProem(idx, val));
        idx += 1;
        existing.add(vh);
        result = true;
      }
    });
    return result;
  }

  /** Add one insertion-ordered duplicate value at `key`. */
  addIoDupVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array | null,
  ): boolean {
    const single = val === null ? [new Uint8Array(0)] : [val];
    return this.putIoDupVals(db, key, single);
  }

  /** Get insertion-ordered duplicate values at `key` with proem stripped. */
  getIoDupVals(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array[] {
    return this.getVals(db, key).map((val) => stripIoDupProem(val));
  }

  /** Iterate insertion-ordered duplicate values at `key` with proem stripped. */
  *getIoDupValsIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
  ): Generator<Uint8Array> {
    for (const val of this.getValsIter(db, key)) {
      yield stripIoDupProem(val);
    }
  }

  /** Get last insertion-ordered duplicate value at `key`, proem stripped. */
  getIoDupValLast(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
  ): Uint8Array | null {
    const last = this.getValLast(db, key);
    return last ? stripIoDupProem(last) : null;
  }

  /** Delete all insertion-ordered duplicate values at `key`. */
  delIoDupVals(db: Database<BinVal, BinKey>, key: Uint8Array): boolean {
    return this.delVals(db, key);
  }

  /** Delete one insertion-ordered duplicate value at `key`, matching stripped value. */
  delIoDupVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    this.requireEnv();
    for (const proVal of this.getVals(db, key)) {
      if (bytesEqual(stripIoDupProem(proVal), val)) {
        return db.removeSync(key, proVal);
      }
    }
    return false;
  }

  /** Count insertion-ordered duplicates at `key`. */
  cntIoDups(db: Database<BinVal, BinKey>, key: Uint8Array): number {
    return this.cntVals(db, key);
  }

  /** Iterate `(key, val)` over branch `top` with IoDup proem stripped from values. */
  *getTopIoDupItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    for (const [key, val] of this.getTopItemIter(db, top)) {
      yield [key, stripIoDupProem(val)];
    }
  }

  /** Add insertion-ordered duplicates at ordinal effective key. */
  putOnIoDupVals(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    vals: Iterable<Uint8Array>,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.putIoDupVals(db, onKey(key, on, sep), vals);
  }

  /** Add one insertion-ordered duplicate at ordinal effective key. */
  addOnIoDupVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    val: Uint8Array | null = null,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.addIoDupVal(db, onKey(key, on, sep), val);
  }

  /** Append one insertion-ordered duplicate value at next ordinal for key. */
  appendOnIoDupVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.appendOnVal(db, key, withIoDupProem(0, val), sep);
  }

  /** Get insertion-ordered duplicates at ordinal effective key (stripped). */
  getOnIoDupVals(
    db: Database<BinVal, BinKey>,
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
   * Iterate insertion-ordered duplicates at one exact ordinal effective key (stripped).
   * No direct KERIpy equivalent: KERIpy `getOnIoDupValIter` scans all ordinals
   * from `on` onward, which maps to `getOnIoDupIterAll` here.
   */
  *getOnIoDupValsIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    if (!key.length) {
      return;
    }
    yield* this.getIoDupValsIter(db, onKey(key, on, sep));
  }

  /** Get last insertion-ordered duplicate at ordinal effective key (stripped). */
  getOnIoDupLast(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Uint8Array | null {
    return this.getIoDupValLast(db, onKey(key, on, sep));
  }

  /** Iterate last insertion-ordered duplicate value per ordinal. */
  *getOnIoDupLastValIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, __, val] of this.getOnIoDupLastItemIter(db, key, on, sep)) {
      yield val;
    }
  }

  /** Iterate `(key, on, val)` where `val` is last insertion-ordered duplicate per ordinal. */
  *getOnIoDupLastItemIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    this.requireEnv();
    const start = key.length ? onKey(key, on, sep) : new Uint8Array(0);
    let lonkey: Uint8Array | null = null;
    let lkey: Uint8Array | null = null;
    let lon = 0;
    let last: Uint8Array | null = null;

    for (const entry of db.getRange({ start })) {
      const onkeyBytes = toBytes(entry.key);
      const cval = toBytes(entry.value);
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
   * Delete all insertion-ordered duplicates at ordinal effective key.
   * Mirrors `delOnIoDupVals` in KERIpy.
   */
  delOnIoDups(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.delIoDupVals(db, onKey(key, on, sep));
  }

  /** Delete one insertion-ordered duplicate at ordinal effective key. */
  delOnIoDupVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    val: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.delIoDupVal(db, onKey(key, on, sep), val);
  }

  /** Count insertion-ordered duplicates at ordinal effective key. */
  cntOnIoDups(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.cntIoDups(db, onKey(key, on, sep));
  }

  /** Iterate backwards over insertion-ordered duplicate values. */
  *getOnIoDupValBackIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, __, val] of this.getOnIoDupItemBackIter(db, key, on, sep)) {
      yield val;
    }
  }

  /** Iterate backwards over `(key, on, val)` insertion-ordered duplicates. */
  *getOnIoDupItemBackIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    const items = key.length
      ? [...this.getOnIoDupItemIterAll(db, key, 0, sep)].filter((item) =>
        item[1] <= on
      )
      : [...this.getOnIoDupItemIterAll(db, new Uint8Array(0), 0, sep)];

    for (let i = items.length - 1; i >= 0; i--) {
      yield items[i];
    }
  }

  /**
   * Iterate insertion-ordered duplicate values for ordinals `>= on`.
   * TypeScript-local name for KERIpy `getOnIoDupValIter`.
   */
  *getOnIoDupIterAll(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<Uint8Array> {
    for (const [_, __, val] of this.getOnIoDupItemIterAll(db, key, on, sep)) {
      yield val;
    }
  }

  /**
   * Iterate `(key, on, val)` insertion-ordered duplicates for ordinals `>= on`.
   * TypeScript-local name for KERIpy `getOnIoDupItemIter`.
   */
  *getOnIoDupItemIterAll(
    db: Database<BinVal, BinKey>,
    key: Uint8Array = new Uint8Array(0),
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [ckey, con, cval] of this.getOnAllItemIter(db, key, on, sep)) {
      yield [ckey, con, stripIoDupProem(cval)];
    }
  }
}

/**
 * Remove a databaser directory recursively.
 * Mirrors KERIpy `clearDatabaserDir` behavior and ignores missing paths.
 */
export function clearDatabaserDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/** KERIpy-parity alias for creating/opening an `LMDBer`. */
export function* openLMDB(
  options: LMDBerOptions = {},
  defaults?: Partial<LMDBerDefaults>,
): Operation<LMDBer> {
  return yield* createLMDBer(options, defaults);
}

/** Create and open an `LMDBer` (constructor-safe async factory). */
export function* createLMDBer(
  options: LMDBerOptions = {},
  defaults?: Partial<LMDBerDefaults>,
): Operation<LMDBer> {
  const lmdber = new LMDBer(options, defaults);
  const opened = yield* lmdber.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open LMDBer");
  }
  return lmdber;
}
