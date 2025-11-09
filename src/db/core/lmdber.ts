/**
 * LMDBer - Core LMDB database manager
 *
 * Manages LMDB database environments and provides CRUD operations.
 * Uses composition with PathManager instead of inheritance.
 */

import { action, type Operation } from "effection";
import { Database, Key, open, RootDatabase } from "lmdb";
import { PathManager, PathManagerDefaults, PathManagerOptions } from "./path-manager.ts";

export interface LMDBerOptions extends PathManagerOptions {
  readonly?: boolean;
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
  private _version: string | null;
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
    this._version = null;
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

    // Get map size from environment variable or use default
    const mapSizeEnv = process.env.KERI_LMDB_MAP_SIZE;
    const mapSize = mapSizeEnv ? parseInt(mapSizeEnv, 10) : this.defaults.mapSize;

    // Check if database files exist before opening
    const dbExists = yield* this.checkDatabaseExists();

    // Open LMDB environment
    // LMDB's open() will create data.mdb and lock.mdb if they don't exist
    // Ensure path is absolute (expand ~ if needed)
    if (!this.pathManager.path) {
      return false;
    }

    // Ensure path doesn't contain ~ (should already be expanded by PathManager, but double-check)
    let dbPath = this.pathManager.path;
    if (dbPath.startsWith("~/") || dbPath === "~") {
      const home = process.env.HOME;
      if (home) {
        dbPath = dbPath.replace("~", home);
      }
    }

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

    // Try using directory path first (Node.js lmdb may accept either)
    // If that fails, we'll try the data.mdb file path
    const dbconfig: {
      path: string;
      maxDbs: number;
      mapSize: number;
      readOnly: boolean;
      compression?: boolean;
    } = {
      path: dbPath, // Use directory path (Node.js lmdb should handle this)
      maxDbs: this.defaults.maxNamedDBs,
      mapSize: effectiveMapSize,
      readOnly: readonly,
      compression: false, // Disable compression for compatibility
    };
    console.log(`Opening LMDB at: ${dbPath} (readonly: ${readonly}, mapSize: ${effectiveMapSize})`);

    try {
      // Open synchronously - LMDB's open() is synchronous
      // Do NOT wrap in action() - synchronous operations should be called directly
      // Wrapping synchronous native operations in action() can cause memory management issues
      // with native bindings (double-free errors)
      this.env = open(dbconfig);
      console.log(`LMDB environment opened successfully`);

      // TODO: Uncomment when database access is verified
      // Set version if new database and not readonly
      // if (this.opened && !readonly && !dbExists && !this.temp) {
      //   // Set version for new database
      //   const version = "1.0.0"; // Default version
      //   yield* this.setVer(version);
      // }

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
      yield* action((resolve, reject) => {
        const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
        // Defer resolution to ensure cleanup hook is registered
        queueMicrotask(() => {
          try {
            this.env!.close();
            resolve(undefined);
          } catch (error) {
            // Ignore close errors
            console.warn(`Error closing LMDB: ${error}`);
            resolve(undefined);
          }
        });
        return cleanup;
      });
      this.env = null;
    }

    // Close path manager (now an Effection operation)
    yield* this.pathManager.close(clear);

    return true;
  }

  /**
   * Get database version
   */
  *getVer(): Operation<string | null> {
    if (this._version !== null) {
      return this._version;
    }

    if (!this.env) {
      return null;
    }

    return yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          const versionBytes = this.env!.get("__version__");
          if (versionBytes) {
            const version =
              typeof versionBytes === "string"
                ? versionBytes
                : new TextDecoder().decode(versionBytes as Uint8Array);
            this._version = version;
            resolve(version);
          } else {
            resolve(null);
          }
        } catch (error) {
          resolve(null);
        }
      });
      return cleanup;
    });
  }

  /**
   * Set database version
   */
  *setVer(val: string): Operation<void> {
    this._version = val;

    if (!this.env) {
      return;
    }

    yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          const versionBytes = new TextEncoder().encode(val);
          this.env!.transactionSync(() => {
            this.env!.putSync("__version__", versionBytes);
          });
          resolve(undefined);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return cleanup;
    });
  }

  /**
   * Get version property
   */
  get version(): string | null {
    return this._version;
  }

  /**
   * Set version property
   */
  set version(val: string) {
    this._version = val;
  }

  /**
   * Open a named sub-database
   */
  openDB(name: string, dupsort = false): Database<any, Key> {
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
  *putVal(db: Database<any, Key>, key: Uint8Array, val: Uint8Array): Operation<boolean> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    return yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          const result = this.env!.transactionSync(() => {
            const existing = db.get(key);
            if (existing !== null && existing !== undefined) {
              return false;
            }
            db.put(key, val);
            return true;
          });
          resolve(result);
        } catch (error) {
          reject(new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`));
        }
      });
      return cleanup;
    });
  }

  /**
   * Set value (overwrite allowed)
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @param val - Value bytes
   * @returns True if successfully written
   */
  *setVal(db: Database<any, Key>, key: Uint8Array, val: Uint8Array): Operation<boolean> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    return yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          this.env!.transactionSync(() => {
            db.put(key, val);
          });
          resolve(true);
        } catch (error) {
          reject(new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`));
        }
      });
      return cleanup;
    });
  }

  /**
   * Get value
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @returns Value bytes or null if not found
   */
  *getVal(db: Database<any, Key>, key: Uint8Array): Operation<Uint8Array | null> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    return yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          const val = db.get(key);
          if (val === null || val === undefined) {
            resolve(null);
          } else {
            resolve(val instanceof Uint8Array ? val : new Uint8Array(val));
          }
        } catch (error) {
          reject(new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`));
        }
      });
      return cleanup;
    });
  }

  /**
   * Delete value
   *
   * @param db - Named sub-database
   * @param key - Key bytes
   * @returns True if key existed, False otherwise
   */
  *delVal(db: Database<any, Key>, key: Uint8Array): Operation<boolean> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    return yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          const result = this.env!.transactionSync(() => {
            const exists = db.get(key) !== null && db.get(key) !== undefined;
            if (exists) {
              db.remove(key);
            }
            return exists;
          });
          resolve(result);
        } catch (error) {
          reject(new Error(`Key: \`${key}\` is either empty, too big, or wrong size. ${error}`));
        }
      });
      return cleanup;
    });
  }

  /**
   * Count all values in database
   *
   * @param db - Named sub-database
   * @returns Count of entries
   */
  *cnt(db: Database<any, Key>): Operation<number> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    return yield* action((resolve, reject) => {
      const cleanup = () => {}; // Cleanup function (no-op for synchronous operations)
      // Defer resolution to ensure cleanup hook is registered
      queueMicrotask(() => {
        try {
          let count = 0;
          for (const _ of db.getRange({})) {
            count++;
          }
          resolve(count);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return cleanup;
    });
  }

  /**
   * Get iterator over all items in database
   *
   * @param db - Named sub-database
   * @param key - Starting key (empty to start from beginning)
   * @param split - Whether to split key at separator
   * @param sep - Separator character
   * @returns Generator yielding tuples
   */
  *getAllItemIter(
    db: Database<any, Key>,
    key: Uint8Array = new Uint8Array(0),
    split = true,
    sep: Uint8Array = new TextEncoder().encode(".")
  ): Generator<Uint8Array[] | [Uint8Array, Uint8Array]> {
    if (!this.env) {
      throw new Error("Database not opened");
    }

    const sepStr = new TextDecoder().decode(sep);
    const startKey = key.length > 0 ? key : undefined;

    try {
      // getRange returns RangeIterable<{ key: K, value: V }>, not tuples
      for (const entry of db.getRange({ start: startKey })) {
        const dbKey = entry.key;
        const dbVal = entry.value;

        // Convert key to Uint8Array
        let keyBytes: Uint8Array;
        if (dbKey instanceof Uint8Array) {
          keyBytes = dbKey;
        } else if (typeof dbKey === "string") {
          keyBytes = new TextEncoder().encode(dbKey);
        } else if (dbKey instanceof ArrayBuffer) {
          keyBytes = new Uint8Array(dbKey);
        } else {
          // Try to convert array-like or other types
          keyBytes = new Uint8Array(dbKey as ArrayLike<number>);
        }

        // Convert value to Uint8Array
        let valBytes: Uint8Array;
        if (dbVal instanceof Uint8Array) {
          valBytes = dbVal;
        } else if (typeof dbVal === "string") {
          valBytes = new TextEncoder().encode(dbVal);
        } else if (dbVal instanceof ArrayBuffer) {
          valBytes = new Uint8Array(dbVal);
        } else {
          // Try to convert array-like or other types
          valBytes = new Uint8Array(dbVal as ArrayLike<number>);
        }

        if (split) {
          const keyStr = new TextDecoder().decode(keyBytes);
          const splits: Uint8Array[] = keyStr.split(sepStr).map((s) => new TextEncoder().encode(s));
          splits.push(valBytes);
          yield splits;
        } else {
          yield [keyBytes, valBytes];
        }
      }
    } catch (error) {
      // If iteration fails, return empty generator
      console.warn(`Error iterating database: ${error}`);
    }
  }
}
