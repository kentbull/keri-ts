import { type Operation } from "npm:effection@^3.6.0";
import { Database } from "npm:lmdb@^3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import { BinKey, BinVal, LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { b, t } from '../../../cesr/mod.ts'

export interface KeeperOptions extends LMDBerOptions {}

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

export class Keeper {
  private lmdber: LMDBer;
  private readonly logger: Logger;

  public gbls!: Database<BinVal, BinKey>;
  public pris!: Database<BinVal, BinKey>;
  public pres!: Database<BinVal, BinKey>;
  public prms!: Database<BinVal, BinKey>;
  public sits!: Database<BinVal, BinKey>;
  public pubs!: Database<BinVal, BinKey>;
  public prxs!: Database<BinVal, BinKey>;
  public nxts!: Database<BinVal, BinKey>;

  static readonly TailDirPath = "keri/ks";
  static readonly AltTailDirPath = ".tufa/ks";
  static readonly TempPrefix = "keri_ks_";
  static readonly MaxNamedDBs = 16;

  constructor(options: KeeperOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    this.lmdber = new LMDBer(options, {
      tailDirPath: Keeper.TailDirPath,
      altTailDirPath: Keeper.AltTailDirPath,
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
      this.gbls = this.lmdber.openDB("gbls.", false);
      this.pris = this.lmdber.openDB("pris.", false);
      this.pres = this.lmdber.openDB("pres.", false);
      this.prms = this.lmdber.openDB("prms.", false);
      this.sits = this.lmdber.openDB("sits.", false);
      this.pubs = this.lmdber.openDB("pubs.", false);
      this.prxs = this.lmdber.openDB("prxs.", false);
      this.nxts = this.lmdber.openDB("nxts.", false);
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

  private enc(text: string): Uint8Array {
    return b(text);
  }

  private dec(bytes: Uint8Array | null): string | null {
    if (bytes === null) return null;
    return t(bytes);
  }

  private encJson(value: unknown): Uint8Array {
    return this.enc(JSON.stringify(value));
  }

  private decJson<T>(bytes: Uint8Array | null): T | null {
    const text = this.dec(bytes);
    if (text === null) return null;
    return JSON.parse(text) as T;
  }

  getGbls(key: string): string | null {
    return this.dec(this.lmdber.getVal(this.gbls, this.enc(key)));
  }

  pinGbls(key: string, value: string): boolean {
    return this.lmdber.setVal(this.gbls, this.enc(key), this.enc(value));
  }

  putPres(pre: string, val: string): boolean {
    return this.lmdber.putVal(this.pres, this.enc(pre), this.enc(val));
  }

  pinPres(pre: string, val: string): boolean {
    return this.lmdber.setVal(this.pres, this.enc(pre), this.enc(val));
  }

  getPres(pre: string): string | null {
    return this.dec(this.lmdber.getVal(this.pres, this.enc(pre)));
  }

  putPris(pub: string, secret: string): boolean {
    return this.lmdber.putVal(this.pris, this.enc(pub), this.enc(secret));
  }

  pinPris(pub: string, secret: string): boolean {
    return this.lmdber.setVal(this.pris, this.enc(pub), this.enc(secret));
  }

  getPris(pub: string): string | null {
    return this.dec(this.lmdber.getVal(this.pris, this.enc(pub)));
  }

  putPrms(pre: string, val: PrePrm): boolean {
    return this.lmdber.putVal(this.prms, this.enc(pre), this.encJson(val));
  }

  pinPrms(pre: string, val: PrePrm): boolean {
    return this.lmdber.setVal(this.prms, this.enc(pre), this.encJson(val));
  }

  getPrms(pre: string): PrePrm | null {
    return this.decJson<PrePrm>(this.lmdber.getVal(this.prms, this.enc(pre)));
  }

  putSits(pre: string, val: PreSit): boolean {
    return this.lmdber.putVal(this.sits, this.enc(pre), this.encJson(val));
  }

  pinSits(pre: string, val: PreSit): boolean {
    return this.lmdber.setVal(this.sits, this.enc(pre), this.encJson(val));
  }

  getSits(pre: string): PreSit | null {
    return this.decJson<PreSit>(this.lmdber.getVal(this.sits, this.enc(pre)));
  }

  putPubs(key: string, val: PubSet): boolean {
    return this.lmdber.putVal(this.pubs, this.enc(key), this.encJson(val));
  }

  pinPubs(key: string, val: PubSet): boolean {
    return this.lmdber.setVal(this.pubs, this.enc(key), this.encJson(val));
  }

  getPubs(key: string): PubSet | null {
    return this.decJson<PubSet>(this.lmdber.getVal(this.pubs, this.enc(key)));
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
