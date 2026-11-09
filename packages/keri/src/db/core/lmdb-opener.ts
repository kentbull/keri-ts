/** LMDB placement of store families, reproducing each family's established paths. */

import type { StoreIdentity } from "./dber.ts";
import { LMDBer, type LMDBerDefaults, type LmdbLocation } from "./lmdber.ts";
import type { StoreFamily, StoreOpener } from "./store-owner.ts";

/** Derive the LMDB path defaults for one family. */
export function lmdbDefaultsFor(family: StoreFamily, compat = false): Partial<LMDBerDefaults> {
  const altRoot = compat && !family.noCompat ? ".keri" : ".tufa";
  return {
    tailDirPath: `keri/${family.tail}`,
    cleanTailDirPath: `keri/clean/${family.tail}`,
    altTailDirPath: `${altRoot}/${family.tail}`,
    altCleanTailDirPath: `${altRoot}/clean/${family.tail}`,
    tempPrefix: `keri_${family.tail.replaceAll("/", "_")}_`,
    ...(family.maxTables === undefined ? {} : { maxNamedDBs: family.maxTables }),
  };
}

/** Where one composition's LMDB stores live. */
export interface LmdbOpenerLocation extends Pick<LmdbLocation, "headDirPath" | "mapSize"> {
  compat?: boolean;
}

/** The default `StoreOpener`: closed LMDB stores at the family's established paths. */
export class LmdbStoreOpener implements StoreOpener {
  constructor(readonly location: LmdbOpenerLocation = {}) {}

  create(family: StoreFamily, identity: StoreIdentity): LMDBer {
    const { compat, ...place } = this.location;
    return new LMDBer({ ...identity, ...place }, lmdbDefaultsFor(family, compat));
  }
}
