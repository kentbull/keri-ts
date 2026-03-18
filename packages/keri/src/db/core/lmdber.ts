/**
 * Core LMDB manager used by higher-level DB abstractions.
 */

import { action, type Operation } from "npm:effection@^3.6.0";
import { Database, Key, open, RootDatabase } from "npm:lmdb@3.5.2";
import { b, bytesEqual, bytesHex, t, toBytes } from "../../../../cesr/mod.ts";
import { startsWith } from "../../core/bytes.ts";
import {
  DatabaseKeyError,
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";
import { onKey, splitOnKey, suffix, unsuffix } from "./keys.ts";
import { PathManager, PathManagerDefaults, PathManagerOptions } from "./path-manager.ts";

/** Binary LMDB key type used by the low-level wrapper surface. */
export type BinKey = Uint8Array;
/** Binary LMDB value type used by the low-level wrapper surface. */
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

/** Defaultable LMDB/path settings shared by all `LMDBer` instances. */
export interface LMDBerDefaults extends PathManagerDefaults {
  maxNamedDBs: number;
  mapSize: number;
}

/** Default LMDB/path settings used when callers do not override environment wiring. */
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

/**
 * Core LMDB environment wrapper plus KERI-style storage families.
 *
 * Responsibilities:
 * - own LMDB environment open/close/reopen lifecycle
 * - expose KERI-style storage families used by higher DB abstractions
 * - centralize path/version/dupsort semantics so callers reason at the family
 *   level instead of hand-rolling raw LMDB access
 *
 * Read this class by storage family, not as a flat method list:
 *  - plain key/value
 *  - branch scans
 *  - `On*`     : ordinal-key
 *  - `IoSet*`  : synthetic insertion-order sets
 *  - `OnIoSet*`: ordinal synthetic sets (TS-only)
 *  - `Dup*`    : native dupsort duplicates
 *  - `IoDup*`  : insertion-ordered duplicates via hidden proem
 *  - `OnIoDup*`: ordinal insertion-ordered duplicates
 *
 * Current `keri-ts` difference:
 * - includes TypeScript-only `OnIoSet*` helpers and a composition-based
 *   `PathManager` lifecycle instead of inheriting KERIpy's exact structure
 */
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

  /** Expose the resolved logical database name used for path derivation and temp dirs. */
  get name(): string {
    return this.pathManager.name;
  }

  /** Expose the resolved database base prefix used by the shared path manager. */
  get base(): string {
    return this.pathManager.base;
  }

  /** Report whether the LMDB environment is currently open and backed by a live root handle. */
  get opened(): boolean {
    return this.pathManager.opened && this.env !== null;
  }

  /** Report whether this environment uses a temporary backing directory. */
  get temp(): boolean {
    return this.pathManager.temp;
  }

  /** Expose the resolved filesystem path for the active environment, when available. */
  get path(): string | null {
    return this.pathManager.path;
  }

  /** Require a live root LMDB environment before performing any storage operation. */
  private requireEnv(): RootDatabase<any, Key> {
    if (!this.env) {
      throw new DatabaseNotOpenError("LMDB environment is not open");
    }
    return this.env;
  }

  /** Normalize low-level LMDB key-shape failures into one project-specific error type. */
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
   * Reopen the LMDB environment at the resolved path.
   *
   * This is the lifecycle entrypoint for the root LMDB env: it closes any
   * existing env first, re-resolves the backing path, opens the root database,
   * and stamps the default version marker on newly-created writable envs.
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
    this.logger.debug(
      `Opening LMDB at: ${dbPath} (readonly: ${readonly}, mapSize: ${effectiveMapSize})`,
    );

    // Open LMDB environment
    // LMDB's open() will create data.mdb and lock.mdb if they don't exist
    try {
      // do sync because wrapping synchronous native operations in action() can cause
      // memory management issues with native bindings (double-free errors)
      this.env = open(dbConfig);
      this.logger.debug(`LMDB environment opened successfully`);

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

  /**
   * Close the root LMDB env and path manager.
   *
   * This waits for LMDB-js async close completion and its internal read-reset
   * timers before optional path cleanup, so test/resource teardown does not
   * leak across later work.
   */
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

  /**
   * Read the root `__version__` marker.
   *
   * Missing or malformed metadata is treated as unknown and returns `null`.
   */
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

  /** Write the root `__version__` marker. */
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

  /**
   * TypeScript-only convenience for opening a named sub-database.
   *
   * All sub-databases use binary key/value encoding; `dupsort=true` enables
   * native LMDB duplicate values for `Dup*` / `IoDup*` families.
   */
  openDB(name: string, dupsort = false): Database<BinVal, BinKey> {
    const env = this.requireEnv();
    return env.openDB(name, {
      keyEncoding: "binary",
      encoding: "binary", // Use binary encoding for values (raw bytes) to match KERIpy
      dupSort: dupsort,
    });
  }

  /*
   * Plain key/value family (`dupsort=false` parity surface)
   * Logical shape: one physical key -> one value.
   * Multiplicity: none.
   * Ordering: plain LMDB key order only matters for branch scans.
   * Parity status: direct KERIpy LMDBer analogs.
   */

  /**
   * Write `val` at `key` only when the key is absent.
   *
   * Plain key/value storage with no duplicate semantics. Returns `false` when
   * an entry already exists at `key`. Mirrors KERIpy `putVal`.
   */
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

  /**
   * Write `val` at `key`, overwriting any existing value.
   *
   * Plain key/value upsert. Returns `true` on successful write. Mirrors KERIpy
   * `setVal`.
   */
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

  /**
   * Fetch the value stored exactly at `key`.
   *
   * Plain key/value lookup. Returns `null` when the key is missing. Mirrors
   * KERIpy `getVal`.
   */
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

  /**
   * Delete the value stored at `key`.
   *
   * For plain key/value DBs this removes the whole key. When `val` is supplied
   * against a dupsort DB, this removes just that duplicate value. The plain K/V
   * behavior mirrors KERIpy `delVal`.
   */
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

  /**
   * Count all physical entries in the sub-database.
   *
   * For dupsort DBs, duplicate values are included in the count because LMDB
   * stores them as separate entries. Mirrors KERIpy `cnt`.
   */
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

  /*
   * Branch/prefix family
   * Logical shape: lexicographic scans over contiguous keyspace branches.
   * Multiplicity: inherited from the underlying DB family.
   * Ordering: plain LMDB key order / duplicate entry order.
   * Parity status: KERIpy-style branch helpers plus one TS-local alias.
   */

  /**
   * Count entries whose keys begin with prefix `top`.
   *
   * This is a lexicographic key-prefix scan, not a special storage model.
   * Empty `top` counts the whole DB. Duplicate entries in dupsort DBs are
   * included. TypeScript-only convenience alongside KERIpy `getTopItemIter`
   * and `delTopVal`.
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
   * TypeScript-only convenience alias for `cnt(db)`.
   *
   * This counts the whole DB, including duplicate entries in dupsort DBs.
   */
  cntAll(db: Database<BinVal, BinKey>): number {
    return this.cnt(db);
  }

  /**
   * Delete entries whose keys begin with prefix `top`.
   *
   * This is a lexicographic key-prefix delete, not a separate storage family.
   * Empty `top` deletes the whole DB. Mirrors KERIpy `delTopVal`.
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
   * Iterate `(key, value)` entries whose keys begin with prefix `top`.
   *
   * This is a lexicographic branch scan over physical keys. Empty `top`
   * iterates the whole DB. Returned keys are the full stored keys, not trimmed
   * branch-relative suffixes. Mirrors KERIpy `getTopItemIter`.
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

  /**
   * Write `val` at `onKey(key, on)`, overwriting any existing value.
   *
   * TypeScript-local rename of KERIpy `setOnVal`.
   */
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
   * Append `val` at the next ordinal slot for `key`.
   *
   * This scans backward from the `key.MaxON` boundary to find the current tail,
   * then writes at the next ordinal. Returns the appended ordinal. Mirrors
   * KERIpy `appendOnVal`.
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
          `Number part cn=${cn} for key part ckey=${Array.from(ckey)} exceeds maximum size.`,
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

  /**
   * TypeScript-only convenience returning the exact `(key, on, val)` triple.
   *
   * Returns `null` when that exact ordinal entry is missing.
   */
  getOnItem(
    db: Database<BinVal, BinKey>,
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

  /**
   * Remove the value stored exactly at `onKey(key, on)`.
   *
   * Empty logical keys return `false`. TypeScript-local rename of KERIpy
   * `delOnVal`.
   */
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

  /**
   * Remove all ordinal entries for `key` starting at ordinal `on`.
   *
   * Empty `key` removes the whole DB branch. TypeScript-only convenience built
   * on the same ordinal-key semantics as KERIpy `delOnVal`.
   */
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
   * Count ordinal-keyed entries for `key` starting at ordinal `on`.
   *
   * Empty `key` counts the whole DB. TypeScript-local rename of KERIpy
   * `cntOnVals`.
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

  /**
   * Iterate `(key, on, val)` triples whose physical keys begin with branch `top`.
   *
   * This is the ordinal-key version of `getTopItemIter`, so branch membership is
   * still a lexicographic key-prefix concept. TypeScript-only convenience.
   */
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
   * Iterate `(key, on, val)` triples for ordinals `>= on`.
   *
   * Empty `key` iterates the whole DB. Ordering follows the fixed-width ordinal
   * encoded in the key. TypeScript-local rename of KERIpy `getOnItemIter`.
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
   * Replace the insertion-ordered set at `key` with the provided unique values.
   *
   * This clears the existing synthetic key run for `key`, then rewrites fresh
   * hidden suffixes from zero. TypeScript-local rename of KERIpy `setIoSetVals`.
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

  /**
   * Add one value to the insertion-ordered set at `key` if it is not present.
   *
   * Membership is checked by scanning the synthetic key run for `key`; new
   * values append at the next hidden suffix. Mirrors KERIpy `addIoSetVal`.
   */
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
   * Iterate `(key, val)` pairs for the insertion-ordered set at `key`.
   *
   * Iteration starts at hidden insertion ordinal `ion`. Returned keys are the
   * logical effective key with the hidden suffix removed. TypeScript-local item
   * variant corresponding to KERIpy `getIoSetValsIter`.
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

  /**
   * Return the last logical set member at `key`, or `null`.
   *
   * "Last" means the entry stored under the greatest hidden insertion suffix,
   * not the lexicographically greatest value bytes. TypeScript-local item
   * variant corresponding to KERIpy `getIoSetValLast`.
   */
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
   *
   * This deletes the full synthetic key run for the effective key. TypeScript-
   * local rename of KERIpy `delIoSetVals`.
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
   * Remove one logical set member at `key`, or all members when `val` is `null`.
   *
   * Delete-by-value requires a linear search because the caller does not know
   * the hidden insertion suffix. As in KERIpy, suffix ordinals can grow
   * monotonically over time after deletes and reinserts. TypeScript-local rename
   * of KERIpy `delIoSetVal`.
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

  /**
   * Count logical set members at `key` starting from hidden insertion ordinal `ion`.
   *
   * TypeScript-local item-count variant corresponding to KERIpy `cntIoSetVals`.
   */
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
   * Iterate `(key, val)` pairs for all synthetic-set entries in branch `top`.
   *
   * Branch membership is still a lexicographic key-prefix scan over the
   * physical suffixed keys; returned keys have the hidden insertion suffix
   * removed. Mirrors KERIpy `getTopIoSetItemIter`.
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
   * Iterate the last `(key, val)` member for each effective io-set key.
   *
   * Empty `key` iterates the whole DB. "Last" is determined by hidden suffix
   * order. TypeScript-local item variant built from KERIpy `getIoSetValLast`
   * and branch iteration semantics.
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

  /**
   * Iterate only the last logical values for each effective io-set key `>= key`.
   *
   * TypeScript-only convenience built on `getIoSetLastItemIterAll`.
   */
  *getIoSetLastIterAll(
    db: Database<BinVal, BinKey>,
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

  /**
   * TypeScript-only extension. Replace set members at ordinal effective key.
   *
   * This is the ordinal-bucketed counterpart to `pinIoSetVals`.
   */
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
   * TypeScript-only extension. Append a new ordinal bucket for `key`.
   *
   * Returns the newly appended exposed ordinal. Within that bucket, the values
   * are stored as an `IoSet` using hidden insertion suffixes.
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

  /**
   * TypeScript-only extension. Add one set member inside an ordinal bucket.
   *
   * This is the ordinal-bucketed counterpart to `addIoSetVal`.
   */
  addOnIoSetVal(
    db: Database<BinVal, BinKey>,
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

  /**
   * TypeScript-only extension. Fetch the last member in one ordinal bucket.
   *
   * Returns `null` when that exact ordinal bucket is empty or missing.
   */
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

  /**
   * TypeScript-only extension. Remove one member from an ordinal bucket.
   *
   * When `val` is `null`, removes the whole ordinal bucket.
   */
  remOnIoSetVal(
    db: Database<BinVal, BinKey>,
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

  /**
   * TypeScript-only extension. Count members in one ordinal bucket from insertion ordinal `ion`.
   */
  cntOnIoSet(
    db: Database<BinVal, BinKey>,
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
   * TypeScript-only extension. Iterate `(key, on, val)` members in branch `top`.
   *
   * This is the branch-scan form of `OnIoSet*`, still based on lexicographic
   * physical key-prefix traversal.
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
   * TypeScript-only extension. Iterate `(key, on, val)` members for ordinals `>= on`.
   *
   * Empty `key` iterates the whole DB.
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

  /**
   * TypeScript-only extension. Iterate the last member for each ordinal bucket.
   *
   * Empty `key` iterates all logical keys and ordinals in the DB.
   */
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

  /**
   * TypeScript-only extension. Iterate backward over `(key, on, val)` members.
   *
   * Backward order is materialized from the forward iterator, then reversed.
   */
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

  /**
   * TypeScript-only extension. Iterate backward over the last member per ordinal bucket.
   */
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

  /*
   * Native dupsort duplicate family (`Dup*`)
   * Logical shape: one physical key -> many native LMDB duplicate values.
   * Multiplicity: native LMDB dupsort values.
   * Ordering: lexicographic by stored value bytes, not insertion order.
   * Parity status: direct KERIpy analogs with small TS naming adjustments.
   */

  /**
   * Add each unique duplicate value in `vals` at `key`.
   *
   * LMDB dupsort orders duplicates lexicographically by stored value bytes, not
   * by insertion order. Returns `false` if any supplied value already existed.
   * Mirrors KERIpy `putVals`.
   */
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

  /**
   * Add one duplicate value at `key` if it does not already exist.
   *
   * Duplicate ordering is still lexicographic by stored value bytes. Mirrors
   * KERIpy `addVal`.
   */
  addVal(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    val: Uint8Array | null,
  ): boolean {
    const single = val === null ? [new Uint8Array(0)] : [val];
    return this.putVals(db, key, single);
  }

  /**
   * Get duplicate values at `key` in lexicographic stored-value order.
   *
   * Returns an empty list when `key` is missing. Mirrors KERIpy `getVals`.
   */
  getVals(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array[] {
    this.requireEnv();
    return [...db.getValues(key)].map((val) => toBytes(val));
  }

  /**
   * Get the lexicographically last duplicate value at `key`.
   *
   * "Last" here means LMDB dupsort order, not most-recent insertion. Returns
   * `null` when `key` is missing. Mirrors KERIpy `getValLast`.
   */
  getValLast(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array | null {
    const vals = this.getVals(db, key);
    return vals.length ? vals[vals.length - 1] : null;
  }

  /**
   * Iterate duplicate values at `key` in lexicographic stored-value order.
   *
   * Yields nothing when `key` is missing. Mirrors KERIpy `getValsIter`.
   */
  *getValsIter(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
  ): Generator<Uint8Array> {
    this.requireEnv();
    for (const val of db.getValues(key)) {
      yield toBytes(val);
    }
  }

  /** Count native dupsort values at `key`. Mirrors KERIpy `cntVals`. */
  cntVals(db: Database<BinVal, BinKey>, key: Uint8Array): number {
    this.requireEnv();
    return db.getValuesCount(key);
  }

  /** Delete all duplicate values at `key`. Mirrors KERIpy `delVals(key)`. */
  delVals(db: Database<BinVal, BinKey>, key: Uint8Array): boolean {
    this.requireEnv();
    return db.removeSync(key);
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

  /**
   * Add one insertion-ordered duplicate value at `key` if absent.
   *
   * Mirrors KERIpy `addIoDupVal`.
   */
  addIoDupVal(
    db: Database<BinVal, BinKey>,
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
  getIoDupVals(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array[] {
    return this.getVals(db, key).map((val) => stripIoDupProem(val));
  }

  /**
   * Iterate insertion-ordered duplicate values at `key`, with the hidden proem removed.
   *
   * Mirrors KERIpy `getIoDupValsIter`.
   */
  *getIoDupValsIter(
    db: Database<BinVal, BinKey>,
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
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
  ): Uint8Array | null {
    const last = this.getValLast(db, key);
    return last ? stripIoDupProem(last) : null;
  }

  /** Delete all insertion-ordered duplicates at `key`. Mirrors KERIpy `delIoDupVals`. */
  delIoDupVals(db: Database<BinVal, BinKey>, key: Uint8Array): boolean {
    return this.delVals(db, key);
  }

  /**
   * Delete one insertion-ordered duplicate value at `key`, matching the stripped logical value.
   *
   * This performs a linear search over stored proem-prefixed duplicates. Mirrors
   * KERIpy `delIoDupVal`.
   */
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

  /** Count insertion-ordered duplicates at `key`. Mirrors KERIpy `cntIoDupVals`. */
  cntIoDups(db: Database<BinVal, BinKey>, key: Uint8Array): number {
    return this.cntVals(db, key);
  }

  /**
   * Iterate `(key, val)` over branch `top`, stripping the hidden IoDup proem from each value.
   *
   * Mirrors KERIpy `getTopIoDupItemIter`.
   */
  *getTopIoDupItemIter(
    db: Database<BinVal, BinKey>,
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
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    vals: Iterable<Uint8Array>,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.putIoDupVals(db, onKey(key, on, sep), vals);
  }

  /** Add one insertion-ordered duplicate at ordinal effective key. Mirrors KERIpy `addOnIoDupVal`. */
  addOnIoDupVal(
    db: Database<BinVal, BinKey>,
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
    db: Database<BinVal, BinKey>,
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
   * TypeScript-only convenience iterating logical duplicates at one exact ordinal.
   *
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

  /**
   * TypeScript-only convenience fetching the last logical duplicate at one exact ordinal.
   */
  getOnIoDupLast(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): Uint8Array | null {
    return this.getIoDupValLast(db, onKey(key, on, sep));
  }

  /** Iterate the last logical duplicate value per ordinal bucket. Mirrors KERIpy `getOnIoDupLastValIter`. */
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

  /** Iterate `(key, on, val)` where `val` is the last logical duplicate per ordinal bucket. Mirrors KERIpy `getOnIoDupLastItemIter`. */
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
   * Iterate `(key, on, val)` logical duplicates across a top branch.
   *
   * This mirrors the KERIpy helper added for normalized `OnIoDupSuber`
   * branch iteration and strips the hidden insertion-order proem from each
   * duplicate value before yielding it.
   */
  *getOnTopIoDupItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
    sep: Uint8Array = DOT_SEP,
  ): Generator<[Uint8Array, number, Uint8Array]> {
    for (const [key, on, val] of this.getOnTopItemIter(db, top, sep)) {
      yield [key, on, stripIoDupProem(val)];
    }
  }

  /** Delete all insertion-ordered duplicates at one ordinal effective key. TypeScript-local rename of KERIpy `delOnIoDupVals`. */
  delOnIoDups(
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): boolean {
    return this.delIoDupVals(db, onKey(key, on, sep));
  }

  /** Delete one insertion-ordered duplicate at one ordinal effective key. Mirrors KERIpy `delOnIoDupVal`. */
  delOnIoDupVal(
    db: Database<BinVal, BinKey>,
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
    db: Database<BinVal, BinKey>,
    key: Uint8Array,
    on = 0,
    sep: Uint8Array = DOT_SEP,
  ): number {
    return this.cntIoDups(db, onKey(key, on, sep));
  }

  /** Iterate backwards over logical duplicate values. Mirrors KERIpy `getOnIoDupValBackIter`. */
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

  /** Iterate backwards over `(key, on, val)` logical duplicates. Mirrors KERIpy `getOnIoDupItemBackIter`. */
  *getOnIoDupItemBackIter(
    db: Database<BinVal, BinKey>,
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
   * Iterate `(key, on, val)` logical duplicates for ordinals `>= on`.
   *
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

/*
 * Factory and path helpers
 * Parity status: constructor-safe TS factories plus KERIpy-style directory helper.
 */

/**
 * Remove a databaser directory recursively.
 *
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

/**
 * TypeScript-only alias for creating and opening an `LMDBer`.
 *
 * This gives the constructor-safe factory shape used throughout `keri-ts`.
 */
export function* openLMDB(
  options: LMDBerOptions = {},
  defaults?: Partial<LMDBerDefaults>,
): Operation<LMDBer> {
  return yield* createLMDBer(options, defaults);
}

/**
 * TypeScript-only constructor-safe async factory for `LMDBer`.
 *
 * Opens the env via `reopen()` and throws if the env could not be opened.
 */
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
