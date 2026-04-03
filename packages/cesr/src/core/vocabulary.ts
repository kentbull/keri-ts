/** KERI security tiers for deterministic secret derivation. */
export const Tiers = Object.freeze(
  {
    low: "low",
    med: "med",
    high: "high",
  } as const,
);

/** Security-tier union aligned to KERIpy's `Tiers`. */
export type Tier = (typeof Tiers)[keyof typeof Tiers];

/** Return true when the value is one of the supported KERI security tiers. */
export function isTier(value: string): value is Tier {
  return Object.values(Tiers).includes(value as Tier);
}

/** KERI/ACDC message ilks mirrored from KERIpy's `kering.Ilks`. */
export const Ilks = Object.freeze(
  {
    icp: "icp",
    rot: "rot",
    ixn: "ixn",
    dip: "dip",
    drt: "drt",
    rct: "rct",
    qry: "qry",
    rpy: "rpy",
    xip: "xip",
    exn: "exn",
    pro: "pro",
    bar: "bar",
    vcp: "vcp",
    vrt: "vrt",
    iss: "iss",
    rev: "rev",
    bis: "bis",
    brv: "brv",
    rip: "rip",
    bup: "bup",
    upd: "upd",
    acm: "acm",
    act: "act",
    acg: "acg",
    ace: "ace",
    sch: "sch",
    att: "att",
    agg: "agg",
    edg: "edg",
    rul: "rul",
  } as const,
);

/** Message-type union aligned to KERIpy's `Ilks`. */
export type Ilk = (typeof Ilks)[keyof typeof Ilks];

/** Return true when the value is one of the known KERI/ACDC ilks. */
export function isIlk(value: string): value is Ilk {
  return Object.values(Ilks).includes(value as Ilk);
}
