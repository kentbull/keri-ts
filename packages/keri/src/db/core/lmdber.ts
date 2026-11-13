/**
 * Core LMDB manager used by higher-level DB abstractions.
 */

import { b, bytesHex, t, toBytes } from "cesr-ts";
import { action, call, ensure, type Operation } from "npm:effection@^3.6.0";
import { open } from "npm:lmdb@3.5.3";
import type { Database, Key, RootDatabase } from "npm:lmdb@3.5.3";
import { compareBytes, startsWith } from "../../core/bytes.ts";
import { DatabaseKeyError, DatabaseNotOpenError, DatabaseOperationError } from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";
import { BaseDBer, MAX_KEY_BYTES, type ScanOptions, type StoreIdentity, type Table, type TableEntry } from "./dber.ts";
import { PathManager, PathManagerDefaults, PathManagerOptions } from "./path-manager.ts";

/** Binary LMDB key type used by the low-level wrapper surface. */
export type BinKey = Uint8Array;
/** Binary LMDB value type used by the low-level wrapper surface. */
export type BinVal = Uint8Array;

/** The native lmdb-js database behind one `Table` handle issued by `LMDBer`. */
export type LmdbTable = Database<BinVal, BinKey> & Table;

/**
 * Reach the native database behind a handle this backend issued.
 *
 * Only LMDB-specific code may use this; backend-neutral code must stay on the
 * `DBer` contract.
 */
export function lmdbTable(table: Table): LmdbTable {
  return table as LmdbTable;
}

/** Clone native LMDB bytes so callers never retain addon-owned buffer views. */
function copyDbBytes(value: unknown): Uint8Array {
  return new Uint8Array(toBytes(value));
}

/** Reject a row ADR-0015 forbids with `DatabaseKeyError`, as every backend does, rather than a raw native error. */
function assertRowFits(table: Table, key: Uint8Array, val: Uint8Array): void {
  if (key.length === 0 || key.length > MAX_KEY_BYTES) {
    throw new DatabaseKeyError(`Key is empty, too big, or wrong size: ${key.length} bytes`);
  }
  if ((lmdbTable(table) as { dupSort?: boolean }).dupSort && (val.length === 0 || val.length > MAX_KEY_BYTES)) {
    throw new DatabaseKeyError(`Duplicate value is empty or larger than ${MAX_KEY_BYTES} bytes: ${val.length} bytes`);
  }
}

/**
 * A key no row can have. lmdb-js reads an empty one as the table's first key, and a
 * rejected over-long one can leave a read transaction open, so duplicate reads skip both.
 */
function isAbsentKey(key: Uint8Array): boolean {
  return key.length === 0 || key.length > MAX_KEY_BYTES;
}

/**
 * Build the lmdb-js range for a scan. lmdb-js writes into the options it is given
 * (`getKeys` sets `values: false`), so the caller's object must never be passed:
 * reusing it for a later `scan` would yield rows with no key or value. It also
 * refuses an `end` over the key limit, which is applied by comparison instead.
 */
function nativeRange(options: ScanOptions): { range: ScanOptions; end?: Uint8Array; long: boolean } {
  const range = { ...options };
  const long = range.end !== undefined && range.end.length > MAX_KEY_BYTES;
  if (long) delete range.end;
  return { range, end: options.end, long };
}

/** True once `key` reaches the exclusive `end` bound in scan direction. */
function pastEnd(key: Uint8Array, end: Uint8Array, reverse = false): boolean {
  const order = compareBytes(key, end);
  return reverse ? order <= 0 : order >= 0;
}

/**
 * Build one LMDB-js range option object for a KERIpy-style branch scan.
 *
 * KERIpy opens a fresh read transaction per branch helper call. On the
 * `lmdb-js` side, `snapshot: false` is the closest match for plain key/value
 * stores, but dupsort iterators reject that option, so those stay on the
 * default path until we replace them with a lower-level cursor implementation.
 */
function branchScanOptions(
  table: Table,
  start?: Uint8Array,
): { start?: Uint8Array; snapshot?: false } {
  const db = lmdbTable(table);
  return (db as { dupSort?: boolean }).dupSort
    ? { start }
    : { start, snapshot: false };
}

/**
 * LMDBer can be configured with read only, dupsort for storing values in keyspace,
 * and a logger.
 */
/** Where an LMDB store's files live and how they are mapped; meaningless on other backends. */
export interface LmdbLocation extends Omit<PathManagerOptions, keyof StoreIdentity> {
  dupsort?: boolean;
  /**
   * Requested LMDB map size in bytes.
   *
   * When opening an existing environment, the effective map size is raised to
   * at least the map size stored in `data.mdb` so KERIpy databases created with
   * large `KERI_*_MAP_SIZE` values (for example 10 GiB) can be opened without a
   * native abort from undersized virtual mapping.
   */
  mapSize?: number;
}

/** A store's backend-neutral identity plus its LMDB location. */
export interface LMDBerOptions extends StoreIdentity, LmdbLocation {}

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
  tempPrefix: "keri_lmdb_",
  tempSuffix: "_test",
  perm: 0o1700,
  mode: "r+",
  fext: "text",
  maxNamedDBs: 128,
  // 10 GiB default so common KERIpy deployments (e.g. KERI_BASER_MAP_SIZE=10GiB)
  // open without an explicit CLI/env override. Existing environments still
  // auto-raise to at least the map size stamped in `data.mdb` when larger.
  mapSize: 10 * 1024 * 1024 * 1024,
};

/** LMDB page size used when validating map sizes read from existing files. */
const LMDB_PAGE_SIZE = 4096;
/** Reject absurd header values rather than mapping terabytes of address space. */
const LMDB_MAP_SIZE_MAX = 1024 * 1024 * 1024 * 1024; // 1 TiB
/**
 * Floor applied when an existing `data.mdb` is present but its stored map size
 * cannot be parsed. Covers common KERIpy production values such as 10 GiB.
 */
const EXISTING_DB_MAP_SIZE_FLOOR = 16 * 1024 * 1024 * 1024; // 16 GiB

/**
 * Read the map size stamped into an existing LMDB `data.mdb` meta page.
 *
 * Returns null when the file is missing, too small, or the candidate map size
 * fails basic sanity checks (page alignment and range).
 */
export function readStoredLmdbMapSize(dataMdbPath: string): number | null {
  try {
    const file = Deno.openSync(dataMdbPath, { read: true });
    try {
      const header = new Uint8Array(40);
      const bytesRead = file.readSync(header);
      if (bytesRead === null || bytesRead < 40) {
        return null;
      }
      // On current LMDB data-v1 layouts used with keri-ts/KERIpy, me_mapsize is
      // a little-endian uint64 at offset 32 in the first meta page.
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const mapSize = Number(view.getBigUint64(32, true));
      if (
        !Number.isFinite(mapSize)
        || mapSize < LMDB_PAGE_SIZE
        || mapSize > LMDB_MAP_SIZE_MAX
        || mapSize % LMDB_PAGE_SIZE !== 0
      ) {
        return null;
      }
      return mapSize;
    } finally {
      file.close();
    }
  } catch {
    return null;
  }
}

/**
 * Resolve the map size used for `lmdb.open`.
 *
 * Precedence for the configured size:
 * 1. explicit option
 * 2. `KERI_LMDB_MAP_SIZE`
 * 3. `KERI_BASER_MAP_SIZE` (KERIpy-compatible alias used by witness deployments)
 * 4. library default
 *
 * Existing environments then raise the effective size to at least the map size
 * stored in `data.mdb` (or a conservative floor when the header is unreadable).
 */
export function resolveLmdbMapSize(args: {
  optionMapSize?: number;
  envMapSize?: string | null;
  baserEnvMapSize?: string | null;
  defaultMapSize: number;
  dataMdbPath?: string | null;
  databaseExists: boolean;
}): number {
  const parseEnv = (raw: string | null | undefined): number | undefined => {
    if (raw === undefined || raw === null || raw.trim() === "") {
      return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  };

  const configured = args.optionMapSize
    ?? parseEnv(args.envMapSize)
    ?? parseEnv(args.baserEnvMapSize)
    ?? args.defaultMapSize;

  if (!args.databaseExists) {
    return configured;
  }

  const stored = args.dataMdbPath
    ? readStoredLmdbMapSize(args.dataMdbPath)
    : null;
  if (stored !== null) {
    return Math.max(configured, stored);
  }
  return Math.max(configured, EXISTING_DB_MAP_SIZE_FLOOR);
}

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
export class LMDBer extends BaseDBer {
  private pathManager: PathManager;
  private root: RootDatabase<any, Key> | null;
  /** A rejected close remains authoritative: the binding may have disabled only part of the handle. */
  private closing: Promise<void> | null = null;

  /** Expose only a usable environment, never one whose shutdown has started or failed. */
  get env(): RootDatabase<any, Key> | null {
    return this.closing ? null : this.root;
  }
  public readonly: boolean;
  private defaults: LMDBerDefaults;
  private readonly logger: Logger;
  /** Optional constructor-level map size override applied on every reopen. */
  private configuredMapSize?: number;
  /** Existing-store maintenance may neither create tables nor clear its target. */
  private existingOnly = false;

  // Class constants
  static readonly HeadDirPath: string = "/usr/local/var";
  static readonly TailDirPath: string = "keri/db";
  static readonly CleanTailDirPath: string = "keri/clean/db";
  static readonly AltHeadDirPath: string = "~";
  static readonly AltTailDirPath: string = ".tufa/db";
  static readonly AltCleanTailDirPath: string = ".tufa/clean/db";
  static readonly TempHeadDir: string = "/tmp";
  static readonly TempPrefix: string = "keri_lmdb_";
  static readonly TempSuffix: string = "_test";
  static readonly Perm: number = 0o1700;
  static readonly MaxNamedDBs: number = 96;

  constructor(options: LMDBerOptions = {}, defaults?: Partial<LMDBerDefaults>) {
    super();
    this.defaults = { ...LMDBER_DEFAULTS, ...defaults };
    this.logger = options.logger ?? consoleLogger;
    this.configuredMapSize = options.mapSize;

    // Create PathManager with composition
    const pathDefaults: Partial<PathManagerDefaults> = {
      headDirPath: this.defaults.headDirPath,
      tailDirPath: this.defaults.tailDirPath,
      cleanTailDirPath: this.defaults.cleanTailDirPath,
      altHeadDirPath: this.defaults.altHeadDirPath,
      altTailDirPath: this.defaults.altTailDirPath,
      altCleanTailDirPath: this.defaults.altCleanTailDirPath,
      tempPrefix: this.defaults.tempPrefix,
      tempSuffix: this.defaults.tempSuffix,
      perm: this.defaults.perm,
    };

    this.pathManager = new PathManager(options, pathDefaults);
    this.root = null;
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

  /** Inspect the pinned lmdb-js writer at the storage boundary, without exposing its native handle. */
  get inWriteTransaction(): boolean {
    const root = this.requireEnv();
    if (!("env" in root) || !root.env || typeof root.env !== "object") {
      throw new DatabaseOperationError("Unsupported LMDB writer inspection");
    }
    return "writeTxn" in root.env && root.env.writeTxn != null;
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
  private formatDbKeyError(error: unknown): DatabaseKeyError {
    const message = error instanceof Error ? error.message : String(error);
    return new DatabaseKeyError(
      `Key is empty, too big, or wrong size: ${message}`,
      { cause: error },
    );
  }

  /** Join native shutdown even when the caller is cancelled; failed handles cannot be reused. */
  private *closeEnv(): Operation<void> {
    if (!this.closing && this.root) {
      const root = this.root;
      // lmdb-js disables reads/writes before completion. A rejection cannot prove
      // whether the environment is usable or fully closed; retain it as failed.
      this.closing = new Promise<void>((resolve, reject) => {
        // In 3.5.3 the callback runs after doClose, including outstanding reads.
        // The returned Promise alone can resolve before that deferred branch.
        const native = root as typeof root & { close(done: () => void): Promise<void> };
        native.close(resolve).catch(reject);
      }).then(() => {
        this.root = null;
        this.pathManager.opened = false;
      });
    }
    const pending = this.closing;
    if (pending) {
      yield* call(function*() {
        // Register joining before the async leaf. Effection reports a failing
        // ensure as destruction failure, including when its task is halted.
        yield* ensure(() => call(() => pending));
        yield* call(() => pending);
      });
      this.closing = null;
    }
  }

  /**
   * Reopen the LMDB environment at the resolved path.
   *
   * This is the lifecycle entrypoint for the root LMDB env: it closes any
   * existing env first, re-resolves the backing path, opens the root database,
   * and stamps the default version marker on newly-created writable envs.
   */
  *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    yield* this.closeEnv();
    const readonly = options.readonly ?? this.readonly;
    this.readonly = readonly;

    // Reopen path manager (now an Effection operation)
    yield* this.pathManager.reopen(options);
    if (!this.pathManager.path) {
      return false;
    }
    let dbPath = this.pathManager.path;

    // Check if database files exist before opening
    const dbExists = yield* this.checkDatabaseExists();

    // If readonly and database doesn't exist, we need to handle that gracefully
    // For readonly mode, database files must exist
    if (readonly && !dbExists) {
      this.logger.error(
        `Cannot open readonly database: database files do not exist at ${dbPath}`,
      );
      this.root = null;
      return false;
    }

    if (options.mapSize !== undefined) this.configuredMapSize = options.mapSize;
    this.existingOnly = false;
    this.openEnvironment(dbPath, dbExists);

    // KERIpy parity: stamp version metadata on newly-created DBs and temp DBs.
    if (this.opened && !readonly && (!dbExists || this.temp)) {
      this.setVer(DEFAULT_DB_VERSION);
    }
    return this.opened;
  }

  /**
   * Open a resolved existing environment without path creation or version writes.
   * All subsequent named-table bindings refuse creation, including writable ones.
   */
  *openExisting(path: string): Operation<void> {
    if (this.root || this.closing || this.temp) {
      throw new DatabaseOperationError("Existing-store opening requires a closed, persistent LMDBer");
    }
    const data = yield* this.pathManager.statFileOp(`${path}/data.mdb`);
    if (!data.isFile) {
      throw new DatabaseOperationError(`Existing database not found at ${path}`);
    }
    this.existingOnly = true;
    this.openEnvironment(path, true);
    this.pathManager.path = path;
    this.pathManager.opened = true;
  }

  /** Open the native environment with the shared binary and map-size contract. */
  private openEnvironment(dbPath: string, dbExists: boolean): void {
    // Prefer the configured option, then env, then default.
    // When data.mdb already exists, raise to at least the stored map size so
    // KERIpy databases opened with KERI_BASER_MAP_SIZE=10GiB (etc.) do not abort
    // under an undersized lmdb-js virtual mapping.
    const dataMdbPath = dbExists ? `${dbPath}/data.mdb` : null;
    const effectiveMapSize = resolveLmdbMapSize({
      optionMapSize: this.configuredMapSize,
      envMapSize: Deno.env.get("KERI_LMDB_MAP_SIZE"),
      baserEnvMapSize: Deno.env.get("KERI_BASER_MAP_SIZE"),
      defaultMapSize: this.defaults.mapSize,
      dataMdbPath,
      databaseExists: dbExists,
    });
    const dbConfig = {
      path: dbPath, // Use directory path (Node.js lmdb should handle this)
      noSubdir: false, // A dotted directory name must not select LMDB's single-file layout.
      maxDbs: this.defaults.maxNamedDBs,
      mapSize: effectiveMapSize,
      readOnly: this.readonly,
      compression: false, // Disable compression for compatibility
      encoding: "binary" as const, // to mimic KERIpy behavior
      keyEncoding: "binary" as const, // to mimic KERIpy behavior
    };
    this.logger.debug(
      `Opening LMDB at: ${dbPath} (readonly: ${this.readonly}, mapSize: ${effectiveMapSize})`,
    );

    // Open LMDB environment
    // LMDB's open() will create data.mdb and lock.mdb if they don't exist
    try {
      // do sync because wrapping synchronous native operations in action() can cause
      // memory management issues with native bindings (double-free errors)
      this.root = open(dbConfig);
      this.logger.debug(`LMDB environment opened successfully`);
    } catch (error) {
      this.root = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to open LMDB environment: ${message}`,
        { cause: error },
      );
    }

    // KERIpy passes its directory permissions to `lmdb.open`, which strips execute bits.
    if (!dbExists && Deno.build.os !== "windows") {
      for (const file of ["data.mdb", "lock.mdb"]) Deno.chmodSync(`${dbPath}/${file}`, this.pathManager.perm & ~0o111);
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
   * Close the environment before path cleanup. Observable binding failures
   * propagate and permanently prevent this wrapper from reusing or deleting it.
   * Repeated closure of a known-closed environment is harmless.
   */
  *close(clear = false): Operation<boolean> {
    if (clear && this.existingOnly) {
      throw new DatabaseOperationError("Existing-store maintenance cannot clear its environment");
    }
    yield* this.closeEnv();
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
      this.writing(env).transactionSync(() => {
        env.putSync(b("__version__"), b(val));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to set database version: ${message}`,
        { cause: error },
      );
    }
  }

  /**
   * TypeScript-only convenience for opening a named sub-database.
   *
   * All sub-databases use binary key/value encoding; `dupsort=true` enables
   * native LMDB duplicate values for `Dup*` / `IoDup*` families.
   */
  openDB(name: string, dupsort = false): LmdbTable {
    const env = this.requireEnv();
    // lmdb-js 3.5.3 supports create:false in open.js even though its public
    // DatabaseOptions declaration omits it. Keep that native detail here.
    const options = {
      keyEncoding: "binary",
      encoding: "binary", // Use binary encoding for values (raw bytes) to match KERIpy
      dupSort: dupsort,
      create: !this.existingOnly,
    } as const;
    const table = env.openDB<BinVal, BinKey>(name, options);
    // The native API returns undefined for an absent non-creating binding,
    // despite declaring a non-null result. Maintenance must reject it; ordinary
    // readonly Baser bindings already tolerate tables absent from Python layouts.
    if (this.existingOnly && !table) throw new DatabaseOperationError(`Database not found: ${name}`);
    return table as LmdbTable;
  }

  /** Bind a named table through the backend-neutral contract. */
  openTable(name: string, options: { dupsort?: boolean } = {}): Table {
    return this.openDB(name, options.dupsort ?? false);
  }

  /** Run `fn` in one native synchronous write transaction; nesting is a child transaction. */
  transaction<T>(fn: () => T): T {
    return this.writing(this.requireEnv()).transactionSync(fn);
  }

  /**
   * Yield caller-owned copies of native rows; closing the iterator closes the cursor.
   *
   * Scan bounds are unvalidated (ADR-0015), including an `end` over the key limit.
   */
  *scan(table: Table, options: ScanOptions = {}): Generator<TableEntry> {
    this.requireEnv();
    const { range, end, long } = nativeRange(options);
    for (const entry of lmdbTable(table).getRange(range)) {
      const key = copyDbBytes(entry.key);
      if (long && pastEnd(key, end!, options.reverse)) return;
      yield { key, value: copyDbBytes(entry.value) };
    }
  }

  /** Write attempts made through this handle; a process-local counter, so reading it touches no store. */
  private commits = 0;

  /** Count one write attempt through this handle and return the environment to write through. */
  private writing(env: ReturnType<LMDBer["requireEnv"]>): ReturnType<LMDBer["requireEnv"]> {
    this.commits++;
    return env;
  }

  /** Counts this handle's own writes without reading the store; other processes' commits are not seen. */
  get writeActivity(): number {
    return this.commits;
  }

  /** LMDB's committed transaction ID, which also counts other processes' commits. */
  get writeVersion(): number {
    const version = (this.requireEnv().getStats() as { lastTxnId?: number }).lastTxnId;
    if (!Number.isSafeInteger(version) || version! < 0) {
      throw new DatabaseOperationError("Invalid LMDB transaction ID");
    }
    return version!;
  }

  /** Join native flush completion, including when the waiter is halted. */
  *flushed(): Operation<void> {
    const root = this.requireEnv();
    const pending = Promise.resolve(root.flushed);
    yield* call(function*() {
      yield* ensure(() => call(() => pending));
      yield* call(() => pending);
    });
  }

  /** Release the shared read transaction so later reads see other commits. */
  refreshRead(): void {
    this.requireEnv().resetReadTxn();
  }

  /** Yield caller-owned key copies; native dupsort iteration already yields each key once. */
  *scanKeys(table: Table, options: ScanOptions = {}): Generator<Uint8Array> {
    this.requireEnv();
    const { range, end, long } = nativeRange(options);
    for (const native of lmdbTable(table).getKeys(range)) {
      const key = copyDbBytes(native);
      if (long && pastEnd(key, end!, options.reverse)) return;
      yield key;
    }
  }

  /** Named tables are root entries; native lmdb-js may keep its C-string terminator in the key. */
  hasTable(name: string): boolean {
    const root = this.requireEnv();
    return root.getBinary(b(name)) !== undefined
      || root.getBinary(b(`${name}\0`)) !== undefined;
  }

  /** Copy one duplicate through the pinned binary seek branch, closing its cursor before return. */
  seekVal(table: Table, key: Uint8Array, start?: Uint8Array): Uint8Array | null {
    this.requireEnv();
    const db = lmdbTable(table) as LmdbTable & { encoding: string; encoder?: object };
    if (db.encoding !== "binary") throw new DatabaseOperationError("Duplicate seek requires binary rows");
    if (isAbsentKey(key)) return null;
    // lmdb-js refuses a start over the key limit; no stored value can reach one by seeking, so compare.
    if (start && start.length > MAX_KEY_BYTES) {
      for (const val of db.getValues(key)) {
        if (compareBytes(copyDbBytes(val), start) >= 0) return copyDbBytes(val);
      }
      return null;
    }
    // Pinned lmdb-js 3.5.3 dereferences encoder.writeKey before its binary-value seek branch.
    // This private read facade supplies that missing object without mutating the table.
    const seek = Object.create(db) as typeof db;
    seek.encoder = db.encoder ?? {};
    const rows = seek.getValues(key, { start, limit: 1 })[Symbol.iterator]();
    try {
      const row = rows.next();
      return row.done ? null : copyDbBytes(row.value);
    } finally {
      rows.return?.();
    }
  }

  protected assertOpen(): void {
    this.requireEnv();
  }

  protected putRow(table: Table, key: Uint8Array, val: Uint8Array): void {
    assertRowFits(table, key, val);
    this.commits++;
    lmdbTable(table).putSync(key, val);
  }

  protected removeRow(table: Table, key: Uint8Array, val?: Uint8Array): boolean {
    this.commits++;
    return val === undefined ? lmdbTable(table).removeSync(key) : lmdbTable(table).removeSync(key, val);
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
    table: Table,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    const db = lmdbTable(table);
    const env = this.requireEnv();

    try {
      const result = this.writing(env).transactionSync(() => {
        const existing = db.get(key);
        if (existing !== null && existing !== undefined) {
          return false;
        }
        assertRowFits(db, key, val);
        db.put(key, val);
        return true;
      });
      return result;
    } catch (error) {
      throw this.formatDbKeyError(error);
    }
  }

  /**
   * Write `val` at `key`, overwriting any existing value.
   *
   * Plain key/value upsert. Returns `true` on successful write. Mirrors KERIpy
   * `setVal`.
   */
  setVal(
    table: Table,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    const db = lmdbTable(table);
    const env = this.requireEnv();

    try {
      this.writing(env).transactionSync(() => {
        assertRowFits(db, key, val);
        db.put(key, val);
      });
      return true;
    } catch (error) {
      throw this.formatDbKeyError(error);
    }
  }

  /**
   * Fetch the value stored exactly at `key`.
   *
   * Plain key/value lookup. Returns `null` when the key is missing. Mirrors
   * KERIpy `getVal`.
   */
  getVal(table: Table, key: Uint8Array): Uint8Array | null {
    const db = lmdbTable(table);
    this.requireEnv();
    try {
      const val = db.get(key);
      if (val === null || val === undefined) {
        return null;
      } else {
        return copyDbBytes(val);
      }
    } catch (error) {
      throw this.formatDbKeyError(error);
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
    table: Table,
    key: Uint8Array,
    val?: Uint8Array,
  ): boolean {
    const db = lmdbTable(table);
    const env = this.requireEnv();

    try {
      const result = this.writing(env).transactionSync(() => {
        if (val !== undefined) {
          // An empty key must still fail, but an over-long one can only be absent.
          if (key.length > MAX_KEY_BYTES) return false;
          // An empty duplicate can never be stored, so it is always absent.
          if (val.length === 0 && (db as { dupSort?: boolean }).dupSort) return false;
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
      throw this.formatDbKeyError(error);
    }
  }

  /**
   * Count all physical entries in the sub-database.
   *
   * For dupsort DBs, duplicate values are included in the count because LMDB
   * stores them as separate entries. Mirrors KERIpy `cnt`.
   */
  cnt(table: Table): number {
    const db = lmdbTable(table);
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
    table: Table,
    top: Uint8Array = new Uint8Array(0),
  ): number {
    const db = lmdbTable(table);
    this.requireEnv();
    try {
      let count = 0;
      const startKey = top.length > 0 ? top : undefined;
      for (const entry of db.getRange(branchScanOptions(db, startKey))) {
        const keyBytes = copyDbBytes(entry.key);
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
        { cause: error },
      );
    }
  }

  /**
   * TypeScript-only convenience alias for `cnt(db)`.
   *
   * This counts the whole DB, including duplicate entries in dupsort DBs.
   */
  cntAll(table: Table): number {
    const db = lmdbTable(table);
    return this.cnt(db);
  }

  /**
   * Delete entries whose keys begin with prefix `top`.
   *
   * This is a lexicographic key-prefix delete, not a separate storage family.
   * Empty `top` deletes the whole DB. Mirrors KERIpy `delTopVal`.
   */
  delTop(
    table: Table,
    top: Uint8Array = new Uint8Array(0),
  ): boolean {
    const db = lmdbTable(table);
    const env = this.requireEnv();
    try {
      const keys: Uint8Array[] = [];
      const startKey = top.length > 0 ? top : undefined;
      for (const entry of db.getRange(branchScanOptions(db, startKey))) {
        const keyBytes = copyDbBytes(entry.key);
        if (top.length > 0 && !startsWith(keyBytes, top)) {
          break;
        }
        keys.push(new Uint8Array(keyBytes));
      }

      if (keys.length === 0) {
        return false;
      }

      this.writing(env).transactionSync(() => {
        for (const key of keys) {
          db.remove(key);
        }
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseOperationError(
        `Failed to delete database branch: ${message}`,
        { cause: error },
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
    table: Table,
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    const db = lmdbTable(table);
    this.requireEnv();
    try {
      // Use getRange with start position at top key
      // With binary encoding, keys and values are always Uint8Array
      const startKey = top.length > 0 ? top : undefined;

      for (const entry of db.getRange(branchScanOptions(db, startKey))) {
        const keyBytes = copyDbBytes(entry.key);
        const valBytes = copyDbBytes(entry.value);

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
        { cause: error },
      );
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
    table: Table,
    key: Uint8Array,
    vals: Iterable<Uint8Array>,
  ): boolean {
    const db = lmdbTable(table);
    let result = true;
    const existing = new Set<string>(
      this.getVals(db, key).map((val) => bytesHex(val)),
    );
    const env = this.requireEnv();
    this.writing(env).transactionSync(() => {
      for (const val of vals) {
        const vh = bytesHex(val);
        if (existing.has(vh)) {
          result = false;
          continue;
        }
        assertRowFits(db, key, val);
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
    table: Table,
    key: Uint8Array,
    val: Uint8Array,
  ): boolean {
    const db = lmdbTable(table);
    return this.putVals(db, key, [val]);
  }

  /**
   * Get duplicate values at `key` in lexicographic stored-value order.
   *
   * Returns an empty list when `key` is missing. Mirrors KERIpy `getVals`.
   */
  getVals(table: Table, key: Uint8Array): Uint8Array[] {
    const db = lmdbTable(table);
    this.requireEnv();
    if (isAbsentKey(key)) return [];
    return [...db.getValues(key)].map((val) => copyDbBytes(val));
  }

  /**
   * Get the lexicographically last duplicate value at `key`.
   *
   * "Last" here means LMDB dupsort order, not most-recent insertion. Returns
   * `null` when `key` is missing. Mirrors KERIpy `getValLast`.
   */
  getValLast(table: Table, key: Uint8Array): Uint8Array | null {
    const db = lmdbTable(table);
    const vals = this.getVals(db, key);
    return vals.length ? vals[vals.length - 1] : null;
  }

  /**
   * Iterate duplicate values at `key` in lexicographic stored-value order.
   *
   * Yields nothing when `key` is missing. Mirrors KERIpy `getValsIter`.
   */
  *getValsIter(
    table: Table,
    key: Uint8Array,
  ): Generator<Uint8Array> {
    const db = lmdbTable(table);
    this.requireEnv();
    if (isAbsentKey(key)) return;
    for (const val of db.getValues(key)) {
      yield copyDbBytes(val);
    }
  }

  /** Count native dupsort values at `key`. Mirrors KERIpy `cntVals`. */
  cntVals(table: Table, key: Uint8Array): number {
    const db = lmdbTable(table);
    this.requireEnv();
    return isAbsentKey(key) ? 0 : db.getValuesCount(key);
  }

  /** Delete all duplicate values at `key`. Mirrors KERIpy `delVals(key)`. */
  delVals(table: Table, key: Uint8Array): boolean {
    return this.delVal(table, key);
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
