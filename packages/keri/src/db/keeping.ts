import { type Operation } from "npm:effection@^3.6.0";
import type { Database } from "npm:lmdb@3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import { LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";
import { CesrSuber, CryptSignerSuber, Suber } from "./subing.ts";
import { Cipher, Prefixer, Signer } from "../../../cesr/mod.ts";

export interface KeeperOptions extends LMDBerOptions {
  compat?: boolean;
}

export interface PubLot {
  pubs: string[];
  ridx: number;
  kidx: number;
  dt: string;
}

export interface PreSit {
  old: PubLot;
  new: PubLot;
  nxt: PubLot;
}

export interface PrePrm {
  pidx: number;
  algo: string;
  salt: string;
  stem: string;
  tier: string;
}

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
  static readonly MaxNamedDBs = 16;

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

  *reopen(options: Partial<KeeperOptions> = {}): Operation<boolean> {
    const opened = yield* this.lmdber.reopen(options);
    if (!opened) return false;

    try {
      this.gbls = new Suber(this.lmdber, { subkey: "gbls." });
      this.pris = new CryptSignerSuber(this.lmdber, { subkey: "pris." });
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

  getGbls(key: string): string | null {
    return this.gbls.get(key);
  }

  pinGbls(key: string, value: string): boolean {
    return this.gbls.pin(key, value);
  }

  putPres(pre: string, val: string): boolean {
    return this.pres.put(pre, new Prefixer({ qb64: val }));
  }

  pinPres(pre: string, val: string): boolean {
    return this.pres.pin(pre, new Prefixer({ qb64: val }));
  }

  getPres(pre: string): string | null {
    return this.pres.get(pre)?.qb64 ?? null;
  }

  putPris(pub: string, secret: string): boolean {
    return this.pris.put(pub, new Signer({ qb64: secret }));
  }

  pinPris(pub: string, secret: string): boolean {
    return this.pris.pin(pub, new Signer({ qb64: secret }));
  }

  getPris(pub: string): string | null {
    return this.pris.get(pub)?.qb64 ?? null;
  }

  putPrms(pre: string, val: PrePrm): boolean {
    return this.prms.put(pre, val);
  }

  pinPrms(pre: string, val: PrePrm): boolean {
    return this.prms.pin(pre, val);
  }

  getPrms(pre: string): PrePrm | null {
    return this.prms.get(pre);
  }

  putSits(pre: string, val: PreSit): boolean {
    return this.sits.put(pre, val);
  }

  pinSits(pre: string, val: PreSit): boolean {
    return this.sits.pin(pre, val);
  }

  getSits(pre: string): PreSit | null {
    return this.sits.get(pre);
  }

  putPubs(key: string, val: PubSet): boolean {
    return this.pubs.put(key, val);
  }

  pinPubs(key: string, val: PubSet): boolean {
    return this.pubs.pin(key, val);
  }

  getPubs(key: string): PubSet | null {
    return this.pubs.get(key);
  }
}

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
