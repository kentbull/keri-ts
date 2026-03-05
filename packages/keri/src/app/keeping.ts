import { blake3 } from "npm:@noble/hashes@1.8.0/blake3";
import { argon2id } from "npm:@noble/hashes@1.8.0/argon2";
import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { parseMatter } from "cesr-ts";
import { Keeper, PrePrm, PreSit } from "../db/keeping.ts";
import { b } from '../../../cesr/mod.ts'

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export enum Algos {
  randy = "randy",
  salty = "salty",
  group = "group",
  extern = "extern",
}

export interface ManagerArgs {
  ks: Keeper;
  seed?: string;
  aeid?: string;
  pidx?: number;
  algo?: Algos;
  salt?: string;
  tier?: string;
}

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

export interface KeyVerfer {
  qb64: string;
}

export interface KeyDiger {
  qb64: string;
}

interface SignerMaterial {
  seedQb64: string;
  verferQb64: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text + "=".repeat((4 - (text.length % 4 || 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(b64);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
  return out;
}

function intToB64(value: number, length = 1): string {
  let v = value;
  const out = new Array<string>(length).fill("A");
  for (let i = length - 1; i >= 0; i--) {
    out[i] = B64_ALPHABET[v & 0x3f];
    v = Math.floor(v / 64);
  }
  return out.join("");
}

function parseQb64Raw(qb64: string): Uint8Array {
  return parseMatter(b(qb64), "txt").raw;
}

function encodeFixedMatter(code: string, raw: Uint8Array): string {
  const cs = code.length;
  const ps = cs % 4;
  const body = toBase64Url(
    new Uint8Array(ps + raw.length).map((_, i) => i < ps ? 0 : raw[i - ps]),
  );
  return `${code}${body.slice(ps)}`;
}

function encodeIndexerEd25519Sig(
  rawSig: Uint8Array,
  index: number,
  ondex = index,
): string {
  const code = ondex === index ? "A" : "2A";
  if (code !== "A") {
    throw new Error("Only compact single-sig indexer encoding is implemented.");
  }
  const both = `${code}${intToB64(index, 1)}`;
  const ps = (3 - (rawSig.length % 3)) % 3;
  const body = toBase64Url(
    new Uint8Array(ps + rawSig.length).map((_, i) =>
      i < ps ? 0 : rawSig[i - ps]
    ),
  );
  return `${both}${body.slice(ps)}`;
}

function blake3Qb64(raw: Uint8Array, code = "E"): string {
  return encodeFixedMatter(code, blake3(raw));
}

function randomSaltQb64(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return encodeFixedMatter("0A", raw);
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

export function saltySigner(
  saltQb64: string,
  path: string,
  transferable: boolean,
  tier: string,
  temp: boolean,
): SignerMaterial {
  const seedRaw = deriveSeedFromSalt(saltQb64, path, tier, temp);
  const seedQb64 = encodeFixedMatter("A", seedRaw);
  const pubRaw = ed25519.getPublicKey(seedRaw);
  const verferQb64 = encodeFixedMatter(transferable ? "D" : "B", pubRaw);
  return { seedQb64, verferQb64 };
}

function pubsKey(pre: string, ridx: number): string {
  return `${pre}.${ridx.toString(16).padStart(32, "0")}`;
}

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
      const derivedAeid = encodeFixedMatter("B", ed25519.getPublicKey(seedRaw));
      if (derivedAeid !== aeid) {
        throw new Error(
          `Seed missing or provided seed not associated with aeid=${aeid}.`,
        );
      }
    }

    this.ks.pinGbls("aeid", aeid);
    this._seed = seed;
  }

  incept(args: ManagerInceptArgs = {}): [KeyVerfer[], KeyDiger[]] {
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

    const verfers: KeyVerfer[] = [];
    const digers: KeyDiger[] = [];

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
      verfers.push({ qb64: signer.verferQb64 });
      this.ks.putPris(signer.verferQb64, signer.seedQb64);
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
      const dig = blake3Qb64(
        b(signer.verferQb64),
        dcode,
      );
      digers.push({ qb64: dig });
      this.ks.putPris(signer.verferQb64, signer.seedQb64);
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
        pubs: verfers.map((v) => v.qb64),
        ridx: 0,
        kidx: 0,
        dt,
      },
      nxt: {
        pubs: digers.map((d) => d.qb64),
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

  sign(ser: Uint8Array, pubs: string[], indexed = true): string[] {
    return pubs.map((pub, idx) => {
      const seedQb64 = this.ks.getPris(pub);
      if (!seedQb64) throw new Error(`Missing prikey in db for pubkey=${pub}`);
      const seedRaw = parseQb64Raw(seedQb64);
      const sigRaw = ed25519.sign(ser, seedRaw);
      return indexed
        ? encodeIndexerEd25519Sig(sigRaw, idx, idx)
        : encodeFixedMatter("0B", sigRaw);
    });
  }
}

export function normalizeSaltQb64(salt?: string): string {
  return salt ? encodeFixedMatter("0A", parseQb64Raw(salt)) : randomSaltQb64();
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
  return encodeFixedMatter("0A", raw);
}

export function normalizeQb64Code(qb64: string): string {
  return encodeFixedMatter(
    parseMatter(b(qb64), "txt").code,
    parseQb64Raw(qb64),
  );
}

export function makeSaider(raw: Uint8Array): string {
  return blake3Qb64(raw, "E");
}

export function b64DecodeUrl(text: string): Uint8Array {
  return fromBase64Url(text);
}
