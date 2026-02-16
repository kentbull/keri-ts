/**
 * PathManager - File and directory path management
 *
 * Manages file directories and files for KERI installation resources like databases.
 * Uses composition pattern instead of inheritance.
 */

import { action, type Operation } from "npm:effection@^3.6.0";
import { InvalidPathNameError, PathError } from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";

export interface PathManagerOptions {
  name?: string;
  base?: string;
  temp?: boolean;
  headDirPath?: string;
  perm?: number;
  reopen?: boolean;
  clear?: boolean;
  reuse?: boolean;
  clean?: boolean;
  filed?: boolean;
  extensioned?: boolean;
  mode?: string;
  fext?: string;
  logger?: Logger;
}

export interface PathManagerDefaults {
  headDirPath: string;
  tailDirPath: string;
  cleanTailDirPath: string;
  altHeadDirPath: string;
  altTailDirPath: string;
  altCleanTailDirPath: string;
  tempHeadDir: string;
  tempPrefix: string;
  tempSuffix: string;
  perm: number;
  mode: string;
  fext: string;
}

export const PATH_DEFAULTS: PathManagerDefaults = {
  headDirPath: "/usr/local/var",
  tailDirPath: "keri/db",
  cleanTailDirPath: "keri/clean/db",
  altHeadDirPath: "~",
  altTailDirPath: ".keri/db",
  altCleanTailDirPath: ".keri/clean/db",
  tempHeadDir: "/tmp",
  tempPrefix: "keri_lmdb_",
  tempSuffix: "_test",
  perm: 0o1700, // sticky + owner rwx
  mode: "r+",
  fext: "text",
};

/**
 * PathManager manages file and directory paths
 */
export class PathManager {
  // name of the path, dir or file name
  private _name: string;
  // base directory path
  public base: string;
  // temporary directory flag
  public temp: boolean;
  // head directory path
  public headDirPath: string;
  // path to the directory or file
  public path: string | null;
  public perm: number;
  public filed: boolean;
  public extensioned: boolean;
  public mode: string;
  public fext: string;
  public opened: boolean;
  private defaults: PathManagerDefaults;
  private readonly logger: Logger;

  constructor(
    options: PathManagerOptions = {},
    defaults?: Partial<PathManagerDefaults>,
  ) {
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
    if (value.startsWith("/") || value.includes(":")) {
      throw new InvalidPathNameError(
        `Not relative name=${value} path.`,
        { name: value },
      );
    }
    this._name = value;
  }

  _getTempPath(): string {
    const tempDir = Deno.env.get("TMPDIR") || Deno.env.get("TMP") ||
      Deno.env.get("TEMP") || "/tmp";
    const tempName =
      `${this.defaults.tempPrefix}${this.name}${this.defaults.tempSuffix}`;
    return `${tempDir}/${tempName}`;
  }

  _pathExpandTilde(path: string): string {
    if (path === "~" || path.startsWith("~/")) {
      const home = Deno.env.get("HOME") || "~";
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

    const parts = [head, tail];
    if (this.base) parts.push(this.base);
    parts.push(this.name);

    const path = parts.join("/");
    return path;
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

    const altParts = [head, tail];
    if (this.base) altParts.push(this.base);
    altParts.push(this.name);
    const path = altParts.join("/");
    return path;
  }

  /*
   * Creates a file path based on head, tail, base, and name. Ensure path is created and optionally reuse it.
   * @param options path creation options
   * @returns File path to a persistent file or directory
   */
  _getPersistentPaths(
    options: Partial<PathManagerOptions> = {},
  ): [string, string] {
    const headDirPath = options.headDirPath ?? this.headDirPath;
    const clean = options.clean || false;

    const primary = this._getPrimaryPath(headDirPath, clean);
    const alt = this._getAltPath(clean);
    return [primary, alt];
  }

  _getPaths(
    options: Partial<PathManagerOptions> = {},
  ): [string, string, string] {
    const [primary, alt] = this._getPersistentPaths(options);
    const tempPath = this._getTempPath();
    return [primary, alt, tempPath];
  }

  /**
   * Helper: Convert Promise-based file system operations to Effection operations
   * This ensures proper structured concurrency and cancellation support
   */
  private *_statOp(path: string): Operation<boolean> {
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

  private *_accessOp(path: string): Operation<boolean> {
    return yield* action((resolve, reject) => {
      // In Deno, we check access by stating or trying to read/write.
      // Simplified to checking existence and relying on OS permissions for now
      Deno.stat(path)
        .then(() => resolve(true))
        .catch(() => resolve(false));
      return () => {};
    });
  }

  private *_mkdirOp(path: string, perm: number): Operation<boolean> {
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

  private *_rmOp(path: string): Operation<void> {
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

  private *_statFileOp(
    path: string,
  ): Operation<{ isDirectory: boolean; isFile: boolean }> {
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
   * Reopen/create the directory or file path
   * Replicates KERIpy/HIO Filer.remake logic:
   * - Tries primary path (/usr/local/var/keri/*) first
   * - Falls back to alt path (~/.keri/*) on OS errors or access issues
   *
   * Uses Effection for structured concurrency:
   * - All file system operations are cancellable
   * - No dangling promises - operations tracked in Effection task tree
   * - Automatic cleanup if parent operation is halted
   */
  *reopen(options: Partial<PathManagerOptions> = {}): Operation<boolean> {
    const temp = options.temp ?? this.temp;
    let headDirPath = options.headDirPath ?? this.headDirPath;
    const perm = options.perm ?? this.perm;
    const clear = options.clear || false;
    const reuse = options.reuse || false;
    const clean = options.clean || false;
    const mode = options.mode ?? this.mode;
    const fext = options.fext ?? this.fext;

    this.temp = temp;
    this.perm = perm;
    this.mode = mode;
    this.fext = fext;

    let path: string;
    const [primary, alt, tempPath] = this._getPaths({
      ...options,
      headDirPath,
      clean,
    });

    if (temp) {
      // Use temporary directory
      path = tempPath;
    } else {
      // Use persistent directory - try primary first, fall back to alt on error
      path = primary;
      let useAltPath = false;

      // Only attempt fallback if using default headDirPath (not a custom one)
      const usingDefaultHeadDir = headDirPath === this.defaults.headDirPath;

      if (!reuse && usingDefaultHeadDir) {
        // Check if path exists using Effection operation
        const pathExists = yield* this._statOp(path);

        if (!pathExists) {
          // Path doesn't exist, try to create it
          this.logger.info(`Creating directory at ${path}`);
          const created = yield* this._mkdirOp(path, perm);
          if (!created) {
            // Creation failed (e.g., EACCES) - fall back to alt path
            this.logger.warn(
              `Failed to create primary path, falling back to alt path`,
            );
            useAltPath = true;
            path = alt;
            headDirPath = this.defaults.altHeadDirPath;
          }
        }

        // If we're using alt path, ensure it exists
        if (useAltPath) {
          const altPathExists = yield* this._statOp(path);
          if (!altPathExists) {
            // Alt path doesn't exist, create it
            this.logger.info(`Creating alt directory at ${path}`);
            const created = yield* this._mkdirOp(path, perm);
            if (!created) {
              // Even alt path creation failed - this is unexpected, but we'll continue
              this.logger.error(`Failed to create alt directory at ${path}`);
              throw new PathError(
                `Failed to create alt directory at ${path}`,
                { path },
              );
            }
          } else {
            // Path exists, verify access
            const altHasAccess = yield* this._accessOp(path);
            if (!altHasAccess) {
              // Path exists but no access - this shouldn't happen for alt path, but log it
              this.logger.error(
                `Alt path exists but is not accessible: ${path}`,
              );
              throw new PathError(
                `Alt path exists but is not accessible: ${path}`,
                { path },
              );
            }
          }
        }
      } else if (reuse) {
        // Reuse mode - just verify the path exists and is accessible
        const pathExists = yield* this._statOp(path);
        const hasAccess = pathExists ? yield* this._accessOp(path) : false;

        if (!pathExists || !hasAccess) {
          // If reuse path doesn't work and we're using default, try alt
          if (usingDefaultHeadDir) {
            this.logger.info(`Reuse path not accessible, trying alt path`);
            path = alt;
            headDirPath = this.defaults.altHeadDirPath;
            const altPathExists = yield* this._statOp(path);
            const altHasAccess = altPathExists
              ? yield* this._accessOp(path)
              : false;

            if (!altPathExists) {
              // Alt path doesn't exist, create it
              this.logger.info(`Creating alt directory at ${path}`);
              const created = yield* this._mkdirOp(path, perm);
              if (!created) {
                this.logger.warn(
                  `Warning: Failed to create alt directory at ${path}`,
                );
              }
            } else if (!altHasAccess) {
              // Alt path exists but not accessible - unexpected but continue
              this.logger.warn(
                `Warning: Alt path exists but is not accessible: ${path}`,
              );
            }
          }
        }
      }
    }

    // Update headDirPath if we fell back to alt
    this.headDirPath = headDirPath;

    // Clear if requested
    if (clear) {
      const pathStat = yield* this._statFileOp(path);
      if (pathStat && (pathStat.isDirectory || pathStat.isFile)) {
        yield* this._rmOp(path);
      }
    }

    // Create directory if it doesn't exist (final check)
    if (!this.filed) {
      const pathExists = yield* this._statOp(path);
      if (!pathExists) {
        // Path doesn't exist, create it
        this.logger.info(`Creating directory at ${path}`);
        const created = yield* this._mkdirOp(path, perm);
        if (!created) {
          // Creation failed - this is unexpected at this point, but log it
          this.logger.warn(`Warning: Failed to create directory at ${path}`);
        }
      } else {
        // Path exists, verify we can access it
        const hasAccess = yield* this._accessOp(path);
        if (!hasAccess) {
          // Path exists but not accessible - unexpected but continue
          this.logger.warn(
            `Warning: Path exists but is not accessible: ${path}`,
          );
        }
      }
    }

    this.path = path;
    this.opened = true;
    return this.opened;
  }

  /**
   * Close the path manager
   * If clear is true, removes the directory/file
   * Uses Effection for structured concurrency
   */
  *close(clear = false): Operation<boolean> {
    if (clear && this.path) {
      yield* this._rmOp(this.path);
    }
    this.path = null;
    this.opened = false;
    return true;
  }

  /**
   * Check if database files exist in the path directory
   * LMDB creates data.mdb and lock.mdb files
   * Returns true if data.mdb exists (lock.mdb might not exist if no active transactions)
   * Uses Effection for structured concurrency
   */
  *databaseFilesExist(): Operation<boolean> {
    if (!this.path) {
      return false;
    }

    const dataMdbPath = `${this.path}/data.mdb`;
    const pathStat = yield* this._statFileOp(dataMdbPath);
    return pathStat.isFile ?? false;
  }
}
