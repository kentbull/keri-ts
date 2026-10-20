/** Existing pending-OOBI storage, independent of Habery and protocol startup. */
import { type Operation, resource } from "effection";
import { ValidationError } from "../core/errors.ts";
import { OobiRecord } from "../core/records.ts";
import { baserDefaults } from "./baser-defaults.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { PathManager } from "./core/path-manager.ts";
import { Komer } from "./koming.ts";

/** Exact existing-store selection and native opening options; no startup policy. */
export interface OpenOobiStoreOptions extends Pick<LMDBerOptions, "headDirPath" | "base" | "mapSize" | "logger"> {
  name: string;
  compat?: boolean;
  /** Defaults to true for inspection; false permits explicit pending-row removal. */
  readonly?: boolean;
}

/** Scoped access to existing pending rows only; keys are never URL-normalized. */
export interface OobiStore {
  readonly path: string;
  get(key: string): OobiRecord | null;
  rem(key: string): boolean;
}

/**
 * Lend one existing typed `oobis.` table until the calling Effection scope ends.
 * Refuse missing/ambiguous targets and tables. No directories, schema/version
 * markers, other tables, key stores or payload archives are initialized.
 */
export function* openOobiStore(options: OpenOobiStoreOptions): Operation<OobiStore> {
  if (options.name.trim().length === 0) throw new ValidationError("An existing database name is required");
  const defaults = baserDefaults(options.compat);
  const paths = new PathManager(options, defaults);
  paths.name = options.name;
  const path = yield* paths.existingDirectoryPath(options.headDirPath);
  return yield* resource<OobiStore>(function*(provide) {
    const db = new LMDBer({ ...options, readonly: options.readonly ?? true }, defaults);
    yield* db.openExisting(path);
    try {
      const oobis = new Komer(db, { subkey: "oobis.", recordClass: OobiRecord });
      yield* provide({
        path,
        get: (key) => oobis.get(key),
        rem: (key) => oobis.rem(key),
      });
    } finally {
      yield* db.close();
    }
  });
}
