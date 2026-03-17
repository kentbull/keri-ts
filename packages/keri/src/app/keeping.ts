import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { argon2id } from "npm:@noble/hashes@1.8.0/argon2";
import {
  Cigar,
  decodeB64,
  Decrypter,
  Diger,
  Encrypter,
  hydrateMatter,
  intToB64,
  NumberPrimitive,
  NumDex,
  parseMatter,
  Saider,
  Salter,
  Siger,
  Signer,
  Verfer,
} from "../../../cesr/mod.ts";
import { b } from "../../../cesr/mod.ts";
import {
  decryptSaltQb64,
  encryptSaltQb64,
  ensureKeeperCryptoReady,
  makeDecrypterFromSeed,
  makeEncrypterFromAeid,
  seedMatchesAeid,
} from "../core/keeper-crypto.ts";
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
 * - AEID handling now includes real sealed-box encryption for keeper-global
 *   salt, per-prefix salts, and signer seeds, while keeping the encrypted
 *   runtime dependency local to the KERI package instead of CESR
 * - readonly opens intentionally avoid keeper mutation so visibility commands
 *   can inspect stores without side effects
 */
export class Manager {
  private _seed: string;
  private _ks: Keeper;
  /** Public box key derived from AEID; used only when writing encrypted secrets. */
  private encrypter: Encrypter | null = null;
  /** Private box key derived from passcode/seed; required for encrypted reads. */
  private decrypter: Decrypter | null = null;

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

  /**
   * Keeper-global root salt.
   *
   * Storage invariant:
   * - plaintext qb64 when no AEID encryption is active
   * - `X25519_Cipher_Salt` qb64 when a decrypter/encrypter pair is active
   *
   * Caller contract:
   * - callers always see canonical plaintext salt qb64 from this getter
   * - the encrypted/plain distinction is strictly an at-rest concern
   */
  get salt(): string | null {
    const salt = this.ks.getGbls("salt");
    if (salt === null) {
      return null;
    }
    return this.decrypter ? decryptSaltQb64(salt, this.decrypter) : salt;
  }

  set salt(salt: string) {
    this.ks.pinGbls(
      "salt",
      this.encrypter ? encryptSaltQb64(salt, this.encrypter).qb64 : salt,
    );
  }

  get tier(): string | null {
    return this.ks.getGbls("tier");
  }

  set tier(tier: string) {
    this.ks.pinGbls("tier", tier);
  }

  /**
   * Initialize or reopen manager encryption state against the underlying keeper.
   *
   * Reopen rules:
   * - if the keeper has never stored an AEID, first-time initialization may set
   *   one unless the keeper is readonly
   * - if the keeper already has an AEID, the caller must supply a seed/passcode
   *   that proves possession of the matching decrypt key
   * - readonly opens never rewrite keeper globals, even when the caller also
   *   provides AEID input
   *
   * Maintainer warning:
   * This is the place where "seed means process-local input" meets
   * "AEID means persistent keeper policy". Be careful not to collapse those two
   * concepts or readonly visibility commands will start mutating stores again.
   */
  setup(aeid = "", seed = ""): void {
    ensureKeeperCryptoReady();
    const storedAeid = this.aeid;

    if (!storedAeid) {
      if (!this.ks.readonly) {
        this.updateAeid(aeid, seed);
      }
      return;
    }

    this.encrypter = makeEncrypterFromAeid(storedAeid);
    if (!seed || !seedMatchesAeid(seed, storedAeid)) {
      throw new Error(
        `Last seed missing or provided last seed not associated with last aeid=${storedAeid}.`,
      );
    }

    this._seed = seed;
    this.decrypter = makeDecrypterFromSeed(seed);

    if (!this.ks.readonly && aeid && aeid !== storedAeid) {
      this.updateAeid(aeid, seed);
    }
  }

  /**
   * Change keeper AEID policy and re-encrypt every affected secret in place.
   *
   * Re-encryption scope:
   * - keeper-global root salt in `gbls.salt`
   * - per-prefix salts in `prms.salt`
   * - signer seeds in `pris.`
   *
   * Behavior matrix:
   * - `current AEID -> same AEID`: validate and keep stable
   * - `current AEID -> new AEID`: decrypt with old seed, re-encrypt with new
   *   public box key
   * - `current AEID -> empty`: decrypt and persist plaintext secrets
   * - `empty -> new AEID`: encrypt newly managed secrets going forward
   *
   * Failure model:
   * - current seed must authenticate the currently stored AEID before any
   *   secret migration is attempted
   * - new seed must authenticate the new AEID before any re-encryption is
   *   attempted
   */
  updateAeid(aeid: string, seed: string): void {
    ensureKeeperCryptoReady();
    const currentAeid = this.aeid;

    if (currentAeid) {
      if (!this.seed || !this.encrypter || !seedMatchesAeid(this.seed, currentAeid)) {
        throw new Error(
          `Last seed missing or provided last seed not associated with last aeid=${currentAeid}.`,
        );
      }
    }

    if (aeid) {
      if (!seed || !seedMatchesAeid(seed, aeid)) {
        throw new Error(
          `Seed missing or provided seed not associated with aeid=${aeid}.`,
        );
      }
      this.encrypter = makeEncrypterFromAeid(aeid);
    } else {
      this.encrypter = null;
    }

    const salt = this.salt;
    if (salt !== null) {
      this.salt = salt;
    }

    if (this.decrypter) {
      // `prms.salt` stores derivation salt per managed prefix, so AEID changes
      // must migrate that state in lockstep with keeper-global salt.
      for (const [keys, data] of this.ks.prms.getTopItemIter()) {
        if (!data.salt) {
          continue;
        }
        data.salt = this.encrypter
          ? encryptSaltQb64(
            decryptSaltQb64(data.salt, this.decrypter),
            this.encrypter,
          ).qb64
          : decryptSaltQb64(data.salt, this.decrypter);
        this.ks.prms.pin(keys, data);
      }

      // `pris.` stores signer seeds keyed by their public verifier. Reads here
      // are intentionally plaintext through the decrypter so the subdb can
      // immediately re-pin under the new encryption policy.
      for (const [keys, signer] of this.ks.pris.getTopItemIter("", this.decrypter)) {
        this.ks.pris.pin(keys, signer, this.encrypter ?? undefined);
      }
    }

    this._seed = seed;
    this.decrypter = seed ? makeDecrypterFromSeed(seed) : null;

    if (this.ks.readonly) {
      return;
    }
    this.ks.pinGbls("aeid", aeid);
  }

  /**
   * Create current and next key material for one new managed prefix.
   *
   * Gate D note:
   * - when keeper encryption is active, signer seeds are written into `pris.`
   *   as sealed-box ciphertext and the persisted prefix parameters store an
   *   encrypted salt
   * - returned `Verfer`/`Diger` values remain plaintext semantic objects
   *   because encryption is only an at-rest concern
   */
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
      this.ks.putPris(
        signer.verfer.qb64,
        signer.signer.qb64,
        this.encrypter ?? undefined,
      );
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
      this.ks.putPris(
        signer.verfer.qb64,
        signer.signer.qb64,
        this.encrypter ?? undefined,
      );
    }

    const pp: PrePrm = {
      pidx,
      algo: usedAlgo,
      salt: this.encrypter
        ? encryptSaltQb64(usedSalt, this.encrypter).qb64
        : usedSalt,
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
      return this.signIndexed(ser, pubs);
    }
    return this.signUnindexed(ser, pubs);
  }

  /**
   * Build indexed controller signatures in stable key-list order.
   *
   * Security invariant:
   * - when AEID encryption is active, signing is not allowed to silently fall
   *   through to "missing key" behavior without a decrypter
   * - this keeps wrong-open / unauthorized-open failures distinct from actual
   *   DB corruption or missing-key conditions
   */
  private signIndexed(ser: Uint8Array, pubs: string[]): Siger[] {
    if (this.aeid && !this.decrypter) {
      throw new Error("Unauthorized decryption attempt. Aeid but no decrypter.");
    }
    const sigers: Siger[] = [];
    for (const [idx, pub] of pubs.entries()) {
      const seedQb64 = this.ks.getPris(pub, this.decrypter ?? undefined);
      if (!seedQb64) {
        throw new Error(`Missing prikey in db for pubkey=${pub}`);
      }
      const seedRaw = parseQb64Raw(seedQb64);
      const sigRaw = ed25519.sign(ser, seedRaw);
      sigers.push(new Siger({ code: "A", raw: sigRaw, index: idx }));
    }
    return sigers;
  }

  /**
   * Build unindexed detached signatures for ad hoc message signing flows.
   *
   * Uses the same auth boundary as indexed signing: encrypted keeper state must
   * already be unlocked before detached signatures are attempted.
   */
  private signUnindexed(ser: Uint8Array, pubs: string[]): Cigar[] {
    if (this.aeid && !this.decrypter) {
      throw new Error("Unauthorized decryption attempt. Aeid but no decrypter.");
    }
    const cigars: Cigar[] = [];
    for (const pub of pubs) {
      const seedQb64 = this.ks.getPris(pub, this.decrypter ?? undefined);
      if (!seedQb64) {
        throw new Error(`Missing prikey in db for pubkey=${pub}`);
      }
      const seedRaw = parseQb64Raw(seedQb64);
      const sigRaw = ed25519.sign(ser, seedRaw);
      cigars.push(new Cigar({ code: "0B", raw: sigRaw }));
    }
    return cigars;
  }
}

/** Normalize caller-provided salt material or synthesize a new random salt. */
export function normalizeSaltQb64(salt?: string): string {
  return salt
    ? new Salter({ code: "0A", raw: parseQb64Raw(salt) }).qb64
    : randomSaltQb64();
}

/** Convert a 21-char passcode seed slice into KERI's 128-bit salt qb64 text. */
export function branToSaltQb64(bran: string): string {
  if (bran.length < 21) {
    throw new Error("Bran (passcode seed material) too short.");
  }
  return `0AA${bran.slice(0, 21)}`;
}

/** Encode an ISO datetime into the qualified `Dater` text form used in KERI DB records. */
export function encodeDateTimeToDater(dts: string): string {
  return `1AAG${dts.replace(/:/g, "c").replace(/\./g, "d").replace(/\+/g, "p")}`;
}

/** Encode one v1 counter token directly when higher layers already know code/count. */
export function encodeCounterV1(code: string, count: number): string {
  return `${code}${intToB64(count, 2)}`;
}

/** Encode one large ordinal through the CESR Huge-number primitive family. */
export function encodeHugeNumber(num: number): string {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = 15; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw }).qb64;
}

/** Rehydrate one qb64 text token through the primitive layer to normalize its effective code. */
export function normalizeQb64Code(qb64: string): string {
  return hydrateMatter(parseMatter(b(qb64), "txt")).qb64;
}

/** Build a Blake3-256 SAID directly from raw bytes for local record helpers. */
export function makeSaider(raw: Uint8Array): string {
  return new Saider({ code: "E", raw: Diger.digest(raw, "E") }).qb64;
}

/** Decode URL-safe base64 text using the CESR byte helper semantics. */
export function b64DecodeUrl(text: string): Uint8Array {
  return decodeB64(text);
}

export { ensureKeeperCryptoReady };
