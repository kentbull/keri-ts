/**
 * Core LMDB manager used by higher-level DB abstractions.
 */

import { type Operation } from "npm:effection@^3.6.0";
import { Database, Key, open, RootDatabase } from "npm:lmdb@^3.4.4";
import { startsWith } from "../../core/bytes.ts";
import {
  DatabaseKeyError,
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";
import {
  PathManager,
  PathManagerDefaults,
  PathManagerOptions,
} from "./path-manager.ts";

export type BinVal = Uint8Array;
export type BinKey = Uint8Array;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 string -> bytes helper. */
export const b = (t: string): Uint8Array => encoder.encode(t);
/** UTF-8 bytes -> string helper. */
export const t = (b: Uint8Array): string => decoder.decode(b);

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
        // Close synchronously - LMDB close() is synchronous
        this.env.close();
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
        this.env.close();
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

  /** Delete one key. Returns `true` only when the key existed. */
  delVal(db: Database<BinVal, BinKey>, key: Uint8Array): boolean {
    const env = this.requireEnv();

    try {
      const result = env.transactionSync(() => {
        const exists = db.get(key) !== null && db.get(key) !== undefined;
        if (exists) {
          db.remove(key);
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
   */
  cntTop(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
  ): number {
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

  /** KERIpy parity alias for `cnt`. */
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
   * Iterate `(key, value)` entries whose keys share the prefix `top`.
   * Empty `top` iterates the whole database.
   */
  *getTopItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
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
