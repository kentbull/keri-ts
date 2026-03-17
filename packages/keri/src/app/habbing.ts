import { type Operation } from "npm:effection@^3.6.0";
import {
  Cigar,
  DigDex,
  DIGEST_CODES,
  parseMatter,
  PREFIX_CODES,
  SerderKERI,
  Siger,
} from "../../../cesr/mod.ts";
import { b } from "../../../cesr/mod.ts";
import type { HabitatRecord, KeyStateRecord } from "../core/records.ts";
import { Baser, createBaser } from "../db/basing.ts";
import { createKeeper, Keeper } from "../db/keeping.ts";
import { Configer, createConfiger } from "./configing.ts";
import {
  Algos,
  branToSaltQb64,
  encodeDateTimeToDater,
  ensureKeeperCryptoReady,
  Manager,
  normalizeSaltQb64,
  saltySigner,
} from "./keeping.ts";

/** Reserved alias for the local signatory habitat record. */
export const SIGNER = "__signatory__";

/** Arguments for constructing and reopening a `Habery`. */
export interface HaberyArgs {
  name: string;
  base?: string;
  temp?: boolean;
  headDirPath?: string;
  compat?: boolean;
  readonly?: boolean;
  cf?: Configer;
  skipConfig?: boolean;
  skipSignator?: boolean;
  bran?: string;
  seed?: string;
  aeid?: string;
  salt?: string;
  algo?: Algos;
}

/** Habitat inception options consumed by the local bootstrap `Hab.make()` flow. */
export interface MakeHabArgs {
  code?: string;
  transferable?: boolean;
  isith?: string;
  icount?: number;
  nsith?: string;
  ncount?: number;
  toad?: number;
  wits?: string[];
  delpre?: string;
  estOnly?: boolean;
  DnD?: boolean;
  hidden?: boolean;
  data?: unknown[];
  algo?: Algos;
  salt?: string;
  tier?: string;
}

/**
 * Minimal in-memory projection of current key state for one habitat.
 *
 * Current `keri-ts` difference:
 * - this is a derived cache rebuilt from `Baser.states` rather than an
 *   independently authoritative persisted object
 */
export interface KeverState {
  pre: string;
  verfers: string[];
  digers: string[];
  sn: number;
  delpre?: string;
  wits: string[];
}

function makeNowIso8601(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const micros = (now.getUTCMilliseconds() * 1000).toString().padStart(6, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

function defaultThreshold(count: number, min: number): string {
  return `${Math.max(min, Math.ceil(count / 2)).toString(16)}`;
}

function keverStateFromRecord(record: KeyStateRecord): KeverState {
  return {
    pre: record.i ?? "",
    verfers: record.k ?? [],
    digers: record.n ?? [],
    sn: Number.parseInt(record.s ?? "0", 16),
    delpre: record.di || undefined,
    wits: record.b ?? [],
  };
}

function makeKeyStateRecord(args: {
  pre: string;
  said: string;
  dt: string;
  ilk: string;
  fn: number;
  isith: string;
  nsith: string;
  keys: string[];
  ndigs: string[];
  toad: number;
  wits: string[];
  cnfg: string[];
  delpre?: string;
}): KeyStateRecord {
  return {
    vn: [1, 0],
    i: args.pre,
    s: "0",
    p: "",
    d: args.said,
    f: args.fn.toString(16),
    dt: args.dt,
    et: args.ilk,
    kt: args.isith,
    k: args.keys,
    nt: args.nsith,
    n: args.ndigs,
    bt: args.toad.toString(16),
    b: args.wits,
    c: args.cnfg,
    ee: {
      s: "0",
      d: args.said,
      br: [],
      ba: [],
    },
    di: args.delpre ?? "",
  };
}

function makeInceptRaw(
  keys: string[],
  ndigs: string[],
  args: {
    code: string;
    isith?: string;
    nsith?: string;
    toad: number;
    wits: string[];
    cnfg: string[];
    data: unknown[];
    delpre?: string;
  },
): SerderKERI {
  const ilk = args.delpre ? "dip" : "icp";
  const kt = args.isith ?? defaultThreshold(keys.length, 1);
  const nt = args.nsith ?? defaultThreshold(ndigs.length, 0);

  const ked: Record<string, unknown> = {
    t: ilk,
    i: "",
    kt,
    k: keys,
    nt,
    n: ndigs,
    bt: `${args.toad.toString(16)}`,
    b: args.wits,
    c: args.cnfg,
    a: args.data,
  };

  if (args.delpre) ked.di = args.delpre;
  if (!args.delpre && !DIGEST_CODES.has(args.code) && keys.length === 1) {
    ked.i = keys[0];
  }

  const saids = resolveInceptiveSaidCodes(ked, args.code);
  return new SerderKERI({
    sad: ked,
    makify: true,
    saids,
  });
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
      saids.i = parseMatter(b(ked.i), "txt").code;
    } catch {
      // Match KERIpy priority: invalid existing values do not override defaults.
    }
  }

  return saids;
}

/** Represents a local identifier habitat and its current key state. */
export class Hab {
  readonly name: string;
  readonly ns?: string;
  readonly db: Baser;
  readonly ks: Keeper;
  readonly mgr: Manager;
  pre = "";
  kever: KeverState | null = null;

  constructor(
    name: string,
    db: Baser,
    ks: Keeper,
    mgr: Manager,
    ns?: string,
    pre = "",
  ) {
    this.name = name;
    this.db = db;
    this.ks = ks;
    this.mgr = mgr;
    this.ns = ns;
    this.pre = pre;
    if (this.pre) {
      this.refreshKever();
    }
  }

  /** Refresh the cached `kever` projection from durable `Baser.states` content. */
  private refreshKever(): void {
    if (!this.pre) {
      this.kever = null;
      return;
    }
    const state = this.db.getState(this.pre);
    this.kever = state ? keverStateFromRecord(state) : null;
  }

  /**
   * Incept this habitat and persist the local bootstrap state backbone.
   *
   * Durable writes performed here include `evts.`, `kels.`, `fels.`, `dtss.`,
   * `sigs.`, `esrs.`, `states.`, and, when visible, `habs.` plus `names.`.
   */
  make(args: MakeHabArgs = {}): void {
    const {
      code = "E",
      transferable = true,
      isith = undefined,
      icount = 1,
      nsith = undefined,
      ncount = undefined,
      toad = 0,
      wits = [],
      delpre = undefined,
      estOnly = false,
      DnD = false,
      hidden = false,
      data = [],
      algo = undefined,
      salt = undefined,
      tier = undefined,
    } = args;

    let nextCount = ncount ?? icount;
    let nextSith = nsith ?? isith;
    let prefixCode = code;
    if (!transferable) {
      nextCount = 0;
      nextSith = "0";
      prefixCode = "B";
    }

    const [verfers, digers] = this.mgr.incept({
      icount,
      ncount: nextCount,
      stem: this.ns ? `${this.ns}${this.name}` : this.name,
      transferable,
      algo,
      salt,
      tier,
    });

    const keys = verfers.map((v) => v.qb64);
    const ndigs = digers.map((d) => d.qb64);
    const cnfg = [...(estOnly ? ["EO"] : []), ...(DnD ? ["DND"] : [])];

    const currentSith = isith ?? defaultThreshold(keys.length, 1);
    const nextThreshold = nextSith ?? defaultThreshold(ndigs.length, 0);
    const serder = makeInceptRaw(keys, ndigs, {
      code: prefixCode,
      isith: currentSith,
      nsith: nextThreshold,
      toad,
      wits,
      cnfg,
      data,
      delpre,
    });
    const pre = serder.pre;
    const said = serder.said;
    if (!pre || !said) {
      throw new Error(
        "Expected inception serder to provide string pre and said.",
      );
    }
    const raw = serder.raw;

    const opre = verfers[0].qb64;
    this.mgr.move(opre, pre);
    this.pre = pre;

    const sigs = this.mgr.sign(raw, keys, true);
    const now = makeNowIso8601();
    const ilk = delpre ? "dip" : "icp";
    this.db.putEvtSerder(pre, said, raw);
    this.db.putKel(pre, 0, said);
    const fn = this.db.appendFel(pre, said);
    this.db.putDts(pre, said, encodeDateTimeToDater(now));
    this.db.pinSigs(pre, said, sigs);
    this.db.pinEsr(pre, said, { local: true });
    const state = makeKeyStateRecord({
      pre,
      said,
      dt: now,
      ilk,
      fn,
      isith: currentSith,
      nsith: nextThreshold,
      keys,
      ndigs,
      toad,
      wits,
      cnfg,
      delpre,
    });
    this.db.pinState(pre, state);
    this.kever = keverStateFromRecord(state);

    if (!hidden) {
      const habord: HabitatRecord = {
        hid: pre,
        name: this.name,
        domain: this.ns,
      };
      this.db.pinHab(pre, habord);
      this.db.pinName(this.ns ?? "", this.name, pre);
    }
  }

  /** Produces signatures with this habitat's current signing keys. */
  sign(ser: Uint8Array, indexed: true): Siger[];
  sign(ser: Uint8Array, indexed?: false): Cigar[];
  sign(ser: Uint8Array, indexed = false): Siger[] | Cigar[] {
    if (!this.kever && this.pre) {
      this.refreshKever();
    }
    const pubs = this.kever?.verfers ?? [];
    if (indexed) {
      return this.mgr.sign(ser, pubs, true);
    }
    return this.mgr.sign(ser, pubs, false);
  }
}

/**
 * Internal signatory habitat wrapper used for habery-scoped signatures.
 *
 * KERIpy correspondence:
 * - mirrors the idea of a persisted `__signatory__` habitat owned by the
 *   enclosing habery
 *
 * Current `keri-ts` differences:
 * - signing/verification are currently deterministic local-hab wrappers, not a
 *   full parity implementation of KERIpy signatory lifecycle and reopen logic
 */
export class Signator {
  readonly db: Baser;
  readonly hab: Hab;
  pre: string;

  constructor(db: Baser, habery: Habery) {
    this.db = db;
    const spre = this.db.getHby(SIGNER);
    if (!spre) {
      const hab = new Hab(SIGNER, habery.db, habery.ks, habery.mgr);
      hab.make({ transferable: false, hidden: true });
      this.hab = hab;
      this.pre = hab.pre;
      this.db.pinHby(SIGNER, this.pre);
    } else {
      const hab = new Hab(
        SIGNER,
        habery.db,
        habery.ks,
        habery.mgr,
        undefined,
        spre,
      );
      this.hab = hab;
      this.pre = spre;
    }
  }

  /** Signs arbitrary serialized bytes with the habery-owned signatory habitat. */
  sign(ser: Uint8Array): string {
    const sig = this.hab.sign(ser, false)[0];
    if (!sig) throw new Error("Unable to sign");
    return sig.qb64;
  }

  /** Verifies by recomputing the expected deterministic signature. */
  verify(ser: Uint8Array, cigar: string): boolean {
    const expected = this.sign(ser);
    return expected === cigar;
  }
}

/**
 * Top-level controller container for databases, key manager, config, and local
 * habitats.
 *
 * Responsibilities:
 * - compose `Baser`, `Keeper`, `Manager`, optional config, and loaded habitats
 * - eagerly reconstruct persisted habitat visibility on open
 * - provide app-layer alias lookup and habitat creation boundaries
 *
 * State model:
 * - `habs` is an in-memory cache of reconstructed `Hab` instances
 * - durable habitat metadata lives in `habs.`
 * - durable current key state lives in `states.` with supporting `evts.`,
 *   `kels.`, `fels.`, and `dtss.` data in `Baser`
 * - `Hab.kever` is a derived cache rebuilt from DB state, not the sole source
 *   of truth
 *
 * Current `keri-ts` differences:
 * - readonly compatibility opens may intentionally skip config processing and
 *   signator creation for visibility-only commands
 * - config-driven OOBI processing and broader KEL/state orchestration are not
 *   yet at KERIpy parity
 */
export class Habery {
  readonly name: string;
  readonly base: string;
  readonly temp: boolean;
  readonly db: Baser;
  readonly ks: Keeper;
  readonly mgr: Manager;
  readonly cf?: Configer;
  readonly config: Record<string, unknown>;
  readonly habs = new Map<string, Hab>();
  readonly signator: Signator | null;

  constructor(
    name: string,
    base: string,
    temp: boolean,
    db: Baser,
    ks: Keeper,
    mgr: Manager,
    cf?: Configer,
    config: Record<string, unknown> = {},
    skipSignator = false,
  ) {
    this.name = name;
    this.base = base;
    this.temp = temp;
    this.db = db;
    this.ks = ks;
    this.mgr = mgr;
    this.cf = cf;
    this.config = config;
    this.signator = skipSignator ? null : new Signator(this.db, this);
    this.loadHabs();
  }

  /**
   * Populate the in-memory habitat cache from durable `habs.` + `states.` data.
   *
   * Bare metadata records without corresponding current state are skipped so
   * `Habery.habs` only contains reopenable local habitats.
   */
  private loadHabs(): void {
    for (const [pre, habord] of this.db.getHabItemIter()) {
      const hid = habord.hid || pre;
      if (!habord.name || this.habs.has(hid) || !this.db.getState(hid)) {
        continue;
      }
      const hab = new Hab(
        habord.name,
        this.db,
        this.ks,
        this.mgr,
        habord.domain,
        hid,
      );
      this.habs.set(hid, hab);
    }
  }

  /** Creates and caches a new habitat under this habery. */
  makeHab(name: string, ns?: string, args: MakeHabArgs = {}): Hab {
    const hab = new Hab(name, this.db, this.ks, this.mgr, ns);
    hab.make(args);
    if (!hab.pre) throw new Error("Hab creation failed");
    this.habs.set(hab.pre, hab);
    return hab;
  }

  /**
   * Resolve a habitat by alias (and optional namespace) using DB-backed state.
   *
   * This uses `names.` for alias lookup, `habs.` for metadata, and `states.`
   * for reopenable current state before materializing a cached `Hab`.
   */
  habByName(name: string, ns?: string): Hab | null {
    const pre = this.db.getName(ns ?? "", name);
    if (!pre) return null;
    if (this.habs.has(pre)) return this.habs.get(pre)!;
    const rec = this.db.getHab(pre);
    if (!rec || !this.db.getState(pre)) return null;
    const hab = new Hab(name, this.db, this.ks, this.mgr, ns, pre);
    this.habs.set(pre, hab);
    return hab;
  }

  /** Closes backing databases and optionally clears temp storage. */
  *close(clear = false): Operation<void> {
    yield* this.db.close(clear);
    yield* this.ks.close(clear);
    if (this.cf) {
      yield* this.cf.close(clear && this.temp);
    }
  }
}

/** Derives deterministic seed/aeid values from passcode material exactly as KERIpy bran flow. */
export function branToSeedAeid(bran: string): { seed: string; aeid: string } {
  const branSalt = branToSaltQb64(bran);
  const signer = saltySigner(branSalt, "", false, "low", false);
  return { seed: signer.signer.qb64, aeid: signer.verfer.qb64 };
}

/**
 * Create a `Habery` with reopened database/keystore surfaces and manager state.
 *
 * The returned `Habery` immediately reconstructs its local habitat cache from
 * durable DB state rather than depending on process-local creation history.
 */
export function* createHabery(args: HaberyArgs): Operation<Habery> {
  const {
    name,
    base = "",
    temp = false,
    headDirPath,
    compat = false,
    readonly = false,
    cf: providedCf,
    skipConfig = false,
    skipSignator = false,
    bran,
    seed,
    aeid,
    salt,
    algo,
  } = args;

  const db = yield* createBaser({
    name,
    base,
    temp,
    headDirPath,
    compat,
    reopen: true,
    readonly,
  });
  const ks = yield* createKeeper({
    name,
    base,
    temp,
    headDirPath,
    compat,
    reopen: true,
    readonly,
  });

  const cf = providedCf
    ?? (skipConfig ? undefined : (yield* createConfiger({
      name,
      base,
      temp,
      headDirPath,
      reopen: true,
      clear: false,
    })));
  const config = cf ? cf.get<Record<string, unknown>>() : {};

  let usedSeed = seed ?? "";
  let usedAeid = aeid ?? "";
  if (bran && !seed) {
    const derived = branToSeedAeid(bran);
    usedSeed = derived.seed;
    if (!usedAeid) usedAeid = derived.aeid;
  }

  // Encrypted keeper opens are sync at the `Manager` surface, so habery
  // creation explicitly establishes the sodium readiness boundary here before
  // manager construction. That keeps reopen/init paths honest without pushing
  // libsodium concerns into CESR imports.
  ensureKeeperCryptoReady();
  const mgr = new Manager({
    ks,
    seed: usedSeed,
    aeid: usedAeid,
    algo,
    salt: normalizeSaltQb64(salt),
  });

  return new Habery(name, base, temp, db, ks, mgr, cf, config, skipSignator);
}
