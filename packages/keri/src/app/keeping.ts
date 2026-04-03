import {
  Cigar,
  decodeB64,
  Decrypter,
  Diger,
  Encrypter,
  hydrateMatter,
  intToB64,
  MtrDex,
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
  decryptCipherQb64b,
  decryptSaltQb64,
  encryptSaltQb64,
  ensureKeeperCryptoReady,
  makeDecrypterFromSeed,
  makeDecrypterFromSigner,
  makeEncrypterFromAeid,
  seedMatchesAeid,
} from "../core/keeper-crypto.ts";
import { Keeper, PrePrm, PreSit } from "../db/keeping.ts";

/**
 * Root key-creation strategy selectors stored in keeper globals.
 *
 * `randy` and `salty` are implemented in the current TS port. The others are
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
 * This is the TypeScript option-object surface corresponding to KERIpy's
 * richer incept contract: enough for the implemented `randy`/`salty` creator
 * paths across the supported signing suites, but not yet the full keeper
 * algorithm matrix.
 */
export interface ManagerInceptArgs {
  icodes?: string[];
  icount?: number;
  ncodes?: string[];
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

export interface ManagerRotateArgs {
  pre: string;
  ncodes?: string[];
  ncount?: number;
  ncode?: string;
  dcode?: string;
  transferable?: boolean;
  temp?: boolean;
  erase?: boolean;
}

export interface ManagerSignArgs {
  pubs?: string[];
  verfers?: Verfer[];
  indexed?: boolean;
  indices?: number[];
  ondices?: Array<number | null | undefined>;
  pre?: string;
  path?: string;
}

export interface ManagerDecryptArgs {
  pubs?: string[];
  verfers?: Verfer[];
}

export interface ManagerIngestArgs {
  secrecies: string[][];
  iridx?: number;
  ncount?: number;
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

export interface ManagerReplayArgs {
  pre: string;
  dcode?: string;
  advance?: boolean;
  erase?: boolean;
}

export interface CreatorCreateArgs {
  codes?: string[];
  count?: number;
  code?: string;
  pidx?: number;
  ridx?: number;
  kidx?: number;
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
  return new Salter({ code: MtrDex.Salt_128, raw }).qb64;
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
  return saltySignerForCode(
    saltQb64,
    path,
    "A",
    transferable,
    tier,
    temp,
  );
}

/**
 * Derive a deterministic signer pair for the requested CESR seed-suite code.
 *
 * This is the keeper-facing multi-suite salty seam used by managed identifier
 * inception. The public `saltySigner()` export remains the Ed25519 convenience
 * for signator and AEID-local flows.
 */
function saltySignerForCode(
  saltQb64: string,
  path: string,
  signerCode: string,
  transferable: boolean,
  tier: string,
  temp: boolean,
): SignerMaterial {
  const signer = new Salter({ qb64: saltQb64, tier }).signer({
    code: signerCode,
    transferable,
    path,
    tier,
    temp,
  });
  return { signer, verfer: signer.verfer };
}

/** Base key-creation strategy seam mirrored from KERIpy's creator hierarchy. */
export class Creator {
  create(_args: CreatorCreateArgs = {}): Signer[] {
    return [];
  }

  get salt(): string {
    return "";
  }

  get stem(): string {
    return "";
  }

  get tier(): string {
    return "";
  }
}

/** Random signer creator that makes one fresh seed per requested suite. */
export class RandyCreator extends Creator {
  override create({
    codes,
    count = 1,
    code = MtrDex.Ed25519_Seed,
    transferable = true,
  }: CreatorCreateArgs = {}): Signer[] {
    const effectiveCodes = codes ?? Array.from({ length: count }, () => code);
    return effectiveCodes.map((suite) => Signer.random({ code: suite, transferable }));
  }
}

/** Deterministic salty creator that derives signers from one salt and path policy. */
export class SaltyCreator extends Creator {
  readonly salter: Salter;
  private readonly _stem: string;

  constructor(
    { salt, stem, tier }: { salt?: string; stem?: string; tier?: string } = {},
  ) {
    super();
    this.salter = new Salter({
      qb64: normalizeSaltQb64(salt),
      tier: tier ?? "low",
    });
    this._stem = stem ?? "";
  }

  override get salt(): string {
    return this.salter.qb64;
  }

  override get stem(): string {
    return this._stem;
  }

  override get tier(): string {
    return this.salter.tier;
  }

  override create({
    codes,
    count = 1,
    code = MtrDex.Ed25519_Seed,
    pidx = 0,
    ridx = 0,
    kidx = 0,
    transferable = true,
    temp = false,
  }: CreatorCreateArgs = {}): Signer[] {
    const effectiveCodes = codes ?? Array.from({ length: count }, () => code);
    const stem = this.stem || pidx.toString(16);
    return effectiveCodes.map((suite, offset) =>
      this.salter.signer({
        code: suite,
        transferable,
        path: `${stem}${ridx.toString(16)}${(kidx + offset).toString(16)}`,
        tier: this.tier,
        temp,
      })
    );
  }
}

/** Creator factory mirrored from KERIpy's `Creatory`. */
export class Creatory {
  constructor(private readonly algo: Algos = Algos.salty) {}

  make(
    { salt, stem, tier }: { salt?: string; stem?: string; tier?: string } = {},
  ): Creator {
    if (this.algo === Algos.randy) {
      return new RandyCreator();
    }
    if (this.algo === Algos.salty) {
      return new SaltyCreator({ salt, stem, tier });
    }
    throw new Error(`Unsupported creation algorithm =${this.algo}.`);
  }
}

function pubsKey(pre: string, ridx: number): string {
  return `${pre}.${ridx.toString(16).padStart(32, "0")}`;
}

function digersForPubs(pubs: string[], dcode: string): Diger[] {
  return pubs.map((pub) =>
    new Diger({
      code: dcode,
      raw: Diger.digest(b(pub), dcode),
    })
  );
}

function resolveSuiteCodes(
  codes: string[] | undefined,
  count: number,
  code: string,
  {
    label,
    allowZero = false,
  }: { label: string; allowZero?: boolean },
): string[] {
  if (codes && codes.length > 0) {
    return [...codes];
  }
  if ((!allowZero && count <= 0) || (allowZero && count < 0)) {
    throw new Error(`Invalid ${label}=${count} must be ${allowZero ? ">=" : ">"} 0.`);
  }
  return Array.from({ length: count }, () => code);
}

function emptyLot(dt = ""): { pubs: string[]; ridx: number; kidx: number; dt: string } {
  return { pubs: [], ridx: 0, kidx: 0, dt };
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
 * - `randy` and `salty` creator algorithms are live; `group` and `extern`
 *   remain explicit unsupported-algorithm seams
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
      if (
        !this.seed || !this.encrypter
        || !seedMatchesAeid(this.seed, currentAeid)
      ) {
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
      for (
        const [keys, signer] of this.ks.pris.getTopItemIter("", this.decrypter)
      ) {
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

  private signerDecrypter(): Decrypter | undefined {
    if (this.aeid && !this.decrypter) {
      throw new Error(
        "Unauthorized decryption attempt. Aeid but no decrypter.",
      );
    }
    return this.decrypter ?? undefined;
  }

  private getSignerByPub(pub: string): Signer {
    const signer = this.ks.pris.get(pub, this.signerDecrypter());
    if (!signer) {
      throw new Error(`Missing prikey in db for pubkey=${pub}`);
    }
    return signer;
  }

  private getSigners(
    { pubs, verfers }: Pick<ManagerSignArgs | ManagerDecryptArgs, "pubs" | "verfers">,
  ): Signer[] {
    if (pubs && pubs.length > 0) {
      return pubs.map((pub) => this.getSignerByPub(pub));
    }
    if (verfers && verfers.length > 0) {
      return verfers.map((verfer) => this.getSignerByPub(verfer.qb64));
    }
    return [];
  }

  private decryptPreSalt(salt: string): string {
    if (!salt) {
      return "";
    }
    const decrypter = this.signerDecrypter();
    return decrypter ? decryptSaltQb64(salt, decrypter) : new Salter({ qb64: salt }).qb64;
  }

  /**
   * Create current and next key material for one new managed prefix.
   *
   * Keeper-state parity:
   * - `ps.nxt.pubs` now stores next public keys, not next digests
   * - returned digers are derived from those stored next public keys on demand
   */
  incept(args: ManagerInceptArgs = {}): [Verfer[], Diger[]] {
    const {
      icodes,
      icount = 1,
      icode = MtrDex.Ed25519_Seed,
      ncodes,
      ncount = 1,
      ncode = icode,
      dcode = MtrDex.Blake3_256,
      algo,
      salt,
      stem,
      tier,
      rooted = true,
      transferable = true,
      temp = false,
    } = args;

    const usedAlgo = rooted
      ? (algo ?? this.algo ?? Algos.salty)
      : (algo ?? Algos.salty);
    const usedSalt = usedAlgo === Algos.salty
      ? rooted
        ? normalizeSaltQb64(salt ?? this.salt ?? undefined)
        : normalizeSaltQb64(salt)
      : "";
    const usedTier = rooted ? (tier ?? this.tier ?? "low") : (tier ?? "low");
    const pidx = this.pidx ?? 0;
    const creator = new Creatory(usedAlgo).make({
      salt: usedSalt || undefined,
      stem,
      tier: usedTier,
    });

    const inceptionCodes = resolveSuiteCodes(icodes, icount, icode, {
      label: "icount",
    });
    const isigners = creator.create({
      codes: inceptionCodes,
      pidx,
      ridx: 0,
      kidx: 0,
      transferable,
      temp,
    });
    const verfers = isigners.map((signer) => signer.verfer);

    const nextCodes = resolveSuiteCodes(ncodes, ncount, ncode, {
      label: "ncount",
      allowZero: true,
    });
    const nsigners = creator.create({
      codes: nextCodes,
      count: 0,
      pidx,
      ridx: 1,
      kidx: isigners.length,
      transferable,
      temp,
    });
    const nextPubs = nsigners.map((signer) => signer.verfer.qb64);
    const digers = digersForPubs(nextPubs, dcode);

    const pp: PrePrm = {
      pidx,
      algo: usedAlgo,
      salt: creator.salt
        ? (this.encrypter
          ? encryptSaltQb64(creator.salt, this.encrypter).qb64
          : creator.salt)
        : "",
      stem: creator.stem,
      tier: creator.tier,
    };

    const dt = new Date().toISOString();
    const ps: PreSit = {
      old: emptyLot(dt),
      new: {
        pubs: verfers.map((verfer) => verfer.qb64),
        ridx: 0,
        kidx: 0,
        dt,
      },
      nxt: {
        pubs: nextPubs,
        ridx: 1,
        kidx: isigners.length,
        dt,
      },
    };

    const opre = verfers[0]?.qb64;
    if (!opre) {
      throw new Error("Invalid incept configuration produced no current verfers.");
    }
    if (!this.ks.putPres(opre, opre)) {
      throw new Error(`Already incepted pre=${opre}.`);
    }
    if (!this.ks.putPrms(opre, pp)) {
      throw new Error(`Already incepted prm for pre=${opre}.`);
    }
    if (!this.ks.putSits(opre, ps)) {
      throw new Error(`Already incepted sit for pre=${opre}.`);
    }

    for (const signer of [...isigners, ...nsigners]) {
      this.ks.pris.put(
        signer.verfer.qb64,
        signer,
        this.encrypter ?? undefined,
      );
    }

    this.ks.putPubs(pubsKey(opre, 0), { pubs: ps.new.pubs });
    this.ks.putPubs(pubsKey(opre, 1), { pubs: ps.nxt.pubs });
    this.pidx = pidx + 1;
    return [verfers, digers];
  }

  move(oldPre: string, newPre: string): void {
    if (oldPre === newPre) return;
    if (this.ks.getPres(oldPre) === null) {
      throw new Error(`Nonexistent old pre=${oldPre}, nothing to assign.`);
    }
    if (this.ks.getPres(newPre) !== null) {
      throw new Error(`Preexistent new pre=${newPre} may not clobber.`);
    }

    const oldPrm = this.ks.getPrms(oldPre);
    if (!oldPrm) {
      throw new Error(`Nonexistent old prm for pre=${oldPre}, nothing to move.`);
    }
    if (this.ks.getPrms(newPre) !== null) {
      throw new Error(`Preexistent new prm for pre=${newPre} may not clobber.`);
    }

    const oldSit = this.ks.getSits(oldPre);
    if (!oldSit) {
      throw new Error(`Nonexistent old sit for pre=${oldPre}, nothing to move.`);
    }
    if (this.ks.getSits(newPre) !== null) {
      throw new Error(`Preexistent new sit for pre=${newPre} may not clobber.`);
    }

    if (!this.ks.putPrms(newPre, oldPrm)) {
      throw new Error(`Failed moving prm from old pre=${oldPre} to new pre=${newPre}.`);
    }
    this.ks.prms.rem(oldPre);

    if (!this.ks.putSits(newPre, oldSit)) {
      throw new Error(`Failed moving sit from old pre=${oldPre} to new pre=${newPre}.`);
    }
    this.ks.sits.rem(oldPre);

    let ri = 0;
    while (true) {
      const pubset = this.ks.getPubs(pubsKey(oldPre, ri));
      if (!pubset) {
        break;
      }
      if (!this.ks.putPubs(pubsKey(newPre, ri), pubset)) {
        throw new Error(`Failed moving pubs at pre=${oldPre} ri=${ri} to new pre=${newPre}.`);
      }
      ri += 1;
    }

    if (!this.ks.pinPres(oldPre, newPre)) {
      throw new Error(`Failed assigning new pre=${newPre} to old pre=${oldPre}.`);
    }
    if (!this.ks.putPres(newPre, newPre)) {
      throw new Error(`Failed assigning new pre=${newPre}.`);
    }
  }

  rotate(args: ManagerRotateArgs): [Verfer[], Diger[]] {
    const {
      pre,
      ncodes,
      ncount = 1,
      ncode = MtrDex.Ed25519_Seed,
      dcode = MtrDex.Blake3_256,
      transferable = true,
      temp = false,
      erase = true,
    } = args;

    const pp = this.ks.getPrms(pre);
    if (!pp) {
      throw new Error(`Attempt to rotate nonexistent pre=${pre}.`);
    }
    const ps = this.ks.getSits(pre);
    if (!ps) {
      throw new Error(`Attempt to rotate nonexistent pre=${pre}.`);
    }
    if (!ps.nxt.pubs.length) {
      throw new Error(`Attempt to rotate nontransferable pre=${pre}.`);
    }

    const old = ps.old;
    ps.old = ps.new;
    ps.new = ps.nxt;

    const verfers = ps.new.pubs.map((pub) => this.getSignerByPub(pub).verfer);
    const creator = new Creatory(pp.algo as Algos).make({
      salt: pp.salt ? this.decryptPreSalt(pp.salt) : undefined,
      stem: pp.stem,
      tier: pp.tier,
    });

    const nextCodes = resolveSuiteCodes(ncodes, ncount, ncode, {
      label: "ncount",
      allowZero: true,
    });
    const ridx = ps.new.ridx + 1;
    const kidx = ps.nxt.kidx + ps.new.pubs.length;
    const signers = creator.create({
      codes: nextCodes,
      count: 0,
      pidx: pp.pidx,
      ridx,
      kidx,
      transferable,
      temp,
    });
    const nextPubs = signers.map((signer) => signer.verfer.qb64);
    const digers = digersForPubs(nextPubs, dcode);

    ps.nxt = {
      pubs: nextPubs,
      ridx,
      kidx,
      dt: new Date().toISOString(),
    };
    if (!this.ks.pinSits(pre, ps)) {
      throw new Error(`Problem updating pubsit db for pre=${pre}.`);
    }

    for (const signer of signers) {
      this.ks.pris.put(
        signer.verfer.qb64,
        signer,
        this.encrypter ?? undefined,
      );
    }
    this.ks.putPubs(pubsKey(pre, ps.nxt.ridx), { pubs: ps.nxt.pubs });

    if (erase) {
      for (const pub of old.pubs) {
        this.ks.pris.rem(pub);
      }
    }

    return [verfers, digers];
  }

  sign(ser: Uint8Array, pubs: string[], indexed: true): Siger[];
  sign(ser: Uint8Array, pubs: string[], indexed?: false): Cigar[];
  sign(ser: Uint8Array, args: ManagerSignArgs & { indexed: true }): Siger[];
  sign(ser: Uint8Array, args?: ManagerSignArgs): Siger[] | Cigar[];
  sign(
    ser: Uint8Array,
    pubsOrArgs: string[] | ManagerSignArgs = [],
    indexed = true,
  ): Siger[] | Cigar[] {
    const args = Array.isArray(pubsOrArgs)
      ? { pubs: pubsOrArgs, indexed }
      : pubsOrArgs;
    const signers = this.getSigners(args);

    if (!signers.length) {
      if (args.pre || args.path) {
        throw new Error("Manager.sign derived-path signing is not implemented yet.");
      }
      throw new Error("pubs or verfers or pre required");
    }

    if (args.indices && args.indices.length !== signers.length) {
      throw new Error(
        `Mismatch indices length=${args.indices.length} and resultant signers length=${signers.length}`,
      );
    }
    if (args.ondices && args.ondices.length !== signers.length) {
      throw new Error(
        `Mismatch ondices length=${args.ondices.length} and resultant signers length=${signers.length}`,
      );
    }

    if (args.indexed === false) {
      return signers.map((signer) => signer.sign(ser) as Cigar);
    }

    return signers.map((signer, idx) => {
      const index = args.indices ? args.indices[idx] : idx;
      if (
        typeof index !== "number" || !Number.isInteger(index) || index < 0
      ) {
        throw new Error(`Invalid signing index = ${index}, not whole number.`);
      }

      if (!args.ondices) {
        return signer.sign(ser, { index, only: false, ondex: index }) as Siger;
      }

      const ondex = args.ondices[idx];
      if (ondex === null) {
        return signer.sign(ser, { index, only: true }) as Siger;
      }
      if (
        typeof ondex !== "number" || !Number.isInteger(ondex) || ondex < 0
      ) {
        throw new Error(
          `Invalid other signing index = ${ondex}, not None or not whole number.`,
        );
      }
      return signer.sign(ser, { index, only: false, ondex }) as Siger;
    });
  }

  decrypt(
    qb64: string | Uint8Array,
    args: ManagerDecryptArgs = {},
  ): Uint8Array {
    const signers = this.getSigners(args);
    if (!signers.length) {
      throw new Error("pubs or verfers required");
    }

    let plain: Uint8Array | null = null;
    for (const signer of signers) {
      if (signer.code !== MtrDex.Ed25519_Seed) {
        throw new Error(
          `Unsupported decrypt signer code=${signer.code}. Keeper decrypt requires Ed25519 seeds.`,
        );
      }
      plain = decryptCipherQb64b(qb64, makeDecrypterFromSigner(signer));
    }

    if (plain === null) {
      throw new Error("Unable to decrypt.");
    }
    return plain;
  }

  ingest(args: ManagerIngestArgs): [string, Verfer[][]] {
    const {
      secrecies,
      iridx = 0,
      ncount = 1,
      ncode = MtrDex.Ed25519_Seed,
      dcode = MtrDex.Blake3_256,
      algo,
      salt,
      stem,
      tier,
      rooted = true,
      transferable = true,
      temp = false,
    } = args;

    if (iridx > secrecies.length) {
      throw new Error(`Initial ridx=${iridx} beyond last secrecy.`);
    }

    const usedAlgo = rooted
      ? (algo ?? this.algo ?? Algos.salty)
      : (algo ?? Algos.salty);
    const usedSalt = usedAlgo === Algos.salty
      ? rooted
        ? normalizeSaltQb64(salt ?? this.salt ?? undefined)
        : normalizeSaltQb64(salt)
      : "";
    const usedTier = rooted ? (tier ?? this.tier ?? "low") : (tier ?? "low");
    const pidx = this.pidx ?? 0;
    const creator = new Creatory(usedAlgo).make({
      salt: usedSalt || undefined,
      stem,
      tier: usedTier,
    });

    let ipre = "";
    let pre = "";
    let ridx = 0;
    let kidx = 0;
    const verferies: Verfer[][] = [];
    let first = true;

    for (const secrecy of secrecies) {
      const csigners = secrecy.map((secret) => new Signer({ qb64: secret, transferable }));
      const pubs = csigners.map((signer) => signer.verfer.qb64);
      const dt = new Date().toISOString();
      verferies.push(csigners.map((signer) => signer.verfer));

      if (first) {
        const pp: PrePrm = {
          pidx,
          algo: usedAlgo,
          salt: creator.salt
            ? (this.encrypter
              ? encryptSaltQb64(creator.salt, this.encrypter).qb64
              : creator.salt)
            : "",
          stem: creator.stem,
          tier: creator.tier,
        };
        pre = csigners[0]?.verfer.qb64 ?? "";
        ipre = pre;
        if (!pre) {
          throw new Error("Invalid ingest input produced no prefix.");
        }
        if (!this.ks.putPres(pre, pre)) {
          throw new Error(`Already incepted pre=${pre}.`);
        }
        if (!this.ks.putPrms(pre, pp)) {
          throw new Error(`Already incepted prm for pre=${pre}.`);
        }
        this.pidx = pidx + 1;
        first = false;
      }

      for (const signer of csigners) {
        this.ks.pris.put(
          signer.verfer.qb64,
          signer,
          this.encrypter ?? undefined,
        );
      }
      this.ks.putPubs(pubsKey(pre, ridx), { pubs });

      if (ridx === Math.max(iridx - 1, 0)) {
        const old = iridx === 0
          ? emptyLot()
          : { pubs, ridx, kidx, dt };
        const ps: PreSit = {
          old,
          new: emptyLot(),
          nxt: emptyLot(),
        };
        if (!this.ks.pinSits(pre, ps)) {
          throw new Error(`Problem updating pubsit db for pre=${pre}.`);
        }
      }

      if (ridx === iridx) {
        const ps = this.ks.getSits(pre);
        if (!ps) {
          throw new Error(`Attempt to rotate nonexistent pre=${pre}.`);
        }
        ps.new = { pubs, ridx, kidx, dt };
        if (!this.ks.pinSits(pre, ps)) {
          throw new Error(`Problem updating pubsit db for pre=${pre}.`);
        }
      }

      if (ridx === iridx + 1) {
        const ps = this.ks.getSits(pre);
        if (!ps) {
          throw new Error(`Attempt to rotate nonexistent pre=${pre}.`);
        }
        ps.nxt = { pubs, ridx, kidx, dt };
        if (!this.ks.pinSits(pre, ps)) {
          throw new Error(`Problem updating pubsit db for pre=${pre}.`);
        }
      }

      ridx += 1;
      kidx += csigners.length;
    }

    const nsigners = creator.create({
      count: ncount,
      code: ncode,
      pidx,
      ridx,
      kidx,
      transferable,
      temp,
    });
    const pubs = nsigners.map((signer) => signer.verfer.qb64);
    for (const signer of nsigners) {
      this.ks.pris.put(
        signer.verfer.qb64,
        signer,
        this.encrypter ?? undefined,
      );
    }
    this.ks.putPubs(pubsKey(pre, ridx), { pubs });

    if (ridx === iridx + 1) {
      const ps = this.ks.getSits(pre);
      if (!ps) {
        throw new Error(`Attempt to rotate nonexistent pre=${pre}.`);
      }
      ps.nxt = { pubs, ridx, kidx, dt: new Date().toISOString() };
      if (!this.ks.pinSits(pre, ps)) {
        throw new Error(`Problem updating pubsit db for pre=${pre}.`);
      }
    }

    void dcode; // digers are derived at replay/rotation time; keeper state stores next pubs.
    return [ipre, verferies];
  }

  replay(args: ManagerReplayArgs): [Verfer[], Diger[]] {
    const {
      pre,
      dcode = MtrDex.Blake3_256,
      advance = true,
      erase = true,
    } = args;

    const pp = this.ks.getPrms(pre);
    if (!pp) {
      throw new Error(`Attempt to replay nonexistent pre=${pre}.`);
    }
    const ps = this.ks.getSits(pre);
    if (!ps) {
      throw new Error(`Attempt to replay nonexistent pre=${pre}.`);
    }
    void pp;

    let old = ps.old;
    if (advance) {
      old = ps.old;
      ps.old = ps.new;
      ps.new = ps.nxt;
      const ridx = ps.new.ridx;
      const kidx = ps.new.kidx;
      const csize = ps.new.pubs.length;
      const pubset = this.ks.getPubs(pubsKey(pre, ridx + 1));
      if (!pubset) {
        throw new RangeError(`Invalid replay attempt of pre=${pre} at ridx=${ridx}.`);
      }
      ps.nxt = {
        pubs: pubset.pubs,
        ridx: ridx + 1,
        kidx: kidx + csize,
        dt: new Date().toISOString(),
      };
    }

    const verfers = ps.new.pubs.map((pub) => this.getSignerByPub(pub).verfer);
    const digers = digersForPubs(ps.nxt.pubs, dcode);

    if (advance) {
      if (!this.ks.pinSits(pre, ps)) {
        throw new Error(`Problem updating pubsit db for pre=${pre}.`);
      }
      if (erase) {
        for (const pub of old.pubs) {
          this.ks.pris.rem(pub);
        }
      }
    }

    return [verfers, digers];
  }
}

/** Normalize caller-provided salt material or synthesize a new random salt. */
export function normalizeSaltQb64(salt?: string): string {
  return salt
    ? new Salter({ code: MtrDex.Salt_128, raw: parseQb64Raw(salt) }).qb64
    : randomSaltQb64();
}

/** Convert a 21-char passcode seed slice into KERI's 128-bit salt qb64 text. */
export function branToSaltQb64(bran: string): string {
  if (bran.length < 21) {
    throw new Error("Bran (passcode seed material) too short.");
  }
  return `0AA${bran.slice(0, 21)}`;
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
