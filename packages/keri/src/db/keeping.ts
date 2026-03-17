import { type Operation } from "npm:effection@^3.6.0";
import type { Database } from "npm:lmdb@3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import { GroupMemberTuple } from "../core/records.ts";
import { LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";
import {
  CatCesrIoSetSuber,
  CesrSuber,
  CryptSignerSuber,
  Suber,
} from "./subing.ts";
import {
  Cipher,
  NumberPrimitive,
  Prefixer,
  Signer,
} from "../../../cesr/mod.ts";

/** Options for opening a keeper LMDB environment and its named subdb surface. */
export interface KeeperOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * One rotation-slot public-key set plus its replay metadata.
 *
 * KERIpy correspondence:
 * - mirrors the `PubLot` record shape used by keeper state records
 */
export interface PubLot {
  pubs: string[];
  ridx: number;
  kidx: number;
  dt: string;
}

/**
 * Keeper situation record for one prefix.
 *
 * KERIpy correspondence:
 * - mirrors `PreSit`
 *
 * Captures the old/current/next public-key lots used by the manager for local
 * replay and stateful key progression.
 */
export interface PreSit {
  old: PubLot;
  new: PubLot;
  nxt: PubLot;
}

/**
 * Keeper root-parameter record for one prefix.
 *
 * KERIpy correspondence:
 * - mirrors `PrePrm`
 *
 * Stores the deterministic key-derivation parameters needed to rehydrate local
 * key material for a managed identifier prefix.
 */
export interface PrePrm {
  pidx: number;
  algo: string;
  salt: string;
  stem: string;
  tier: string;
}

/** Ordered public-key set stored for one `(prefix, ridx)` replay key. */
export interface PubSet {
  pubs: string[];
}

/**
 * Keystore databaser for root parameters, per-prefix state, and secret-material
 * storage seams.
 *
 * Responsibilities:
 * - own the LMDB environment for keeper data
 * - bind typed wrappers for keeper globals, prefix metadata, and key material
 * - provide the storage substrate consumed by `Manager`
 *
 * Current `keri-ts` differences:
 * - active stores now open through `Suber`/`Komer` wrappers instead of raw
 *   named handles
 * - compatibility mode supports KERIpy `.keri/ks` layout visibility, but true
 *   encrypted secret semantics remain incomplete
 */
export class Keeper {
  private lmdber: LMDBer;
  private readonly logger: Logger;

  public gbls!: Suber;
  public pris!: CryptSignerSuber;
  public smids!: CatCesrIoSetSuber<GroupMemberTuple>;
  public rmids!: CatCesrIoSetSuber<GroupMemberTuple>;
  public pres!: CesrSuber<Prefixer>;
  public prms!: Komer<PrePrm>;
  public sits!: Komer<PreSit>;
  public pubs!: Komer<PubSet>;
  public prxs!: CesrSuber<Cipher>;
  public nxts!: CesrSuber<Cipher>;

  static readonly TailDirPath = "keri/ks";
  static readonly AltTailDirPath = ".tufa/ks";
  static readonly CompatAltTailDirPath = ".keri/ks";
  static readonly TempPrefix = "keri_ks_";
  static readonly MaxNamedDBs = 24;

  constructor(options: KeeperOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    const compat = options.compat ?? false;
    this.lmdber = new LMDBer(options, {
      tailDirPath: Keeper.TailDirPath,
      cleanTailDirPath: "keri/clean/ks",
      altTailDirPath: compat
        ? Keeper.CompatAltTailDirPath
        : Keeper.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/ks" : ".tufa/clean/ks",
      tempPrefix: Keeper.TempPrefix,
      maxNamedDBs: Keeper.MaxNamedDBs,
    });
  }

  get name(): string {
    return this.lmdber.name;
  }

  get base(): string {
    return this.lmdber.base;
  }

  get opened(): boolean {
    return this.lmdber.opened;
  }

  get readonly(): boolean {
    return this.lmdber.readonly;
  }

  get temp(): boolean {
    return this.lmdber.temp;
  }

  get path(): string | null {
    return this.lmdber.path;
  }

  /**
   * Reopen the keeper environment and bind the KERIpy-style named subdbs.
   *
   * Runtime-active stores today include globals, private/public key material,
   * prefix parameters/situations, and the group-member tuple stores. The rest
   * of the keeper surface remains parity-bound even where higher-level runtime
   * flows have not yet exercised it deeply.
   */
  *reopen(options: Partial<KeeperOptions> = {}): Operation<boolean> {
    const opened = yield* this.lmdber.reopen(options);
    if (!opened) return false;

    try {
      this.gbls = new Suber(this.lmdber, { subkey: "gbls." });
      this.pris = new CryptSignerSuber(this.lmdber, { subkey: "pris." });
      this.smids = new CatCesrIoSetSuber<GroupMemberTuple>(this.lmdber, {
        subkey: "smids.",
        klas: [Prefixer, NumberPrimitive],
      });
      this.rmids = new CatCesrIoSetSuber<GroupMemberTuple>(this.lmdber, {
        subkey: "rmids.",
        klas: [Prefixer, NumberPrimitive],
      });
      this.pres = new CesrSuber<Prefixer>(this.lmdber, {
        subkey: "pres.",
        klas: Prefixer,
      });
      this.prms = new Komer<PrePrm>(this.lmdber, { subkey: "prms." });
      this.sits = new Komer<PreSit>(this.lmdber, { subkey: "sits." });
      this.pubs = new Komer<PubSet>(this.lmdber, { subkey: "pubs." });
      this.prxs = new CesrSuber<Cipher>(this.lmdber, {
        subkey: "prxs.",
        klas: Cipher,
      });
      this.nxts = new CesrSuber<Cipher>(this.lmdber, {
        subkey: "nxts.",
        klas: Cipher,
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to open Keeper sub-databases: ${error}`);
      throw new DatabaseOperationError("Failed to open Keeper sub-databases", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  *close(clear = false): Operation<boolean> {
    return yield* this.lmdber.close(clear);
  }

  /** Read one keeper-global string value from `gbls.`. */
  getGbls(key: string): string | null {
    return this.gbls.get(key);
  }

  /** Upsert one keeper-global string value in `gbls.`. */
  pinGbls(key: string, value: string): boolean {
    return this.gbls.pin(key, value);
  }

  /** Insert the first public-key to prefix mapping in `pres.` if absent. */
  putPres(pre: string, val: string): boolean {
    return this.pres.put(pre, new Prefixer({ qb64: val }));
  }

  /** Upsert the first public-key to prefix mapping in `pres.`. */
  pinPres(pre: string, val: string): boolean {
    return this.pres.pin(pre, new Prefixer({ qb64: val }));
  }

  /** Read the stored prefixer projection from `pres.` as qb64 text. */
  getPres(pre: string): string | null {
    return this.pres.get(pre)?.qb64 ?? null;
  }

  /** Insert a signer seed in `pris.` keyed by its public key if absent. */
  putPris(pub: string, secret: string): boolean {
    return this.pris.put(pub, new Signer({ qb64: secret }));
  }

  /** Upsert a signer seed in `pris.` keyed by its public key. */
  pinPris(pub: string, secret: string): boolean {
    return this.pris.pin(pub, new Signer({ qb64: secret }));
  }

  /** Read a signer seed from `pris.` as qb64 text. */
  getPris(pub: string): string | null {
    return this.pris.get(pub)?.qb64 ?? null;
  }

  /** Insert one prefix-parameter record in `prms.` if absent. */
  putPrms(pre: string, val: PrePrm): boolean {
    return this.prms.put(pre, val);
  }

  /** Upsert one prefix-parameter record in `prms.`. */
  pinPrms(pre: string, val: PrePrm): boolean {
    return this.prms.pin(pre, val);
  }

  /** Read one prefix-parameter record from `prms.`. */
  getPrms(pre: string): PrePrm | null {
    return this.prms.get(pre);
  }

  /** Insert one prefix-situation record in `sits.` if absent. */
  putSits(pre: string, val: PreSit): boolean {
    return this.sits.put(pre, val);
  }

  /** Upsert one prefix-situation record in `sits.`. */
  pinSits(pre: string, val: PreSit): boolean {
    return this.sits.pin(pre, val);
  }

  /** Read one prefix-situation record from `sits.`. */
  getSits(pre: string): PreSit | null {
    return this.sits.get(pre);
  }

  /** Insert one replayable public-key set in `pubs.` if absent. */
  putPubs(key: string, val: PubSet): boolean {
    return this.pubs.put(key, val);
  }

  /** Upsert one replayable public-key set in `pubs.`. */
  pinPubs(key: string, val: PubSet): boolean {
    return this.pubs.pin(key, val);
  }

  /** Read one replayable public-key set from `pubs.`. */
  getPubs(key: string): PubSet | null {
    return this.pubs.get(key);
  }

  /**
   * Insert group-signing member tuples in `smids.` if absent.
   *
   * Each tuple is the narrow KERIpy shape `[Prefixer, NumberPrimitive]`, not a
   * widened `Matter` family placeholder.
   */
  putSmids(pre: string, vals: GroupMemberTuple[]): boolean {
    return this.smids.put(pre, vals);
  }

  /** Upsert group-signing member tuples in `smids.`. */
  pinSmids(pre: string, vals: GroupMemberTuple[]): boolean {
    return this.smids.pin(pre, vals);
  }

  /** Read group-signing member tuples from `smids.`. */
  getSmids(pre: string): GroupMemberTuple[] {
    return this.smids.get(pre);
  }

  /** Insert group-rotating member tuples in `rmids.` if absent. */
  putRmids(pre: string, vals: GroupMemberTuple[]): boolean {
    return this.rmids.put(pre, vals);
  }

  /** Upsert group-rotating member tuples in `rmids.`. */
  pinRmids(pre: string, vals: GroupMemberTuple[]): boolean {
    return this.rmids.pin(pre, vals);
  }

  /** Read group-rotating member tuples from `rmids.`. */
  getRmids(pre: string): GroupMemberTuple[] {
    return this.rmids.get(pre);
  }
}

/** Constructor-safe async factory for a fully reopened `Keeper`. */
export function* createKeeper(
  options: KeeperOptions = {},
): Operation<Keeper> {
  const keeper = new Keeper(options);
  const opened = yield* keeper.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Keeper");
  }
  return keeper;
}
