import { type Operation } from "npm:effection@^3.6.0";
import { basename, dirname, join } from "jsr:@std/path";
import { ValidationError } from "../core/errors.ts";
import { PathManager, type PathManagerOptions } from "../db/core/path-manager.ts";

interface ConfigerDefaults {
  tailDirPath: string;
  cleanTailDirPath: string;
  altTailDirPath: string;
  altCleanTailDirPath: string;
  tempPrefix: string;
  fext: string;
}

const CONFIGER_DEFAULTS: ConfigerDefaults = {
  tailDirPath: "keri/cf",
  cleanTailDirPath: "keri/clean/cf",
  altTailDirPath: ".tufa/cf",
  altCleanTailDirPath: ".tufa/clean/cf",
  tempPrefix: "keri_cf_",
  fext: "json",
};

export interface ConfigerOptions extends PathManagerOptions {
  /** File extension for the config file */
  fext?: string;
}

/**
 * Habitat Config File.
 *
 * This TypeScript implementation intentionally uses stateless file I/O for reads
 * and an atomic-write strategy for updates (temp file + sync + rename).
 * That differs from KERIpy's handle-oriented Configer, which keeps an open file
 * handle and uses seek/truncate/write/flush on that handle.
 *
 * We keep the public API simple (`get`/`put`) while hardening writes against
 * partial-file outcomes during unexpected process exits.
 *
 * Supports only JSON at the moment.
 */
export class Configer {
  readonly name: string;
  readonly base: string;
  readonly temp: boolean;
  readonly fext: string;
  readonly pathManager: PathManager;
  path: string | null = null;

  /** Create a config manager bound to a PathManager-backed directory. */
  constructor(options: ConfigerOptions = {}) {
    this.name = options.name || "conf";
    this.base = options.base || "";
    this.temp = options.temp || false;
    this.fext = options.fext || CONFIGER_DEFAULTS.fext;
    this.pathManager = new PathManager(
      {
        ...options,
        name: this.name,
        base: this.base,
        temp: this.temp,
      },
      {
        tailDirPath: CONFIGER_DEFAULTS.tailDirPath,
        cleanTailDirPath: CONFIGER_DEFAULTS.cleanTailDirPath,
        altTailDirPath: CONFIGER_DEFAULTS.altTailDirPath,
        altCleanTailDirPath: CONFIGER_DEFAULTS.altCleanTailDirPath,
        tempPrefix: CONFIGER_DEFAULTS.tempPrefix,
      },
    );
  }

  get opened(): boolean {
    return this.path !== null;
  }

  /** Resolve and validate the config filename and extension. */
  private resolvedFileName(): string {
    if (this.name.endsWith(`.${this.fext}`)) {
      return this.name;
    }
    const hasExt = this.name.includes(".");
    if (hasExt) {
      throw new ValidationError(
        `Unsupported config extension for '${this.name}'. Only .${this.fext} is supported.`,
      );
    }
    return `${this.name}.${this.fext}`;
  }

  private ensureOpenPath(): string {
    if (!this.path) {
      throw new ValidationError("Config file is not opened");
    }
    return this.path;
  }

  /** Flush parent directory metadata when the platform supports it. */
  private syncDirBestEffort(dirPath: string): void {
    try {
      const dir = Deno.openSync(dirPath, { read: true });
      try {
        dir.syncSync();
      } finally {
        dir.close();
      }
    } catch {
      // Best effort: some platforms/filesystems may not allow directory sync.
    }
  }

  /** Rename temp file into place with a Windows compatibility fallback. */
  private renameIntoPlace(tempPath: string, path: string): void {
    try {
      Deno.renameSync(tempPath, path);
      return;
    } catch (error) {
      if (Deno.build.os !== "windows") {
        throw error;
      }

      // On Windows, rename may fail when target already exists.
      if (
        !(error instanceof Deno.errors.AlreadyExists) &&
        !(error instanceof Deno.errors.PermissionDenied)
      ) {
        throw error;
      }

      // Best-effort replacement fallback for Windows. This is not fully atomic,
      // but keeps behavior consistent across platforms when overwrite-on-rename is blocked.
      try {
        Deno.removeSync(path);
      } catch (removeError) {
        if (!(removeError instanceof Deno.errors.NotFound)) {
          throw removeError;
        }
      }
      Deno.renameSync(tempPath, path);
    }
  }

  /**
   * Atomically persist config content using temp-file + sync + rename.
   *
   * Why this shape:
   * - writing directly to the target can leave a truncated/partial file on crash
   * - rename gives us an atomic switch from old file to new file
   * - syncing the parent directory makes the rename metadata more durable
   *   if a crash happens immediately after rename returns
   */
  private writeAtomic(path: string, content: string): void {
    const dirPath = dirname(path);
    const baseName = basename(path);
    const tempPath = join(dirPath, `.${baseName}.tmp-${crypto.randomUUID()}`);
    const encoder = new TextEncoder();
    let written = false;

    try {
      const tempFile = Deno.openSync(tempPath, {
        write: true,
        create: true,
        truncate: true,
        mode: 0o600,
      });
      try {
        tempFile.writeSync(encoder.encode(content));
        tempFile.syncSync();
      } finally {
        tempFile.close();
      }

      this.renameIntoPlace(tempPath, path);
      written = true;
      this.syncDirBestEffort(dirPath);
    } finally {
      if (!written) {
        try {
          Deno.removeSync(tempPath);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
          }
        }
      }
    }
  }

  /** Open or create the config file in the resolved Configer directory. */
  *reopen(options: Partial<ConfigerOptions> = {}): Operation<boolean> {
    const opened = yield* this.pathManager.reopen({
      ...options,
      name: this.name,
      base: this.base,
      temp: this.temp,
    });
    if (!opened || !this.pathManager.path) {
      return false;
    }

    const fileName = this.resolvedFileName();
    this.path = join(this.pathManager.path, fileName);

    try {
      Deno.statSync(this.path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        this.writeAtomic(this.path, "{}\n");
      } else {
        throw error;
      }
    }

    return true;
  }

  /** Close the config manager and optionally remove files. */
  *close(clear = false): Operation<boolean> {
    if (clear && this.path) {
      try {
        Deno.removeSync(this.path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
    }
    this.path = null;
    yield* this.pathManager.close(clear);
    return true;
  }

  /** Read and parse JSON config from disk. */
  get<T extends Record<string, unknown> = Record<string, unknown>>(): T {
    const path = this.ensureOpenPath();
    const raw = Deno.readTextFileSync(path).trim();
    if (!raw) {
      return {} as T;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new ValidationError(
        `Invalid JSON configuration at ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Serialize and persist JSON config to disk. */
  put(data: Record<string, unknown>): boolean {
    const path = this.ensureOpenPath();
    this.writeAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
    return true;
  }
}

export function* createConfiger(
  options: ConfigerOptions = {},
): Operation<Configer> {
  const configer = new Configer(options);
  const opened = yield* configer.reopen(options);
  if (!opened) {
    throw new ValidationError("Failed to open config file");
  }
  return configer;
}
