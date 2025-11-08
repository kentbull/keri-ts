/**
 * PathManager - File and directory path management
 * 
 * Manages file directories and files for KERI installation resources like databases.
 * Uses composition pattern instead of inheritance.
 */

import { mkdir, stat, rm } from 'fs/promises';
import { platform } from 'os';

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

  constructor(options: PathManagerOptions = {}, defaults?: Partial<PathManagerDefaults>) {
    this.defaults = { ...PATH_DEFAULTS, ...defaults };
    // if OSX platform then default to ~
    if (platform() === "darwin") {
      // TODO remove this once we have a better way to handle OSX platform
      this.defaults.headDirPath = "~";
    }
    
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

    if (options.reopen !== false) {
      this.reopen({
        temp: options.temp,
        headDirPath: options.headDirPath,
        perm: options.perm,
        clear: options.clear,
        reuse: options.reuse,
        clean: options.clean,
        mode: options.mode,
        fext: options.fext,
      });
    }
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    // Check if path is absolute
    if (value.startsWith('/') || value.includes(':')) {
      throw new Error(`Not relative name=${value} path.`);
    }
    this._name = value;
  }

  _getTempPath(): string {
    const tempDir = process.env.TMPDIR 
      || process.env.TMP 
      || process.env.TEMP 
      || "/tmp";
    const tempName = `${this.defaults.tempPrefix}${this.name}${this.defaults.tempSuffix}`;
    return `${tempDir}/${tempName}`;
  }

  _getPrimaryPath(headDirPath: string,clean: boolean): string {
    // head / tail / base / name
    // Expand ~ to HOME directory
    let head = headDirPath;
    if (head === "~" || head.startsWith("~/")) {
      const home = process.env.HOME || "~";
      head = head === "~" ? home : head.replace("~", home);
    }
    
    let tail: string;

    if (clean) {
      tail = this.defaults.cleanTailDirPath;
    } else {
      tail = this.defaults.tailDirPath;
    }

    const parts = [head, tail];
    if (this.base) parts.push(this.base);
    parts.push(this.name);
    
    const path = parts.join('/');
    return path;
  }

  _getAltPath(clean: boolean): string {
    // HOME or ~ / tail / base / name
    const head = process.env.HOME || "~";
    let tail: string;

    if (clean) {
      tail = this.defaults.altCleanTailDirPath;
    } else {
      tail = this.defaults.altTailDirPath;
    }

    const altParts = [head, tail];
    if (this.base) altParts.push(this.base);
    altParts.push(this.name);
    const path = altParts.join('/');
    return path;
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
    return [primary, alt]
  }

  _getPaths(options: Partial<PathManagerOptions> = {}): [string, string, string] {    
    const [primary, alt] = this._getPersistentPaths(options);    
    const tempPath = this._getTempPath();
    return [primary, alt, tempPath];
  }

  /**
   * Reopen/create the directory or file path
   */
  async reopen(options: Partial<PathManagerOptions> = {}): Promise<boolean> {
    const temp = options.temp ?? this.temp;
    const headDirPath = options.headDirPath ?? this.headDirPath;
    const perm = options.perm ?? this.perm;
    const clear = options.clear || false;
    const reuse = options.reuse || false;
    const mode = options.mode ?? this.mode;
    const fext = options.fext ?? this.fext;

    this.temp = temp;
    this.headDirPath = headDirPath;
    this.perm = perm;
    this.mode = mode;
    this.fext = fext;

    let path: string;

    const [primary, alt, tempPath] = this._getPaths(options);
    path = primary;

    if (temp) {
      path = tempPath;
    } else {
      // Use persistent directory
      path = primary;

      // Create container directory if it doesn't exist or return HOME path (alt)
      if (!reuse && headDirPath === this.defaults.headDirPath) {
        try {
          console.log(`Creating container directory at ${path}`);
          // Check if we can write to primary path
          await mkdir(path, { recursive: true, mode: perm });
        } catch {
          // Fallback to alt path
          path = alt;
        }
      }    
    }

    // Clear if requested
    if (clear) {
      try {
        const pathStat = await stat(path);
        if (pathStat.isDirectory() || pathStat.isFile()) {
          await rm(path, { recursive: true });
        }
      } catch {
        // Path doesn't exist, that's fine
      }
    }

    // Create directory if it doesn't exist
    if (!this.filed) {
      try {
        console.log(`Creating directory at ${path}`);
        await mkdir(path, { recursive: true, mode: perm });
      } catch {
        // Directory might already exist, that's fine
      }
    }

    this.path = path;
    this.opened = true;
    return this.opened;
  }

  /**
   * Close the path manager
   * If clear is true, removes the directory/file
   */
  async close(clear = false): Promise<boolean> {
    if (clear && this.path) {
      try {
        await rm(this.path, { recursive: true });
      } catch {
        // Ignore errors if path doesn't exist
      }
    }
    this.path = null;
    this.opened = false;
    return true;
  }

  /**
   * Check if database files exist in the path directory
   * LMDB creates data.mdb and lock.mdb files
   * Returns true if data.mdb exists (lock.mdb might not exist if no active transactions)
   */
  async databaseFilesExist(): Promise<boolean> {
    if (!this.path) {
      return false;
    }

    const dataMdbPath = `${this.path}/data.mdb`;

    try {
      const pathStat = await stat(dataMdbPath);
      return pathStat.isFile();
    } catch {
      return false;
    }
  }
}

