/**
 * PathManager - File and directory path management
 *
 * Manages file directories and files for KERI installation resources like databases.
 * Uses composition pattern instead of inheritance.
 */

import { dirname, extname, isAbsolute, join, resolve } from "jsr:@std/path";
import { accessSync, constants } from "node:fs";
import { action, type Operation } from "npm:effection@^3.6.0";
import { InvalidPathNameError, PathError } from "../../core/errors.ts";
import { consoleLogger, type Logger } from "../../core/logger.ts";

function hasErrorCode(error: unknown, codes: string[]): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && codes.includes(code);
}

function isNotFoundLike(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound
    || hasErrorCode(error, ["ENOENT"]);
}

/** The temp root hio uses: `/tmp` on macOS, otherwise Python's `tempfile.gettempdir` order. */
function tempHeadDir(): string {
  if (Deno.build.os === "darwin") return "/tmp";
  return Deno.env.get("TMPDIR") || Deno.env.get("TEMP") || Deno.env.get("TMP") || "/tmp";
}

/** True when this process may read and write `path`, like `os.access(path, F_OK | R_OK | W_OK)`. */
function isAccessible(path: string): boolean {
  try {
    accessSync(path, constants.F_OK | constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Refuse an absolute name or base, which would escape the head directory. */
function assertRelative(value: string, label: string): void {
  if (isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
    throw new InvalidPathNameError(`Not relative ${label}=${value} path.`);
  }
}

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
  tempPrefix: "keri_lmdb_",
  tempSuffix: "_test",
  perm: 0o1700, // sticky + owner rwx
  mode: "r+",
  fext: "text",
};

/**
 * Filesystem path lifecycle manager for database/config resources.
 *
 * Responsibilities:
 * - derive persistent, clean, alternate-home, and temporary paths from one
 *   shared option/default contract
 * - create directories on demand and fall back from primary system paths to
 *   user-home alternates when the runtime lacks permission
 * - centralize path naming constraints so higher-level DB/config wrappers do
 *   not each reimplement filesystem policy
 *
 * Current `keri-ts` differences from hio `Filer`, which it otherwise follows:
 * - composition rather than inheritance, so stores own one instance
 * - a temp store uses one stable directory per name instead of a fresh
 *   `mkdtemp` per open, so its data survives a close and reopen; temp stores are
 *   never shared with KERIpy
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
  // the temporary directory holding `path`, when temp
  private tempRoot: string | null = null;

  constructor(
    options: PathManagerOptions = {},
    defaults?: Partial<PathManagerDefaults>,
  ) {
    this.defaults = { ...PATH_DEFAULTS, ...defaults };

    this._name = options.name ?? "main";
    this.base = options.base ?? "";
    assertRelative(this._name, "name");
    assertRelative(this.base, "base");
    this.temp = options.temp || false;
    this.headDirPath = options.headDirPath ?? this.defaults.headDirPath;
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
    assertRelative(value, "name");
    this._name = value;
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

  /**
   * Helper: Convert Promise-based file system operations to Effection operations
   * This ensures proper structured concurrency and cancellation support
   */
  /** True when `path` exists; any failure to stat means absent, like `os.path.exists`. */
  *statOp(path: string): Operation<boolean> {
    return yield* action((resolve) => {
      Deno.stat(path).then(() => resolve(true)).catch(() => resolve(false));
      return () => {};
    });
  }

  /** Create a directory and its parents with default permissions, like `os.makedirs`. */
  *mkdirOp(path: string): Operation<void> {
    yield* action<void>((resolve, reject) => {
      Deno.mkdir(path, { recursive: true }).then(() => resolve()).catch(reject);
      return () => {};
    });
  }

  *rmOp(path: string): Operation<void> {
    return yield* action((resolve, reject) => {
      Deno.remove(path, { recursive: true })
        .then(() => resolve(undefined))
        .catch((error) => {
          if (isNotFoundLike(error)) {
            resolve(undefined);
          } else {
            reject(error);
          }
        });
      return () => {};
    });
  }

  *statFileOp(
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
          if (isNotFoundLike(error)) {
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
   * Close, then open the path, mirroring hio `Filer.reopen`. An existing path
   * is kept only when `reuse` is set; otherwise the path is made again.
   */
  *reopen(options: Partial<PathManagerOptions> = {}): Operation<boolean> {
    yield* this.close(options.clear ?? false);
    this.temp = options.temp ?? this.temp;
    this.headDirPath = options.headDirPath ?? this.headDirPath;
    this.perm = options.perm ?? this.perm;
    this.mode = options.mode ?? this.mode;
    this.fext = options.fext ?? this.fext;

    if (!this.path || !options.reuse || !(yield* this.statOp(this.path))) {
      this.path = yield* this.remake(options.clean ?? false);
    }
    this.opened = true;
    return true;
  }

  /**
   * Choose and create the path, mirroring hio `Filer.remake`. `headDirPath` is
   * left alone on fallback, so each open retries the primary location first.
   */
  private *remake(clean: boolean): Operation<string> {
    const tail = clean ? this.defaults.cleanTailDirPath : this.defaults.tailDirPath;
    const name = this.fileName();

    if (this.temp) {
      this.tempRoot = join(tempHeadDir(), `${this.defaults.tempPrefix}${this.name}${this.defaults.tempSuffix}`);
      const path = this.filed || this.extensioned ? join(this.tempRoot, name) : this.tempRoot;
      yield* this.makePath(path);
      return path;
    }

    let path = resolve(this._pathExpandTilde(join(this.headDirPath, tail, this.base, name)));
    if (clean && (yield* this.statOp(path))) yield* this.rmOp(path);

    if (!(yield* this.statOp(path))) {
      try {
        yield* this.makePath(path);
      } catch (cause) {
        this.logger.debug(`Failed to create ${path}, falling back to alt path`);
        path = yield* this.makeAltPath(clean, name, cause);
      }
    } else if (!isAccessible(path)) {
      path = yield* this.makeAltPath(clean, name);
    }

    if (!this.extensioned && Deno.build.os !== "windows") Deno.chmodSync(path, this.perm);
    return path;
  }

  /** Name the path uses, with `fext` added to an extensionless file name. */
  private fileName(): string {
    return (this.filed || this.extensioned) && !extname(this.name) ? `${this.name}.${this.fext}` : this.name;
  }

  /** Create a directory path, or a file path's parents and the file when `filed`. */
  private *makePath(path: string): Operation<void> {
    if (!this.filed && !this.extensioned) {
      yield* this.mkdirOp(path);
      return;
    }
    yield* this.mkdirOp(dirname(path));
    if (this.filed) Deno.openSync(path, { read: true, write: true, create: true, mode: this.perm }).close();
  }

  /** Make the home-directory alternate, failing when it is unavailable too. */
  private *makeAltPath(clean: boolean, name: string, cause?: unknown): Operation<string> {
    const tail = clean ? this.defaults.altCleanTailDirPath : this.defaults.altTailDirPath;
    const path = resolve(this._pathExpandTilde(this.defaults.altHeadDirPath), tail, this.base, name);
    try {
      if (!(yield* this.statOp(path))) yield* this.makePath(path);
    } catch (error) {
      this.logger.error(`Alt path not available at ${path}`);
      throw new PathError(`Alt path not available at ${path}`, { cause: cause ?? error });
    }
    return path;
  }

  /**
   * Mark closed, removing the path when `clear` is set. The path is retained so
   * a later `reopen({ reuse: true })` finds it, as hio does.
   */
  *close(clear = false): Operation<boolean> {
    if (clear && this.path) {
      yield* this.rmOp(this.path);
      if (this.tempRoot) yield* this.rmOp(this.tempRoot);
      this.tempRoot = null;
    }
    this.opened = false;
    return true;
  }
}
