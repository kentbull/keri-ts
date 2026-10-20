/** Shared Baser layout for full protocol storage and narrow maintenance owners. */
import type { LMDBerDefaults } from "./core/lmdber.ts";

/** Select Baser's persistent, alternate-home and temporary path conventions. */
export function baserDefaults(compat = false): Partial<LMDBerDefaults> {
  return {
    tailDirPath: "keri/db",
    cleanTailDirPath: "keri/clean/db",
    altTailDirPath: compat ? ".keri/db" : ".tufa/db",
    altCleanTailDirPath: compat ? ".keri/clean/db" : ".tufa/clean/db",
    tempPrefix: "keri_db_",
    maxNamedDBs: 128,
  };
}
