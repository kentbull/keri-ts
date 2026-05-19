import {
  Ilks,
  type Kind,
  Kinds,
  MtrDex,
  Salter,
  type SealEvent,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
} from "../../../cesr/mod.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { ValidationError } from "./errors.ts";
import { query as coreQuery } from "./protocol-eventing.ts";
import { RegStateRecord, type RegStateRecordShape, VcStateRecord, type VcStateRecordShape } from "./records.ts";

function resolveVersion(version?: Versionage): Versionage {
  return version ?? Vrsn_1_0;
}

function ample(count: number): number {
  const n = Math.max(0, count);
  if (n === 0) {
    return 0;
  }
  const f1 = Math.max(1, Math.floor(Math.max(0, n - 1) / 3));
  const f2 = Math.max(1, Math.ceil(Math.max(0, n - 1) / 3));
  return Math.min(
    n,
    Math.ceil((n + f1 + 1) / 2),
    Math.ceil((n + f2 + 1) / 2),
  );
}

function cloneStrings(values?: readonly string[]): string[] {
  return [...(values ?? [])];
}

function cloneSealDict(seal?: SealEvent): Record<string, unknown> {
  if (!seal) {
    return {};
  }
  return {
    i: seal.i.qb64,
    s: seal.s.numh,
    d: seal.d.qb64,
  };
}

export function incept(
  pre: string,
  {
    toad,
    baks,
    nonce,
    cnfg,
    version,
    kind = Kinds.json,
  }: {
    toad?: number | string;
    baks?: string[];
    nonce?: string;
    cnfg?: string[];
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  const actualVersion = resolveVersion(version);
  const actualBaks = cloneStrings(baks);
  const actualCnfg = cloneStrings(cnfg);
  if (new Set(actualBaks).size !== actualBaks.length) {
    throw new ValidationError(`Invalid baks = ${actualBaks}, has duplicates.`);
  }
  const actualToad = typeof toad === "string"
    ? Number.parseInt(toad, 16)
    : toad ?? (actualBaks.length === 0 ? 0 : ample(actualBaks.length));
  if (actualBaks.length === 0 && actualToad !== 0) {
    throw new ValidationError(`Invalid toad = ${actualToad} for baks = ${actualBaks}`);
  }
  if (actualBaks.length > 0 && (actualToad < 1 || actualToad > actualBaks.length)) {
    throw new ValidationError(`Invalid toad = ${actualToad} for baks = ${actualBaks}`);
  }
  return new SerderKERI({
    sad: {
      t: Ilks.vcp,
      d: "",
      i: "",
      ii: pre,
      s: "0",
      c: actualCnfg,
      bt: actualToad.toString(16),
      b: actualBaks,
      n: nonce ?? new Salter({
        code: MtrDex.Salt_128,
        raw: crypto.getRandomValues(new Uint8Array(16)),
      }).qb64,
    },
    pvrsn: actualVersion,
    kind,
    makify: true,
  });
}

export function rotate(
  regk: string,
  dig: string,
  {
    sn = 1,
    toad,
    baks,
    cuts,
    adds,
    version,
    kind = Kinds.json,
  }: {
    sn?: number;
    toad?: number | string;
    baks?: string[];
    cuts?: string[];
    adds?: string[];
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  if (sn < 1) {
    throw new ValidationError(`Invalid sn = ${sn} for vrt.`);
  }
  const actualVersion = resolveVersion(version);
  const currentBaks = cloneStrings(baks);
  const cutsList = cloneStrings(cuts);
  const addsList = cloneStrings(adds);
  const bakset = new Set(currentBaks);
  if (bakset.size !== currentBaks.length) {
    throw new ValidationError(`Invalid baks = ${currentBaks}, has duplicates.`);
  }
  if (new Set(cutsList).size !== cutsList.length) {
    throw new ValidationError(`Invalid cuts = ${cutsList}, has duplicates.`);
  }
  if (new Set(addsList).size !== addsList.length) {
    throw new ValidationError(`Invalid adds = ${addsList}, has duplicates.`);
  }
  for (const cut of cutsList) {
    if (!bakset.has(cut)) {
      throw new ValidationError(`Invalid cuts = ${cutsList}, not all members in baks.`);
    }
  }
  for (const cut of cutsList) {
    if (addsList.includes(cut)) {
      throw new ValidationError(`Intersecting cuts = ${cutsList} and adds = ${addsList}.`);
    }
  }
  for (const add of addsList) {
    if (bakset.has(add)) {
      throw new ValidationError(`Intersecting baks = ${currentBaks} and adds = ${addsList}.`);
    }
  }
  const nextBaks = currentBaks.filter((bak) => !cutsList.includes(bak));
  nextBaks.push(...addsList);
  const actualToad = typeof toad === "string"
    ? Number.parseInt(toad, 16)
    : toad ?? (nextBaks.length === 0 ? 0 : ample(nextBaks.length));
  if (nextBaks.length === 0 && actualToad !== 0) {
    throw new ValidationError(`Invalid toad = ${actualToad} for resultant wits = ${nextBaks}`);
  }
  if (nextBaks.length > 0 && (actualToad < 1 || actualToad > nextBaks.length)) {
    throw new ValidationError(`Invalid toad = ${actualToad} for resultant wits = ${nextBaks}`);
  }
  return new SerderKERI({
    sad: {
      t: Ilks.vrt,
      d: "",
      i: regk,
      p: dig,
      s: sn.toString(16),
      bt: actualToad.toString(16),
      br: cutsList,
      ba: addsList,
    },
    pvrsn: actualVersion,
    kind,
    makify: true,
  });
}

export function issue(
  vcdig: string,
  regk: string,
  {
    dt,
    version,
    kind = Kinds.json,
  }: {
    dt?: string;
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.iss,
      d: "",
      i: vcdig,
      s: "0",
      ri: regk,
      dt: dt ?? makeNowIso8601(),
    },
    pvrsn: resolveVersion(version),
    kind,
    makify: true,
  });
}

export function revoke(
  vcdig: string,
  regk: string,
  dig: string,
  {
    dt,
    version,
    kind = Kinds.json,
  }: {
    dt?: string;
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.rev,
      d: "",
      i: vcdig,
      s: "1",
      ri: regk,
      p: dig,
      dt: dt ?? makeNowIso8601(),
    },
    pvrsn: resolveVersion(version),
    kind,
    makify: true,
  });
}

export function backerIssue(
  vcdig: string,
  regk: string,
  regsn: number,
  regd: string,
  {
    dt,
    version,
    kind = Kinds.json,
  }: {
    dt?: string;
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.bis,
      d: "",
      i: vcdig,
      ii: regk,
      s: "0",
      ra: {
        i: regk,
        s: regsn.toString(16),
        d: regd,
      },
      dt: dt ?? makeNowIso8601(),
    },
    pvrsn: resolveVersion(version),
    kind,
    makify: true,
  });
}

export function backerRevoke(
  vcdig: string,
  regk: string,
  regsn: number,
  regd: string,
  dig: string,
  {
    dt,
    version,
    kind = Kinds.json,
  }: {
    dt?: string;
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.brv,
      d: "",
      i: vcdig,
      s: "1",
      p: dig,
      ra: {
        i: regk,
        s: regsn.toString(16),
        d: regd,
      },
      dt: dt ?? makeNowIso8601(),
    },
    pvrsn: resolveVersion(version),
    kind,
    makify: true,
  });
}

export function state(
  pre: string,
  said: string,
  sn: number,
  ri: string,
  eilk: string,
  {
    dts,
    toad,
    wits,
    cnfg,
    version,
  }: {
    dts?: string;
    toad?: number;
    wits?: string[];
    cnfg?: string[];
    version?: Versionage;
  } = {},
): RegStateRecord {
  if (sn < 0) {
    throw new ValidationError(`Negative sn = ${sn} in key state.`);
  }
  if (!(new Set<string>([Ilks.vcp, Ilks.vrt])).has(eilk)) {
    throw new ValidationError(`Invalid event type et=${eilk} in key state.`);
  }
  const actualWits = cloneStrings(wits);
  if (new Set(actualWits).size !== actualWits.length) {
    throw new ValidationError(`Invalid wits = ${actualWits}, has duplicates.`);
  }
  const actualToad = toad ?? (actualWits.length === 0 ? 0 : Math.max(1, Math.ceil(actualWits.length / 2)));
  return new RegStateRecord(
    {
      vn: [resolveVersion(version).major, resolveVersion(version).minor],
      i: ri,
      s: sn.toString(16),
      d: said,
      ii: pre,
      dt: dts ?? makeNowIso8601(),
      et: eilk,
      bt: actualToad.toString(16),
      b: actualWits,
      c: cloneStrings(cnfg),
    } satisfies RegStateRecordShape,
  );
}

export function vcstate(
  vcpre: string,
  said: string,
  sn: number,
  ri: string,
  eilk: string,
  anchor: Record<string, unknown>,
  {
    ra,
    dts,
    version,
  }: {
    ra?: SealEvent;
    dts?: string;
    version?: Versionage;
  } = {},
): VcStateRecord {
  if (sn < 0) {
    throw new ValidationError(`Negative sn = ${sn} in key state.`);
  }
  if (!(new Set<string>([Ilks.iss, Ilks.bis, Ilks.rev, Ilks.brv])).has(eilk)) {
    throw new ValidationError(`Invalid event type et=${eilk} in key state.`);
  }
  const actualVersion = resolveVersion(version);
  return new VcStateRecord(
    {
      vn: [actualVersion.major, actualVersion.minor],
      i: vcpre,
      s: sn.toString(16),
      d: said,
      ri,
      ra: cloneSealDict(ra),
      a: { ...anchor },
      dt: dts ?? makeNowIso8601(),
      et: eilk,
    } satisfies VcStateRecordShape,
  );
}

export function query(
  regk: string,
  vcid: string,
  {
    route = "",
    replyRoute = "",
    dt,
    dta,
    dtb,
    stamp,
    version,
    kind = Kinds.json,
  }: {
    route?: string;
    replyRoute?: string;
    dt?: string;
    dta?: string;
    dtb?: string;
    stamp?: string;
    version?: Versionage;
    kind?: Kind;
  } = {},
): SerderKERI {
  const qry: Record<string, unknown> = { i: vcid, ri: regk };
  if (dt !== undefined) {
    qry.dt = dt;
  }
  if (dta !== undefined) {
    qry.dta = dta;
  }
  if (dtb !== undefined) {
    qry.dtb = dtb;
  }
  return coreQuery(route, qry, {
    replyRoute,
    stamp,
    version,
    kind,
  });
}
