import { type Operation } from "npm:effection@^3.6.0";
import { Configer, createConfiger } from "./configing.ts";
import { Baser, createBaser } from "../db/basing.ts";
import { createKeeper, Keeper } from "../db/keeping.ts";
import {
  Algos,
  branToSaltQb64,
  encodeCounterV1,
  encodeDateTimeToDater,
  encodeHugeNumber,
  makeSaider,
  Manager,
  normalizeSaltQb64,
  saltySigner,
} from "./keeping.ts";

export const SIGNER = "__signatory__";

export interface HabitatRecord {
  hid: string;
  name: string;
  domain?: string;
  sid?: string;
  mid?: string;
  smids?: string[];
  rmids?: string[];
}

export interface HaberyArgs {
  name: string;
  base?: string;
  temp?: boolean;
  headDirPath?: string;
  cf?: Configer;
  bran?: string;
  seed?: string;
  aeid?: string;
  salt?: string;
  algo?: Algos;
}

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

export interface KeverState {
  pre: string;
  verfers: string[];
  digers: string[];
  sn: number;
  delpre?: string;
  wits: string[];
}

function versifyV1(size: number): string {
  return `KERI10JSON${size.toString(16).padStart(6, "0")}_`;
}

function serializeKed(ked: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(ked));
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
): { raw: Uint8Array; pre: string } {
  const ilk = args.delpre ? "dip" : "icp";
  const kt = args.isith ?? defaultThreshold(keys.length, 1);
  const nt = args.nsith ?? defaultThreshold(ndigs.length, 0);
  const saidDummy = "#".repeat(44);

  const ked: Record<string, unknown> = {
    v: versifyV1(0),
    t: ilk,
    d: saidDummy,
    i: args.code === "E" ? saidDummy : keys[0],
    s: "0",
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

  ked.v = versifyV1(serializeKed(ked).length);
  const sizedDummied = serializeKed(ked);
  const said = makeSaider(sizedDummied);

  ked.d = said;
  if (args.code === "E") ked.i = said;

  const raw = serializeKed(ked);
  return { raw, pre: ked.i as string };
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
  }

  /** Incepts this habitat and persists its inception event and habitat record. */
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

    const { raw, pre } = makeInceptRaw(keys, ndigs, {
      code: prefixCode,
      isith,
      nsith: nextSith,
      toad,
      wits,
      cnfg,
      data,
      delpre,
    });

    const opre = verfers[0].qb64;
    this.mgr.move(opre, pre);
    this.pre = pre;

    const sigs = this.mgr.sign(raw, keys, true);

    let atc = "";
    atc += encodeCounterV1("-A", sigs.length);
    for (const sig of sigs) atc += sig;

    atc += encodeCounterV1("-E", 1);
    atc += encodeHugeNumber(0);
    atc += encodeDateTimeToDater(makeNowIso8601());

    if (atc.length % 4 !== 0) {
      throw new Error("Invalid attachment size, nonintegral quadlets.");
    }

    const msg = new TextEncoder().encode(
      `${new TextDecoder().decode(raw)}${
        encodeCounterV1("-V", atc.length / 4)
      }${atc}`,
    );

    this.db.putEvt(new TextEncoder().encode(`${pre}:0`), msg);

    this.kever = {
      pre,
      verfers: keys,
      digers: ndigs,
      sn: 0,
      delpre,
      wits,
    };

    if (!hidden) {
      const habord: HabitatRecord = {
        hid: pre,
        name: this.name,
        domain: this.ns,
      };
      this.db.pinHab(pre, { ...habord, sigs });
      this.db.pinName(this.ns ?? "", this.name, pre);
    }
  }

  /** Produces signatures with this habitat's current signing keys. */
  sign(ser: Uint8Array, indexed = false): string[] {
    const pubs = this.kever?.verfers ?? [];
    return this.mgr.sign(ser, pubs, indexed);
  }
}

/** Local signatory wrapper for `__signatory__` signing used by habery internals. */
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

  /** Signs arbitrary serialized bytes with the signatory habitat. */
  sign(ser: Uint8Array): string {
    const sig = this.hab.sign(ser, false)[0];
    if (!sig) throw new Error("Unable to sign");
    return sig;
  }

  /** Verifies by recomputing the expected deterministic signature. */
  verify(ser: Uint8Array, cigar: string): boolean {
    const expected = this.sign(ser);
    return expected === cigar;
  }
}

/** Top-level container for database, keystore, manager, and habitats. */
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
  readonly signator: Signator;

  constructor(
    name: string,
    base: string,
    temp: boolean,
    db: Baser,
    ks: Keeper,
    mgr: Manager,
    cf?: Configer,
    config: Record<string, unknown> = {},
  ) {
    this.name = name;
    this.base = base;
    this.temp = temp;
    this.db = db;
    this.ks = ks;
    this.mgr = mgr;
    this.cf = cf;
    this.config = config;
    this.signator = new Signator(this.db, this);
  }

  /** Creates and caches a new habitat under this habery. */
  makeHab(name: string, ns?: string, args: MakeHabArgs = {}): Hab {
    const hab = new Hab(name, this.db, this.ks, this.mgr, ns);
    hab.make(args);
    if (!hab.pre) throw new Error("Hab creation failed");
    this.habs.set(hab.pre, hab);
    return hab;
  }

  /** Resolves a habitat by alias (and optional namespace). */
  habByName(name: string, ns?: string): Hab | null {
    const pre = this.db.getName(ns ?? "", name);
    if (!pre) return null;
    if (this.habs.has(pre)) return this.habs.get(pre)!;
    const rec = this.db.getHab<{ sigs?: string[] }>(pre);
    if (!rec) return null;
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
  return { seed: signer.seedQb64, aeid: signer.verferQb64 };
}

/** Creates a habery with opened database/keystore and initialized manager state. */
export function* createHabery(args: HaberyArgs): Operation<Habery> {
  const {
    name,
    base = "",
    temp = false,
    headDirPath,
    cf: providedCf,
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
    reopen: true,
    readonly: false,
  });
  const ks = yield* createKeeper({
    name,
    base,
    temp,
    headDirPath,
    reopen: true,
    readonly: false,
  });

  const cf = providedCf ?? (yield* createConfiger({
    name,
    base,
    temp,
    headDirPath,
    reopen: true,
    clear: false,
  }));
  const config = cf ? cf.get<Record<string, unknown>>() : {};

  let usedSeed = seed ?? "";
  let usedAeid = aeid ?? "";
  if (bran && !seed) {
    const derived = branToSeedAeid(bran);
    usedSeed = derived.seed;
    if (!usedAeid) usedAeid = derived.aeid;
  }

  const mgr = new Manager({
    ks,
    seed: usedSeed,
    aeid: usedAeid,
    algo,
    salt: normalizeSaltQb64(salt),
  });

  return new Habery(name, base, temp, db, ks, mgr, cf, config);
}
