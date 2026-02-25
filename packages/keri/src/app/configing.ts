import { type Operation } from "npm:effection@^3.6.0";
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
 * Supports only JSON at the moment.
 *
 * Future versions will support HJSON, MGPK, and CBOR.
 */
export class Configer {
  readonly name: string;
  readonly base: string;
  readonly temp: boolean;
  readonly fext: string;
  readonly pathManager: PathManager;
  path: string | null = null;

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
    this.path = `${this.pathManager.path}/${fileName}`;

    try {
      Deno.statSync(this.path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        Deno.writeTextFileSync(this.path, "{}\n");
      } else {
        throw error;
      }
    }

    return true;
  }

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

  put(data: Record<string, unknown>): boolean {
    const path = this.ensureOpenPath();
    Deno.writeTextFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
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
