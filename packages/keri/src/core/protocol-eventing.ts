import {
  DigDex,
  DIGEST_CODES,
  Ilks,
  type Kind,
  Kinds,
  NonceDex,
  Noncer,
  parseMatter,
  PREFIX_CODES,
  SerderKERI,
  Tholder,
  type ThresholdSith,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../cesr/mod.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { ValidationError } from "./errors.ts";
import { KeyStateRecord, type KeyStateRecordShape, StateEERecord, type StateEERecordShape } from "./records.ts";
import { deriveRotatedWitnessSet, hasUniqueWitnesses } from "./witnesses.ts";

const MAX_INTIVE_THRESHOLD = 0xffff;

interface VersionOptions {
  version?: Versionage;
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
}

interface ResolvedVersionOptions {
  pvrsn: Versionage;
  gvrsn: Versionage | null;
  kind: Kind;
}

function resolveVersionOptions(
  options: VersionOptions | undefined,
  fallback = Vrsn_1_0,
): ResolvedVersionOptions {
  const pvrsn = options?.pvrsn ?? options?.version ?? fallback;
  return {
    pvrsn,
    gvrsn: options?.gvrsn ?? (pvrsn.major >= 2 ? Vrsn_2_0 : null),
    kind: options?.kind ?? Kinds.json,
  };
}

function defaultThreshold(count: number, min: number): string {
  return Math.max(min, Math.ceil(count / 2)).toString(16);
}

function ample(count: number, faults?: number, weak = true): number {
  const n = Math.max(0, count);
  if (faults === undefined) {
    const f1 = Math.max(1, Math.floor(Math.max(0, n - 1) / 3));
    const f2 = Math.max(1, Math.ceil(Math.max(0, n - 1) / 3));
    if (weak) {
      return Math.min(
        n,
        Math.ceil((n + f1 + 1) / 2),
        Math.ceil((n + f2 + 1) / 2),
      );
    }
    return Math.min(
      n,
      Math.max(0, n - f1, Math.ceil((n + f1 + 1) / 2)),
    );
  }

  const f = Math.max(0, faults);
  const m1 = Math.ceil((n + f + 1) / 2);
  const m2 = Math.max(0, n - f);
  if (m2 < m1 && n > 0) {
    throw new ValidationError(
      `Invalid faults ${faults} for witness count ${count}.`,
    );
  }
  return weak ? Math.min(n, m1, m2) : Math.min(n, Math.max(m1, m2));
}

function cloneDataList(data?: unknown[]): unknown[] {
  return [...(data ?? [])];
}

function cloneStringList(values?: readonly string[]): string[] {
  return [...(values ?? [])];
}

function coerceWholeNumber(
  value: number | string,
  label: string,
): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError(`Invalid ${label} ${value}.`);
    }
    return value;
  }
  if (!/^[0-9a-f]+$/i.test(value)) {
    throw new ValidationError(`Invalid ${label} ${value}.`);
  }
  return Number.parseInt(value, 16);
}

function validateThreshold(
  value: ThresholdSith | undefined,
  count: number,
  label: string,
  minimum: number,
): Tholder {
  const tholder = new Tholder({
    sith: value ?? defaultThreshold(count, minimum),
  });
  if (tholder.num !== null && tholder.num < BigInt(minimum)) {
    throw new ValidationError(`Invalid ${label} threshold ${String(value ?? "")}.`);
  }
  if (tholder.size > count) {
    throw new ValidationError(
      `Invalid ${label} threshold for ${count} keys.`,
    );
  }
  return tholder;
}

function encodeThreshold(
  tholder: Tholder,
  intive = false,
): ThresholdSith | number {
  if (
    intive
    && tholder.num !== null
    && tholder.num <= BigInt(MAX_INTIVE_THRESHOLD)
  ) {
    return Number(tholder.num);
  }
  return tholder.sith;
}

function encodeCount(
  value: number,
  intive = false,
): string | number {
  return intive && value <= MAX_INTIVE_THRESHOLD ? value : value.toString(16);
}

function resolveInceptiveSaidCodes(
  ked: Record<string, unknown>,
  explicitPrefixCode?: string,
): Record<string, string> {
  const saids: Record<string, string> = {
    d: DigDex.Blake3_256,
    i: DigDex.Blake3_256,
  };

  if (explicitPrefixCode && PREFIX_CODES.has(explicitPrefixCode)) {
    saids.i = explicitPrefixCode;
    return saids;
  }

  if (typeof ked.i === "string" && ked.i.length > 0) {
    try {
      saids.i = parseMatter(new TextEncoder().encode(ked.i), "txt").code;
    } catch {
      // Keep the default digest code when the provided prefix is not parseable.
    }
  }

  return saids;
}

export function state(
  pre: string,
  sn: number | string,
  pig: string,
  dig: string,
  fn: number | string,
  eilk: string,
  keys: string[],
  eevt: StateEERecord | StateEERecordShape,
  {
    stamp,
    sith,
    ndigs,
    nsith,
    toad,
    wits,
    cnfg,
    dpre,
    version,
    pvrsn,
    intive = false,
  }: {
    stamp?: string;
    sith?: ThresholdSith;
    ndigs?: string[];
    nsith?: ThresholdSith;
    toad?: number | string;
    wits?: string[];
    cnfg?: string[];
    dpre?: string;
    version?: Versionage;
    pvrsn?: Versionage;
    intive?: boolean;
  } = {},
): KeyStateRecord {
  const currentVersion = pvrsn ?? version ?? Vrsn_1_0;
  const snNum = coerceWholeNumber(sn, "sn");
  const fnNum = coerceWholeNumber(fn, "fn");
  if (!(new Set<string>([Ilks.icp, Ilks.rot, Ilks.ixn, Ilks.dip, Ilks.drt])).has(eilk)) {
    throw new ValidationError(`Invalid event type et=${eilk} in key state.`);
  }

  const actualStamp = stamp ?? makeNowIso8601();
  const currentTholder = validateThreshold(sith, keys.length, "current", 1);
  const nextDigs = cloneStringList(ndigs);
  const nextTholder = validateThreshold(
    nsith,
    nextDigs.length,
    "next",
    0,
  );
  const witnessList = cloneStringList(wits);
  if (!hasUniqueWitnesses(witnessList)) {
    throw new ValidationError(`Invalid wits = ${witnessList}, has duplicates.`);
  }
  const resolvedToad = toad === undefined
    ? (witnessList.length === 0 ? 0 : Math.max(1, Math.ceil(witnessList.length / 2)))
    : coerceWholeNumber(toad, "toad");
  if (witnessList.length === 0 && resolvedToad !== 0) {
    throw new ValidationError(`Invalid toad = ${resolvedToad} for wits = ${witnessList}.`);
  }
  if (
    witnessList.length > 0
    && (resolvedToad < 1 || resolvedToad > witnessList.length)
  ) {
    throw new ValidationError(`Invalid toad = ${resolvedToad} for wits = ${witnessList}.`);
  }

  const latestEst = StateEERecord.fromDict(eevt);
  if (!latestEst.s || !latestEst.d) {
    throw new ValidationError(`Missing or invalid latest est event = ${String(eevt)} for key state.`);
  }

  const cuts = cloneStringList(latestEst.br);
  const adds = cloneStringList(latestEst.ba);
  if (!hasUniqueWitnesses(cuts)) {
    throw new ValidationError(`Invalid cuts = ${cuts}, has duplicates.`);
  }
  if (!hasUniqueWitnesses(adds)) {
    throw new ValidationError(`Invalid adds = ${adds}, has duplicates.`);
  }
  if (cuts.some((cut) => adds.includes(cut))) {
    throw new ValidationError(`Intersecting cuts = ${cuts} and adds = ${adds}.`);
  }

  return new KeyStateRecord(
    {
      vn: [currentVersion.major, currentVersion.minor],
      i: pre,
      s: snNum.toString(16),
      p: pig,
      d: dig,
      f: fnNum.toString(16),
      dt: actualStamp,
      et: eilk,
      kt: encodeThreshold(currentTholder, intive) as ThresholdSith,
      k: [...keys],
      nt: encodeThreshold(nextTholder, intive) as ThresholdSith,
      n: nextDigs,
      bt: encodeCount(resolvedToad, intive).toString(),
      b: witnessList,
      c: cloneStringList(cnfg),
      ee: new StateEERecord({
        s: latestEst.s,
        d: latestEst.d,
        br: cuts,
        ba: adds,
      }),
      di: dpre ?? "",
    } satisfies KeyStateRecordShape,
  );
}

export function incept(
  keys: string[],
  {
    isith,
    ndigs,
    nsith,
    toad,
    wits,
    cnfg,
    data,
    code,
    delpre,
    intive = false,
    ...versions
  }: {
    isith?: ThresholdSith;
    ndigs?: string[];
    nsith?: ThresholdSith;
    toad?: number | string;
    wits?: string[];
    cnfg?: string[];
    data?: unknown[];
    code?: string;
    delpre?: string;
    intive?: boolean;
    version?: Versionage;
    pvrsn?: Versionage;
    gvrsn?: Versionage | null;
    kind?: Kind;
  } = {},
): SerderKERI {
  const resolved = resolveVersionOptions(versions);
  const nextDigs = cloneStringList(ndigs);
  const witnessList = cloneStringList(wits);
  if (!hasUniqueWitnesses(witnessList)) {
    throw new ValidationError(`Invalid wits = ${witnessList}, has duplicates.`);
  }
  const tholder = validateThreshold(isith, keys.length, "current", 1);
  const ntholder = validateThreshold(nsith, nextDigs.length, "next", 0);
  const resolvedToad = toad === undefined
    ? (witnessList.length === 0 ? 0 : ample(witnessList.length))
    : coerceWholeNumber(toad, "toad");
  if (witnessList.length === 0 && resolvedToad !== 0) {
    throw new ValidationError(`Invalid toad = ${resolvedToad} for wits = ${witnessList}`);
  }
  if (
    witnessList.length > 0
    && (resolvedToad < 1 || resolvedToad > witnessList.length)
  ) {
    throw new ValidationError(`Invalid toad = ${resolvedToad} for wits = ${witnessList}`);
  }

  const sad: Record<string, unknown> = {
    t: delpre ? Ilks.dip : Ilks.icp,
    d: "",
    i: "",
    s: "0",
    kt: encodeThreshold(tholder, intive),
    k: [...keys],
    nt: encodeThreshold(ntholder, intive),
    n: nextDigs,
    bt: encodeCount(resolvedToad, intive),
    b: witnessList,
    c: cloneStringList(cnfg),
    a: cloneDataList(data),
  };
  if (delpre) {
    sad.di = delpre;
  } else if ((!code || !DIGEST_CODES.has(code)) && keys.length === 1) {
    sad.i = keys[0];
  }

  return new SerderKERI({
    sad,
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
    saids: resolveInceptiveSaidCodes(sad, code),
  });
}

export function delcept(
  keys: string[],
  delpre: string,
  options: Omit<Parameters<typeof incept>[1], "delpre"> = {},
): SerderKERI {
  return incept(keys, { ...options, delpre });
}

export function rotate(
  pre: string,
  keys: string[],
  dig: string,
  {
    ilk = Ilks.rot,
    sn = 1,
    isith,
    ndigs,
    nsith,
    toad,
    wits,
    cuts,
    adds,
    cnfg,
    data,
    intive = false,
    ...versions
  }: {
    ilk?: string;
    sn?: number | string;
    isith?: ThresholdSith;
    ndigs?: string[];
    nsith?: ThresholdSith;
    toad?: number | string;
    wits?: string[];
    cuts?: string[];
    adds?: string[];
    cnfg?: string[];
    data?: unknown[];
    intive?: boolean;
    version?: Versionage;
    pvrsn?: Versionage;
    gvrsn?: Versionage | null;
    kind?: Kind;
  } = {},
): SerderKERI {
  const resolved = resolveVersionOptions(versions);
  if (!(new Set<string>([Ilks.rot, Ilks.drt])).has(ilk)) {
    throw new ValidationError(`Invalid ilk=${ilk} for rot or drt.`);
  }
  const snNum = coerceWholeNumber(sn, "sn");
  if (snNum < 1) {
    throw new ValidationError(`Invalid sn = 0x${snNum.toString(16)} for rot or drt.`);
  }

  const currentTholder = validateThreshold(isith, keys.length, "current", 1);
  const nextDigs = cloneStringList(ndigs);
  const nextTholder = validateThreshold(nsith, nextDigs.length, "next", 0);
  const currentWits = cloneStringList(wits);
  if (!hasUniqueWitnesses(currentWits)) {
    throw new ValidationError(`Invalid wits = ${currentWits}, has duplicates.`);
  }
  const cutsList = cloneStringList(cuts);
  const addsList = cloneStringList(adds);
  const derived = deriveRotatedWitnessSet(currentWits, cutsList, addsList);
  if (derived.kind === "reject") {
    throw new ValidationError(
      `Invalid witness cut/add combination: ${derived.reason}.`,
    );
  }
  const nextWits = derived.value.wits;
  const resolvedToad = toad === undefined
    ? (nextWits.length === 0 ? 0 : ample(nextWits.length))
    : coerceWholeNumber(toad, "toad");
  if (nextWits.length === 0 && resolvedToad !== 0) {
    throw new ValidationError(`Invalid toad = ${resolvedToad} for wits = ${nextWits}`);
  }
  if (nextWits.length > 0 && (resolvedToad < 1 || resolvedToad > nextWits.length)) {
    throw new ValidationError(`Invalid toad = ${resolvedToad} for wits = ${nextWits}`);
  }

  const sad: Record<string, unknown> = {
    t: ilk,
    d: "",
    i: pre,
    s: snNum.toString(16),
    p: dig,
    kt: encodeThreshold(currentTholder, intive),
    k: [...keys],
    nt: encodeThreshold(nextTholder, intive),
    n: nextDigs,
    bt: encodeCount(resolvedToad, intive),
    br: cutsList,
    ba: addsList,
  };
  if (resolved.pvrsn.major >= 2) {
    sad.c = cloneStringList(cnfg);
    sad.a = cloneDataList(data);
  } else {
    sad.a = cloneDataList(data);
  }

  return new SerderKERI({
    sad,
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function deltate(
  pre: string,
  keys: string[],
  dig: string,
  options: Omit<Parameters<typeof rotate>[3], "ilk"> = {},
): SerderKERI {
  return rotate(pre, keys, dig, { ...options, ilk: Ilks.drt });
}

export function interact(
  pre: string,
  dig: string,
  sn = 1,
  data: unknown[] = [],
  versions: VersionOptions = {},
): SerderKERI {
  const resolved = resolveVersionOptions(versions);
  const snNum = coerceWholeNumber(sn, "sn");
  if (snNum < 1) {
    throw new ValidationError(`Invalid sn = 0x${snNum.toString(16)} for ixn.`);
  }
  return new SerderKERI({
    sad: {
      t: Ilks.ixn,
      d: "",
      i: pre,
      s: snNum.toString(16),
      p: dig,
      a: cloneDataList(data),
    },
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function receipt(
  pre: string,
  sn: number | string,
  said: string,
  versions: VersionOptions = {},
): SerderKERI {
  const resolved = resolveVersionOptions(versions);
  const snNum = coerceWholeNumber(sn, "sn");
  return new SerderKERI({
    sad: {
      t: Ilks.rct,
      d: said,
      i: pre,
      s: snNum.toString(16),
    },
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function query(
  route = "",
  queryData: Record<string, unknown> = {},
  stampOrOptions:
    | string
    | {
      pre?: string;
      replyRoute?: string;
      stamp?: string;
      version?: Versionage;
      pvrsn?: Versionage;
      gvrsn?: Versionage | null;
      kind?: Kind;
    } = {},
): SerderKERI {
  const options = typeof stampOrOptions === "string"
    ? { stamp: stampOrOptions }
    : stampOrOptions;
  const resolved = resolveVersionOptions(options);
  const sad: Record<string, unknown> = {
    t: Ilks.qry,
    d: "",
    dt: options.stamp ?? makeNowIso8601(),
    r: route,
    rr: options.replyRoute ?? "",
    q: { ...queryData },
  };
  if (resolved.pvrsn.major >= 2) {
    sad.i = options.pre ?? "";
  }
  return new SerderKERI({
    sad,
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function reply(
  route = "",
  data: Record<string, unknown> = {},
  stampOrOptions:
    | string
    | {
      pre?: string;
      stamp?: string;
      version?: Versionage;
      pvrsn?: Versionage;
      gvrsn?: Versionage | null;
      kind?: Kind;
    } = {},
): SerderKERI {
  const options = typeof stampOrOptions === "string"
    ? { stamp: stampOrOptions }
    : stampOrOptions;
  const resolved = resolveVersionOptions(options);
  const sad: Record<string, unknown> = {
    t: Ilks.rpy,
    d: "",
    dt: options.stamp ?? makeNowIso8601(),
    r: route,
    a: { ...data },
  };
  if (resolved.pvrsn.major >= 2) {
    sad.i = options.pre ?? "";
  }
  return new SerderKERI({
    sad,
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function prod(
  route = "",
  queryData: Record<string, unknown> = {},
  stampOrOptions:
    | string
    | {
      pre?: string;
      replyRoute?: string;
      stamp?: string;
      version?: Versionage;
      pvrsn?: Versionage;
      gvrsn?: Versionage | null;
      kind?: Kind;
    } = {},
): SerderKERI {
  const options = typeof stampOrOptions === "string"
    ? { stamp: stampOrOptions }
    : stampOrOptions;
  const resolved = resolveVersionOptions(options);
  const sad: Record<string, unknown> = {
    t: Ilks.pro,
    d: "",
    dt: options.stamp ?? makeNowIso8601(),
    r: route,
    rr: options.replyRoute ?? "",
    q: { ...queryData },
  };
  if (resolved.pvrsn.major >= 2) {
    sad.i = options.pre ?? "";
  }
  return new SerderKERI({
    sad,
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function bare(
  route = "",
  data: Record<string, unknown> = {},
  stampOrOptions:
    | string
    | {
      pre?: string;
      stamp?: string;
      version?: Versionage;
      pvrsn?: Versionage;
      gvrsn?: Versionage | null;
      kind?: Kind;
    } = {},
): SerderKERI {
  const options = typeof stampOrOptions === "string"
    ? { stamp: stampOrOptions }
    : stampOrOptions;
  const resolved = resolveVersionOptions(options);
  const sad: Record<string, unknown> = {
    t: Ilks.bar,
    d: "",
    dt: options.stamp ?? makeNowIso8601(),
    r: route,
    a: { ...data },
  };
  if (resolved.pvrsn.major >= 2) {
    sad.i = options.pre ?? "";
  }
  return new SerderKERI({
    sad,
    pvrsn: resolved.pvrsn,
    gvrsn: resolved.gvrsn ?? undefined,
    kind: resolved.kind,
    makify: true,
  });
}

export function exchept(
  route = "",
  {
    sender = "",
    receiver = "",
    modifiers,
    attributes,
    nonce,
    stamp,
    pvrsn = Vrsn_2_0,
    gvrsn,
    kind = Kinds.json,
  }: {
    sender?: string;
    receiver?: string;
    modifiers?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    nonce?: string;
    stamp?: string;
    pvrsn?: Versionage;
    gvrsn?: Versionage | null;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.xip,
      d: "",
      u: nonce ?? new Noncer({
        code: NonceDex.Salt_128,
        raw: crypto.getRandomValues(new Uint8Array(16)),
      }).qb64,
      i: sender,
      ri: receiver,
      dt: stamp ?? makeNowIso8601(),
      r: route,
      q: { ...(modifiers ?? {}) },
      a: { ...(attributes ?? {}) },
    },
    pvrsn,
    gvrsn: gvrsn ?? Vrsn_2_0,
    kind,
    makify: true,
  });
}

export function exchange(
  route = "",
  {
    sender = "",
    receiver = "",
    xid = "",
    prior = "",
    modifiers,
    attributes,
    stamp,
    pvrsn = Vrsn_2_0,
    gvrsn,
    kind = Kinds.json,
  }: {
    sender?: string;
    receiver?: string;
    xid?: string;
    prior?: string;
    modifiers?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    stamp?: string;
    pvrsn?: Versionage;
    gvrsn?: Versionage | null;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.exn,
      d: "",
      i: sender,
      ri: receiver,
      x: xid,
      p: prior,
      dt: stamp ?? makeNowIso8601(),
      r: route,
      q: { ...(modifiers ?? {}) },
      a: { ...(attributes ?? {}) },
    },
    pvrsn,
    gvrsn: gvrsn ?? Vrsn_2_0,
    kind,
    makify: true,
  });
}
