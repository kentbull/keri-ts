/**
 * PathManager - File and directory path management
 *
 * Manages file directories and files for KERI installation resources like databases.
 * Uses composition pattern instead of inheritance.
 */

import { action, type Operation } from "npm:effection@^3.6.0";
import { isAbsolute, join } from "jsr:@std/path";
import { InvalidPathNameError, PathError } from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";

/**
 * Path manager for file and directory paths.
 * Example:
 *    /{headDirPath}/{tailDirPath}/{base}/{name}
 */
export interface PathManagerOptions {
  /** optional head directory path name */
  headDirPath?: string;
  /** optional directory path segment */
  base?: string;
  /** directory path name */
  name?: string;
  /** use temp dir cleaned on close- for testing */
  temp?: boolean;
  /** numeric os dir permissions for database directory and database files */
  perm?: number;
  /** reopen object referred to by path manager */
  reopen?: boolean;
  /** remove directory upon close */
  clear?: boolean;
  /** reuse object referred to by  path manager */
  reuse?: boolean;
  /** path uses clean tail variant */
  clean?: boolean;
  /** true means ensure path ends with extension, false means do not ensure path ends with extension */
  extensioned?: boolean;
  /** true means path ends in file, false means path ends in directory */
  filed?: boolean;
  /** file open mode if filed */
  mode?: string;
  /** file extension if filed */
  fext?: string;
  /** Logger instance for logging */
  logger?: Logger;
}

/**
 * Defaults interface for the path manager. See PathManager for example paths.
 */
export interface PathManagerDefaults {
  //                               EXAMPLE PATHS
  headDirPath: string; //          start of path: /{head}
  tailDirPath: string; //             after head: /{head}/{tail}
  cleanTailDirPath: string; //          alt tail: /{head}/{tail}/clean
  altHeadDirPath: string; // start or after home: /{altHead}/{altTail}/{base}/{name}
  altTailDirPath: string; //       after altHead: /{altHead}/{altTail}/{base}/{name}
  altCleanTailDirPath: string; //  after altHead: /{altHead}/{altTail}/clean/{base}/{name}
  tempPrefix: string; //       start of temp dir: /{tempPrefix}
  tempSuffix: string; //        after tempPrefix: /{tempPrefix}{tempSuffix}
  tempHeadDir: string; //       after tempSuffix: /{tempPrefix}{tempSuffix}{tempHead}
  perm: number; // numeric os dir permissions for database directory and database files
  mode: string; // file open mode if filed
  fext: string; // file extension if filed
}

/** Defaults for the path manager */
export const PATH_DEFAULTS: PathManagerDefaults = {
  headDirPath: "/usr/local/var",
  tailDirPath: "keri/db",
  cleanTailDirPath: "keri/clean/db",
  altHeadDirPath: "~",
  altTailDirPath: ".tufa/db",
  altCleanTailDirPath: ".tufa/clean/db",
  tempHeadDir: "/tmp",
  tempPrefix: "keri_lmdb_",
  tempSuffix: "_test",
  perm: 0o1700, // sticky + owner rwx
  mode: "r+",
  fext: "text",
};

/**
 * PathManager manages file and directory paths
 *
 * Main file paths:
 * - persistent path: /{head}/{tail}      /{base}/{name}
 * -      clean path: /{head}/{tail}/clean/{base}/{name}
 * -        alt path: /{altHead}/{altTail}/{base}/{name}
 * - HOME (alt) path:          ~/{altTail}/{base}/{name}
 *
 * Temp files:
 * -       temp path: /{tempPrefix}/{tempSuffix}{tempHead}
 *
 * The path manager will use the persistent path by default.
 * If the persistent path does not exist, the path manager will use the alt path.
 * If the alt path does not exist, the path manager will use the temp path.
 *
 * Temp files:
 *   If the temp path does not exist, the path manager will create it.
 *   If the temp path exists, the path manager will use it.
 *   If the temp path exists and is not a directory, the path manager will throw an error.
 *   If the temp path exists and is a directory, the path manager will use it.
 *   If the temp path exists and is a directory, the path manager will use it.
 */
export class PathManager {
  // head directory path
  public headDirPath: string;
  // base directory path
  public base: string;
  // name of the path, dir or file name
  private _name: string;
  // temporary directory flag
  public temp: boolean;
  // path to the directory or file
  public path: string | null;
  // numeric os dir permissions for database directory and database files
  public perm: number;
  // true means path ends in file, false means path ends in directory
  public filed: boolean;
  // true means ensure path ends with extension, false means do not ensure path ends with extension
  public extensioned: boolean;
  // file open mode if filed
  public mode: string;
  // file extension if filed
  public fext: string;
  // true means directory created and if filed then file is opened
  public opened: boolean;
  // defaults for the path manager
  private defaults: PathManagerDefaults;
  // logger instance for logging
  private readonly logger: Logger;

  constructor(options: PathManagerOptions = {}, defaults?: Partial<PathManagerDefaults>) {
    this.defaults = { ...PATH_DEFAULTS, ...defaults };

    this._name = options.name || "main";
    this.base = options.base || "";
    this.temp = options.temp || false;
    this.headDirPath = options.headDirPath || this.defaults.headDirPath;
    this.perm = options.perm ?? this.defaults.perm;
    this.path = null;
    this.filed = options.filed || false;
    this.extensioned = options.extensioned || false;
    this.mode = options.mode || this.defaults.mode;
    this.fext = options.fext || this.defaults.fext;
    this.opened = false;
    this.logger = options.logger ?? consoleLogger;

    // Note: Constructor cannot be async/generator, so reopen must be called explicitly
    // if options.reopen is true. This is handled by callers (e.g., LMDBer).
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    // Check if path is absolute
    if (isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
      throw new InvalidPathNameError(`Not relative name=${value} path.`, { name: value });
    }
    this._name = value;
  }

  _getTempPath(): string {
    const tempDir = Deno.env.get("TMPDIR") || Deno.env.get("TMP") || Deno.env.get("TEMP") || "/tmp";
    const tempName = `${this.defaults.tempPrefix}${this.name}${this.defaults.tempSuffix}`;
    return join(tempDir, tempName);
  }

  /** Resolve user home directory with a Windows-aware fallback chain. */
  _resolveHomeDir(): string {
    const home = Deno.env.get("HOME");
    if (home) {
      return home;
    }

    // Windows common environment variables
    const userProfile = Deno.env.get("USERPROFILE");
    if (userProfile) {
      return userProfile;
    }

    const homeDrive = Deno.env.get("HOMEDRIVE");
    const homePath = Deno.env.get("HOMEPATH");
    if (homeDrive && homePath) {
      return `${homeDrive}${homePath}`;
    }

    return "~";
  }

  _pathExpandTilde(path: string): string {
    if (path === "~" || /^~[\\/]/.test(path)) {
      const home = this._resolveHomeDir();
      return path === "~" ? home : path.replace("~", home);
    }
    return path;
  }

  _getPrimaryPath(headDirPath: string, clean: boolean): string {
    // head / tail / base / name
    // Expand ~ to HOME directory
    let head = headDirPath;
    head = this._pathExpandTilde(head);

    let tail: string;

    if (clean) {
      tail = this.defaults.cleanTailDirPath;
    } else {
      tail = this.defaults.tailDirPath;
    }

    return this.base
      ? join(head, tail, this.base, this.name)
      : join(head, tail, this.name);
  }

  _getAltPath(clean: boolean): string {
    // HOME or ~ / tail / base / name
    let head = Deno.env.get("HOME") || "~";
    head = this._pathExpandTilde(head);
    let tail: string;

    if (clean) {
      tail = this.defaults.altCleanTailDirPath;
    } else {
      tail = this.defaults.altTailDirPath;
    }

    return this.base
      ? join(head, tail, this.base, this.name)
      : join(head, tail, this.name);
  }

  /*
   * Creates a file path based on head, tail, base, and name. Ensure path is created and optionally reuse it.
   * @param options path creation options
   * @returns File path to a persistent file or directory
   */
  _getPersistentPaths(options: Partial<PathManagerOptions> = {}): [string, string] {
    const headDirPath = options.headDirPath ?? this.headDirPath;
    const clean = options.clean || false;

    const primary = this._getPrimaryPath(headDirPath, clean);
    const alt = this._getAltPath(clean);
    return [primary, alt];
  }

  _getPaths(options: Partial<PathManagerOptions> = {}): [string, string, string] {
    const [primary, alt] = this._getPersistentPaths(options);
    const tempPath = this._getTempPath();
    return [primary, alt, tempPath];
  }

  /**
   * Helper: Convert Promise-based file system operations to Effection operations
   * This ensures proper structured concurrency and cancellation support
   */
  *statOp(path: string): Operation<boolean> {
    return yield* action((resolve, reject) => {
      Deno.stat(path)
        .then(() => resolve(true))
        .catch((error) => {
          if (error instanceof Deno.errors.NotFound) {
            resolve(false);
          } else {
            reject(error);
          }
        });
      return () => {};
    });
  }

  *accessOp(path: string): Operation<boolean> {
    return yield* action((resolve, reject) => {
      // In Deno, we check access by stating or trying to read/write.
      // Simplified to checking existence and relying on OS permissions for now
      Deno.stat(path)
        .then(() => resolve(true))
        .catch(() => resolve(false));
      return () => {};
    });
  }

  *mkdirOp(path: string, perm: number): Operation<boolean> {
    return yield* action((resolve, reject) => {
      Deno.mkdir(path, { recursive: true, mode: perm })
        .then(() => resolve(true))
        .catch((error) => {
          if (error instanceof Deno.errors.PermissionDenied) {
            resolve(false);
          } else {
            reject(error);
          }
        });
      return () => {};
    });
  }

  *rmOp(path: string): Operation<void> {
    return yield* action((resolve, reject) => {
      Deno.remove(path, { recursive: true })
        .then(() => resolve(undefined))
        .catch((error) => {
          if (error instanceof Deno.errors.NotFound) {
            resolve(undefined);
          } else {
            reject(error);
          }
        });
      return () => {};
    });
  }

  *statFileOp(path: string): Operation<{ isDirectory: boolean; isFile: boolean }> {
    return yield* action((resolve, reject) => {
      Deno.stat(path)
        .then((stats) => {
          resolve({
            isDirectory: stats.isDirectory,
            isFile: stats.isFile,
          });
        })
        .catch((error) => {
          if (error instanceof Deno.errors.NotFound) {
            resolve({
              isDirectory: false,
              isFile: false,
            });
          } else {
            reject(error);
          }
        });
      return () => {};
    });
  }

  /**
   * Reopen/create the directory or file path.
   * Replicates KERIpy/HIO Filer.remake logic:
   * - Tries primary path (/usr/local/var/keri/*) first
   * - Falls back to alt path (~/.tufa/*) on OS errors or access issues
   *
   * Returns Effection Operation with true if path is created and accessible, false otherwise.
   */
  *reopen(options: Partial<PathManagerOptions> = {}): Operation<boolean> {
    this._applyOptions(options);

    const headDirPath = options.headDirPath ?? this.headDirPath;
    const clean = options.clean || false;
    const reuse = options.reuse || false;
    const clear = options.clear || false;

    const [primary, alt, tempPath] = this._getPaths({ ...options, headDirPath, clean });

    const resolved = yield* this._resolvePath({ primary, alt, tempPath, headDirPath, reuse });
    this.headDirPath = resolved.headDirPath;

    if (clear) {
      yield* this._clearPath(resolved.path);
    }

    if (!this.filed) {
      yield* this._ensureDirectoryExists(resolved.path);
    }

    this.path = resolved.path;
    this.opened = true;
    return this.opened;
  }

  /** Update instance fields from caller-provided options. */
  private _applyOptions(options: Partial<PathManagerOptions>): void {
    this.temp = options.temp ?? this.temp;
    this.perm = options.perm ?? this.perm;
    this.mode = options.mode ?? this.mode;
    this.fext = options.fext ?? this.fext;
  }

  /**
   * Select which concrete path to use: temp, primary with alt fallback,
   * reuse with alt fallback, or primary directly (custom headDirPath).
   */
  private *_resolvePath(params: {
    primary: string;
    alt: string;
    tempPath: string;
    headDirPath: string;
    reuse: boolean;
  }): Operation<{ path: string; headDirPath: string }> {
    if (this.temp) {
      return { path: params.tempPath, headDirPath: params.headDirPath };
    }

    if (params.reuse) {
      return yield* this._reuseOrFallback(params.primary, params.alt, params.headDirPath);
    }

    return yield* this._createOrFallback(params.primary, params.alt, params.headDirPath);
  }

  /**
   * Try to use or create the primary path. If creation fails (e.g. EACCES),
   * fall back to the alt path. Throws if alt path also fails.
   */
  private *_createOrFallback(
    primary: string,
    alt: string,
    headDirPath: string,
  ): Operation<{ path: string; headDirPath: string }> {
    const exists = yield* this.statOp(primary);
    if (exists) {
      return { path: primary, headDirPath };
    }

    this.logger.info(`Creating directory at ${primary}`);
    const created = yield* this.mkdirOp(primary, this.perm);
    if (created) {
      return { path: primary, headDirPath };
    }

    this.logger.warn(`Failed to create primary path, falling back to alt path`);
    const altReady = yield* this._ensurePathAccessible(alt);
    if (!altReady) {
      this.logger.error(`Alt path not available at ${alt}`);
      throw new PathError(`Alt path not available at ${alt}`, { path: alt });
    }
    return { path: alt, headDirPath: this.defaults.altHeadDirPath };
  }

  /**
   * Verify the primary path exists and is accessible for reuse.
   * If not accessible and using the default head dir, fall back to alt.
   */
  private *_reuseOrFallback(
    primary: string,
    alt: string,
    headDirPath: string,
  ): Operation<{ path: string; headDirPath: string }> {
    const exists = yield* this.statOp(primary);
    const accessible = exists ? yield* this.accessOp(primary) : false;

    if (exists && accessible) {
      return { path: primary, headDirPath };
    }

    this.logger.info(`Reuse path unavailable, attempting to (re)create primary path`);
    const primaryReady = yield* this._ensurePathAccessible(primary);
    if (primaryReady) {
      return { path: primary, headDirPath };
    }

    this.logger.info(`Primary path unavailable, trying alt path`);
    const altReady = yield* this._ensurePathAccessible(alt);
    if (!altReady) {
      this.logger.warn(`Alt path not available: ${alt}`);
    }
    return { path: alt, headDirPath: this.defaults.altHeadDirPath };
  }

  /**
   * Ensure a path exists and is accessible, creating it if necessary.
   * Returns true if the path is ready for use.
   */
  private *_ensurePathAccessible(path: string): Operation<boolean> {
    const exists = yield* this.statOp(path);
    if (!exists) {
      this.logger.info(`Creating directory at ${path}`);
      return yield* this.mkdirOp(path, this.perm);
    }
    return yield* this.accessOp(path);
  }

  /** Remove existing file or directory at path. */
  private *_clearPath(path: string): Operation<void> {
    const stat = yield* this.statFileOp(path);
    if (stat.isDirectory || stat.isFile) {
      yield* this.rmOp(path);
    }
  }

  /** Ensure the directory at path exists and is accessible, creating it if needed. */
  private *_ensureDirectoryExists(path: string): Operation<void> {
    const exists = yield* this.statOp(path);
    if (!exists) {
      this.logger.info(`Creating directory at ${path}`);
      const created = yield* this.mkdirOp(path, this.perm);
      if (!created) {
        this.logger.warn(`Failed to create directory at ${path}`);
      }
    } else {
      const accessible = yield* this.accessOp(path);
      if (!accessible) {
        this.logger.warn(`Path exists but is not accessible: ${path}`);
      }
    }
  }

  /**
   * Close the path manager
   * If clear is true, removes the directory/file
   * Uses Effection for structured concurrency
   */
  *close(clear = false): Operation<boolean> {
    if (clear && this.path) {
      yield* this.rmOp(this.path);
    }
    this.path = null;
    this.opened = false;
    return true;
  }
}
