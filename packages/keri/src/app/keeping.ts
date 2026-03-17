import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { argon2id } from "npm:@noble/hashes@1.8.0/argon2";
import {
  Cigar,
  decodeB64,
  Diger,
  hydrateMatter,
  intToB64,
  NumberPrimitive,
  NumDex,
  parseMatter,
  Prefixer,
  Saider,
  Salter,
  Siger,
  Signer,
  Verfer,
} from "../../../cesr/mod.ts";
import { b } from "../../../cesr/mod.ts";
import { Keeper, PrePrm, PreSit } from "../db/keeping.ts";

/**
 * Root key-creation strategy selectors stored in keeper globals.
 *
 * Only `salty` is currently implemented end-to-end in `keri-ts`; the others are
 * preserved so the app-layer contract stays aligned with KERIpy naming.
 */
export enum Algos {
  randy = "randy",
  salty = "salty",
  group = "group",
  extern = "extern",
}

/**
 * Inputs for constructing a `Manager` over an already-open `Keeper`.
 *
 * The manager persists most root state in `ks.gbls`; `seed` remains
 * process-local so readonly/inspection opens can avoid writing secrets back to
 * disk.
 */
export interface ManagerArgs {
  ks: Keeper;
  seed?: string;
  aeid?: string;
  pidx?: number;
  algo?: Algos;
  salt?: string;
  tier?: string;
}

/**
 * Controls key-material derivation for `Manager.incept()`.
 *
 * This is the TypeScript bootstrap slice of KERIpy's richer incept options:
 * enough for current salty/non-transferable flows, but not yet the full keeper
 * algorithm matrix.
 */
export interface ManagerInceptArgs {
  icount?: number;
  ncount?: number;
  icode?: string;
  ncode?: string;
  dcode?: string;
  algo?: Algos;
  salt?: string;
  stem?: string;
  tier?: string;
  rooted?: boolean;
  transferable?: boolean;
  temp?: boolean;
}

interface SignerMaterial {
  signer: Signer;
  verfer: Verfer;
}

function parseQb64Raw(qb64: string): Uint8Array {
  return parseMatter(b(qb64), "txt").raw;
}

function randomSaltQb64(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return new Salter({ code: "0A", raw }).qb64;
}

function pathToBytes(path: string): Uint8Array {
  return b(path);
}

function tierParams(tier: string, temp: boolean): { t: number; m: number } {
  if (temp) {
    return { t: 1, m: 8 };
  }

  if (tier === "low") return { t: 2, m: 65536 };
  if (tier === "med") return { t: 3, m: 262144 };
  if (tier === "high") return { t: 4, m: 1048576 };
  throw new Error(`Unsupported security tier=${tier}`);
}

function deriveSeedFromSalt(
  saltQb64: string,
  path: string,
  tier: string,
  temp: boolean,
): Uint8Array {
  const saltRaw = parseQb64Raw(saltQb64);
  const params = tierParams(tier, temp);
  return argon2id(pathToBytes(path), saltRaw, {
    p: 1,
    t: params.t,
    m: params.m,
    dkLen: 32,
    version: 0x13,
  });
}

/**
 * Derive a deterministic Ed25519 signer pair from salty root material.
 *
 * KERIpy correspondence:
 * - mirrors the current salty derivation path used by `Manager` for root and
 *   per-prefix key material
 *
 * Current `keri-ts` difference:
 * - returns the narrow CESR primitives directly so callers can decide whether
 *   to keep semantic objects or project `.qb64` at the boundary they need
 */
export function saltySigner(
  saltQb64: string,
  path: string,
  transferable: boolean,
  tier: string,
  temp: boolean,
): SignerMaterial {
  const seedRaw = deriveSeedFromSalt(saltQb64, path, tier, temp);
  const signer = new Signer({ code: "A", raw: seedRaw });
  const pubRaw = ed25519.getPublicKey(seedRaw);
  const verfer = new Verfer({
    code: transferable ? "D" : "B",
    raw: pubRaw,
  });
  return { signer, verfer };
}

function pubsKey(pre: string, ridx: number): string {
  return `${pre}.${ridx.toString(16).padStart(32, "0")}`;
}

/**
 * Key-management coordinator backed by `Keeper` state.
 *
 * Responsibilities:
 * - own keeper-global root settings (`aeid`, `pidx`, `algo`, `salt`, `tier`)
 * - derive incept/current/next key material
 * - persist per-prefix parameters, situations, and public-key sets
 *
 * KERIpy correspondence:
 * - mirrors the role of `keri.app.keeping.Manager`
 *
 * Current `keri-ts` differences:
 * - bootstrap-first: the salty path is the only real algorithm today
 * - AEID handling currently validates association and storage boundaries but
 *   does not yet implement KERIpy's full re-encryption/decryption lifecycle
 * - readonly opens intentionally avoid keeper mutation so visibility commands
 *   can inspect stores without side effects
 */
export class Manager {
  private _seed: string;
  private _ks: Keeper;

  constructor(args: ManagerArgs) {
    const {
      ks,
      seed = "",
      aeid = "",
      pidx = 0,
      algo = Algos.salty,
      salt = randomSaltQb64(),
      tier = "low",
    } = args;

    this._ks = ks;
    this._seed = seed;

    if (this.pidx === null) this.pidx = pidx;
    if (this.algo === null) this.algo = algo;
    if (this.salt === null) this.salt = salt;
    if (this.tier === null) this.tier = tier;

    this.setup(aeid, seed);
  }

  get ks(): Keeper {
    return this._ks;
  }

  get seed(): string {
    return this._seed;
  }

  get aeid(): string {
    return this.ks.getGbls("aeid") ?? "";
  }

  get pidx(): number | null {
    const val = this.ks.getGbls("pidx");
    if (val === null) return null;
    return parseInt(val, 16);
  }

  set pidx(pidx: number) {
    this.ks.pinGbls("pidx", pidx.toString(16));
  }

  get algo(): Algos | null {
    const val = this.ks.getGbls("algo");
    if (val === null) return null;
    return val as Algos;
  }

  set algo(algo: Algos) {
    this.ks.pinGbls("algo", algo);
  }

  get salt(): string | null {
    return this.ks.getGbls("salt");
  }

  set salt(salt: string) {
    this.ks.pinGbls("salt", salt);
  }

  get tier(): string | null {
    return this.ks.getGbls("tier");
  }

  set tier(tier: string) {
    this.ks.pinGbls("tier", tier);
  }

  setup(aeid = "", seed = ""): void {
    this.updateAeid(aeid, seed);
  }

  updateAeid(aeid: string, seed: string): void {
    if (aeid) {
      if (!seed) {
        throw new Error("Seed required when aeid is set.");
      }
      const seedRaw = parseQb64Raw(seed);
      const derivedAeid = new Prefixer({
        code: "B",
        raw: ed25519.getPublicKey(seedRaw),
      }).qb64;
      if (derivedAeid !== aeid) {
        throw new Error(
          `Seed missing or provided seed not associated with aeid=${aeid}.`,
        );
      }
    }

    this._seed = seed;
    if (this.ks.readonly) {
      return;
    }
    this.ks.pinGbls("aeid", aeid);
  }

  incept(args: ManagerInceptArgs = {}): [Verfer[], Diger[]] {
    const {
      icount = 1,
      ncount = 1,
      dcode = "E",
      stem = "",
      transferable = true,
      algo,
      salt,
      tier,
      rooted = true,
      temp = false,
    } = args;

    const usedAlgo = rooted
      ? (algo ?? this.algo ?? Algos.salty)
      : (algo ?? Algos.salty);
    if (usedAlgo !== Algos.salty) {
      throw new Error(`Unsupported key creation algorithm=${usedAlgo}`);
    }

    const usedSalt = rooted ? (salt ?? this.salt ?? "") : (salt ?? "");
    const usedTier = rooted ? (tier ?? this.tier ?? "low") : (tier ?? "low");
    const pidx = this.pidx ?? 0;

    const verfers: Verfer[] = [];
    const digers: Diger[] = [];

    const rootStem = stem || `${pidx.toString(16)}`;

    for (let i = 0; i < icount; i++) {
      const path = `${rootStem}${(0).toString(16)}${i.toString(16)}`;
      const signer = saltySigner(
        usedSalt,
        path,
        transferable,
        usedTier,
        temp,
      );
      verfers.push(signer.verfer);
      this.ks.putPris(signer.verfer.qb64, signer.signer.qb64);
    }

    for (let i = 0; i < ncount; i++) {
      const path = `${rootStem}${(1).toString(16)}${(icount + i).toString(16)}`;
      const signer = saltySigner(
        usedSalt,
        path,
        transferable,
        usedTier,
        temp,
      );
      const dig = new Diger({
        code: dcode,
        raw: Diger.digest(b(signer.verfer.qb64), dcode),
      });
      digers.push(dig);
      this.ks.putPris(signer.verfer.qb64, signer.signer.qb64);
    }

    const pp: PrePrm = {
      pidx,
      algo: usedAlgo,
      salt: usedSalt,
      stem,
      tier: usedTier,
    };

    const dt = new Date().toISOString();
    const ps: PreSit = {
      old: { pubs: [], ridx: 0, kidx: 0, dt },
      new: {
        pubs: verfers.map((verfer) => verfer.qb64),
        ridx: 0,
        kidx: 0,
        dt,
      },
      nxt: {
        pubs: digers.map((diger) => diger.qb64),
        ridx: 1,
        kidx: icount,
        dt,
      },
    };

    const opre = verfers[0].qb64;
    if (!this.ks.putPres(opre, opre)) {
      throw new Error(`Already incepted pre=${opre}.`);
    }
    if (!this.ks.putPrms(opre, pp)) {
      throw new Error(`Already incepted prm for pre=${opre}.`);
    }
    if (!this.ks.putSits(opre, ps)) {
      throw new Error(`Already incepted sit for pre=${opre}.`);
    }
    this.ks.putPubs(pubsKey(opre, 0), { pubs: ps.new.pubs });
    this.ks.putPubs(pubsKey(opre, 1), { pubs: ps.nxt.pubs });

    this.pidx = pidx + 1;
    return [verfers, digers];
  }

  move(oldPre: string, newPre: string): void {
    if (oldPre === newPre) return;
    if (!this.ks.getPres(oldPre)) {
      throw new Error(`Nonexistent old pre=${oldPre}, nothing to assign.`);
    }
    if (this.ks.getPres(newPre)) {
      throw new Error(`Preexistent new pre=${newPre} may not clobber.`);
    }
    const prm = this.ks.getPrms(oldPre);
    const sit = this.ks.getSits(oldPre);
    if (!prm || !sit) {
      throw new Error(`Missing records to move from old pre=${oldPre}.`);
    }
    this.ks.putPrms(newPre, prm);
    this.ks.putSits(newPre, sit);
    let ri = 0;
    while (true) {
      const oldKey = pubsKey(oldPre, ri);
      const newKey = pubsKey(newPre, ri);
      const ps = this.ks.getPubs(oldKey);
      if (ps === null) break;
      this.ks.putPubs(newKey, ps);
      ri += 1;
    }
    this.ks.pinPres(oldPre, newPre);
    this.ks.putPres(newPre, newPre);
  }

  sign(ser: Uint8Array, pubs: string[], indexed: true): Siger[];
  sign(ser: Uint8Array, pubs: string[], indexed?: false): Cigar[];
  sign(ser: Uint8Array, pubs: string[], indexed = true): Siger[] | Cigar[] {
    if (indexed) {
      return pubs.map((pub, idx) => {
        const seedQb64 = this.ks.getPris(pub);
        if (!seedQb64) {
          throw new Error(`Missing prikey in db for pubkey=${pub}`);
        }
        const seedRaw = parseQb64Raw(seedQb64);
        const sigRaw = ed25519.sign(ser, seedRaw);
        return new Siger({ code: "A", raw: sigRaw, index: idx });
      });
    }
    return pubs.map((pub) => {
      const seedQb64 = this.ks.getPris(pub);
      if (!seedQb64) throw new Error(`Missing prikey in db for pubkey=${pub}`);
      const seedRaw = parseQb64Raw(seedQb64);
      const sigRaw = ed25519.sign(ser, seedRaw);
      return new Cigar({ code: "0B", raw: sigRaw });
    });
  }
}

export function normalizeSaltQb64(salt?: string): string {
  return salt
    ? new Salter({ code: "0A", raw: parseQb64Raw(salt) }).qb64
    : randomSaltQb64();
}

export function branToSaltQb64(bran: string): string {
  if (bran.length < 21) {
    throw new Error("Bran (passcode seed material) too short.");
  }
  return `0AA${bran.slice(0, 21)}`;
}

export function encodeDateTimeToDater(dts: string): string {
  return `1AAG${
    dts.replace(/:/g, "c").replace(/\./g, "d").replace(/\+/g, "p")
  }`;
}

export function encodeCounterV1(code: string, count: number): string {
  return `${code}${intToB64(count, 2)}`;
}

export function encodeHugeNumber(num: number): string {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = 15; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw }).qb64;
}

export function normalizeQb64Code(qb64: string): string {
  return hydrateMatter(parseMatter(b(qb64), "txt")).qb64;
}

export function makeSaider(raw: Uint8Array): string {
  return new Saider({ code: "E", raw: Diger.digest(raw, "E") }).qb64;
}

export function b64DecodeUrl(text: string): Uint8Array {
  return decodeB64(text);
}
