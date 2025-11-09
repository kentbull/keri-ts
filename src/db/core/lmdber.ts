/**
 * LMDBer - Core LMDB database manager
 *
 * Manages LMDB database environments and provides CRUD operations.
 * Uses composition with PathManager instead of inheritance.
 */

import { type Operation } from "effection";
import { Database, Key, open, RootDatabase } from "lmdb";
import { startsWith } from "../../core/bytes.ts";
import { PathManager, PathManagerDefaults, PathManagerOptions } from "./path-manager.ts";

export type BinVal = Uint8Array;
export type BinKey = Uint8Array;

// Module-level encoder/decoder instances (stateless, reusable)
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Short helpers for string ↔ Uint8Array conversion
// bytes from string/text (UTF-8)
export const b = (t: string): Uint8Array => encoder.encode(t);
// text/string from bytes (UTF-8)
export const t = (b: Uint8Array): string => decoder.decode(b);

export interface LMDBerOptions extends PathManagerOptions {
  readonly?: boolean;
  dupsort?: boolean;
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
  altTailDirPath: ".keri/db",
  altCleanTailDirPath: ".keri/clean/db",
  tempHeadDir: "/tmp",
  tempPrefix: "keri_lmdb_",
  tempSuffix: "_test",
  perm: 0o1700,
  mode: "r+",
  fext: "text",
  maxNamedDBs: 96,
  mapSize: 4 * 1024 * 1024 * 1024, // 4GB default
};

/**
 * LMDBer manages LMDB database environments
 * Uses composition with PathManager for path management
 */
export class LMDBer {
  private pathManager: PathManager;
  public env: RootDatabase<any, Key> | null;
  public readonly: boolean;
  private defaults: LMDBerDefaults;

  // Class constants
  static readonly HeadDirPath = "/usr/local/var";
  static readonly TailDirPath = "keri/db";
  static readonly CleanTailDirPath = "keri/clean/db";
  static readonly AltHeadDirPath = "~";
  static readonly AltTailDirPath = ".keri/db";
  static readonly AltCleanTailDirPath = ".keri/clean/db";
  static readonly TempHeadDir = "/tmp";
  static readonly TempPrefix = "keri_lmdb_";
  static readonly TempSuffix = "_test";
  static readonly Perm = 0o1700;
  static readonly MaxNamedDBs = 96;

  constructor(options: LMDBerOptions = {}, defaults?: Partial<LMDBerDefaults>) {
    this.defaults = { ...LMDBER_DEFAULTS, ...defaults };

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

  /**
   * Reopen the LMDB database
   * Closes existing database if open before opening a new one to prevent double-free errors
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
        console.warn(`Warning: Error closing existing LMDB environment: ${error}`);
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
    const mapSizeEnv = process.env.KERI_LMDB_MAP_SIZE;
    const mapSize = mapSizeEnv ? parseInt(mapSizeEnv, 10) : this.defaults.mapSize;

    // Check if database files exist before opening
    const dbExists = yield* this.checkDatabaseExists();

    // If readonly and database doesn't exist, we need to handle that gracefully
    // For readonly mode, database files must exist
    if (readonly && !dbExists) {
      console.error(`Cannot open readonly database: database files do not exist at ${dbPath}`);
      this.env = null;
      return false;
    }

    // For readonly opens of existing databases, use a large mapSize that's safe
    // LMDB will use the actual map size from the database file, but the Node.js
    // lmdb package requires mapSize to be >= the database's actual map size
    // Use 4GB (KERIpy default) or larger to ensure compatibility
    const effectiveMapSize =
      readonly && dbExists
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
    console.log(`Opening LMDB at: ${dbPath} (readonly: ${readonly}, mapSize: ${effectiveMapSize})`);

    // Open LMDB environment
    // LMDB's open() will create data.mdb and lock.mdb if they don't exist
    try {
      // do sync because wrapping synchronous native operations in action() can cause
      // memory management issues with native bindings (double-free errors)
      this.env = open(dbConfig);
      console.log(`LMDB environment opened successfully`);

      // Set version if new database and not readonly
      if (this.opened && !readonly && !dbExists && !this.temp) {
        // Set version for new database
        const version = "1.0.0"; // Default version
        this.setVer(version);
      }

      return this.opened;
    } catch (error) {
      console.error(`Failed to open LMDB: ${error}`);
      this.env = null;
      return false;
    }
  }

  /**
   * Check if database already exists by checking for database files
   */
  private *checkDatabaseExists(): Operation<boolean> {
    if (!this.pathManager.path) {
      return false;
    }

    // Check if database files exist (now an Effection operation)
    return yield* this.pathManager.databaseFilesExist();
  }

  /**
   * Close the LMDB database
   */
  *close(clear = false): Operation<boolean> {
    if (this.env) {
      try {
        this.env.close();
      } catch (error) {
        // Ignore close errors (database might already be closed)
        console.warn(`Error closing LMDB: ${error}`);
      }
      this.env = null;
    }

    // Close path manager (now an Effection operation)
    yield* this.pathManager.close(clear);

    return true;
  }

  /**
   * Get database version
   */
  getVer(): string | null {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      const versionBytes: Uint8Array = this.env.get(b("__version__"));
      const version = t(versionBytes);
      return version || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Set database version
   */
  setVer(val: string): void {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      this.env.transactionSync(() => {
        this.env!.putSync(b("__version__"), b(val));
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Open a named sub-database
   */
  openDB(name: string, dupsort = false): Database<BinVal, BinKey> {
    if (!this.env) {
      throw new Error("Database not opened");
    }
    return this.env.openDB(name, {
      keyEncoding: "binary",
      encoding: "binary", // Use binary encoding for values (raw bytes) to match KERIpy
      dupSort: dupsort,
    });
  }

  /**
   * Put value (no overwrite)
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @param val - Value bytes
   * @returns True if successfully written, False if key already exists
   */
  putVal(db: Database<BinVal, BinKey>, key: Uint8Array, val: Uint8Array): boolean {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      const result = this.env.transactionSync(() => {
        const existing = db.get(key);
        if (existing !== null && existing !== undefined) {
          return false;
        }
        db.put(key, val);
        return true;
      });
      return result;
    } catch (error) {
      throw new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`);
    }
  }

  /**
   * Set value (overwrite allowed)
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @param val - Value bytes
   * @returns True if successfully written
   */
  setVal(db: Database<BinVal, BinKey>, key: Uint8Array, val: Uint8Array): boolean {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      this.env.transactionSync(() => {
        db.put(key, val);
      });
      return true;
    } catch (error) {
      throw new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`);
    }
  }

  /**
   * Get value
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @returns Value bytes or null if not found
   */
  getVal(db: Database<BinVal, BinKey>, key: Uint8Array): Uint8Array | null {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      const val = db.get(key);
      if (val === null || val === undefined) {
        return null;
      } else {
        return val instanceof Uint8Array ? val : new Uint8Array(val);
      }
    } catch (error) {
      throw new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`);
    }
  }

  /**
   * Delete value
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @returns True if key existed, False otherwise
   */
  delVal(db: Database<BinVal, BinKey>, key: Uint8Array): boolean {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      const result = this.env.transactionSync(() => {
        const exists = db.get(key) !== null && db.get(key) !== undefined;
        if (exists) {
          db.remove(key);
        }
        return exists;
      });
      return result;
    } catch (error) {
      throw new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`);
    }
  }

  /**
   * Count all values in database
   *
   * @param db - Named sub-database
   * @returns Count of entries
   */
  cnt(db: Database<BinVal, BinKey>): number {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    try {
      let count = 0;
      for (const _ of db.getRange({})) {
        count++;
      }
      return count;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Iterates over branch of db given by top key
   *
   * Returns iterator of (full key, val) tuples over a branch of the db given by top key
   * where: full key is full database key for val not truncated top key.
   *
   * Works for both dupsort==False and dupsort==True
   * Because cursor.iternext() advances cursor after returning item its safe
   * to delete the item within the iteration loop.
   *
   * @param db - Named sub-database
   * @param top - Truncated top key, a key space prefix to get all the items
   *              from multiple branches of the key space. If top key is
   *              empty then gets all items in database.
   *              Empty Uint8Array matches all keys (like str.startswith('') always returns True)
   * @returns Generator yielding (key, val) tuples
   */
  *getTopItemIter(
    db: Database<BinVal, BinKey>,
    top: Uint8Array = new Uint8Array(0)
  ): Generator<[Uint8Array, Uint8Array]> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

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
      // If iteration fails, return empty generator
      console.warn(`Error iterating database: ${error}`);
    }
  }
}
