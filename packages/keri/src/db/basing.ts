/** KERI event-log databaser built on `LMDBer` composition. */

import { type Operation } from "npm:effection@^3.6.0";
import type { Database } from "npm:lmdb@3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import {
  BlindedImageTuple,
  BoundStateQuadruple,
  BoundStateSextuple,
  CacheTypeRecord,
  EndpointRecord,
  EscrowedValidatorReceiptQuintuple,
  EventSealTuple,
  EventSourceRecord,
  FirstSeenReplayCouple,
  HabitatRecord,
  KeyStateRecord,
  LocationRecord,
  MsgCacheRecord,
  ObservedRecord,
  OobiRecord,
  ReceiptCouple,
  SourceSealTriple,
  TopicsRecord,
  TransferableSignatureCouple,
  TxnMsgCacheRecord,
  TypedDigestSealCouple,
  TypeMediaQuadruple,
  UnverifiedReceiptTriple,
  ValidatorReceiptQuadruple,
  WellKnownAuthN,
} from "../core/records.ts";
import { BinKey, BinVal, LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { dgKey } from "./core/keys.ts";
import { IoSetKomer, Komer } from "./koming.ts";
import {
  B64OnIoDupSuber,
  CatCesrIoSetSuber,
  CatCesrSuber,
  CesrIoSetSuber,
  CesrOnSuber,
  CesrSuber,
  IoSetSuber,
  OnIoDupSuber,
  OnSuber,
  SchemerSuber,
  SerderSuber,
  Suber,
} from "./subing.ts";
import {
  concatBytes,
  Counter,
  CtrDexV1,
  b,
  Cigar,
  Dater,
  Diger,
  Labeler,
  Noncer,
  NumDex,
  NumberPrimitive,
  Prefixer,
  Saider,
  SerderKERI,
  Siger,
  t,
  Texter,
  Verfer,
  Verser,
} from "../../../cesr/mod.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

function encodeHugeOrdinal(num: number): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

/** Options for opening a `Baser` LMDB environment and its named subdb surface. */
export interface BaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * High-level event-log databaser for KERI application state.
 *
 * Responsibilities:
 * - own the LMDB environment used for KEL/event-adjacent state
 * - bind the KERIpy-style named subdb surface through `Suber`/`Komer`
 * - expose a small set of runtime helpers for local habitat state bootstrap
 *
 * Bound store categories:
 * - event/state backbone (`evts.`, `kels.`, `fels.`, `dtss.`, `states.`)
 * - signatures/receipts and escrow families
 * - reply/endpoint/OOBI and exchange/challenge/contact families
 * - habitat/application metadata and KRAM cache records
 *
 * KERIpy correspondence:
 * - mirrors the named-subdb inventory of `keri.db.basing.Baser`
 *
 * Current `keri-ts` difference:
 * - the full store surface is now bound, but only the local habitat/runtime
 *   subset is actively driven by `Habery`/CLI in this arc
 */
export class Baser {
  private lmdber: LMDBer;
  private readonly logger: Logger;
  private evtsRaw!: Database<BinVal, BinKey>;

  public evts!: SerderSuber<SerderKERI>;
  public fels!: OnSuber<string>;
  public kels!: OnIoDupSuber<string>;
  public dtss!: CesrSuber<Dater>;
  public aess!: CatCesrSuber<EventSealTuple>;
  public sigs!: CesrIoSetSuber<Siger>;
  public wigs!: CesrIoSetSuber<Siger>;
  public rcts!: CatCesrIoSetSuber<ReceiptCouple>;
  public ures!: CatCesrIoSetSuber<UnverifiedReceiptTriple>;
  public vrcs!: CatCesrIoSetSuber<ValidatorReceiptQuadruple>;
  public vres!: CatCesrIoSetSuber<EscrowedValidatorReceiptQuintuple>;
  public pses!: OnIoDupSuber<string>;
  public pwes!: OnIoDupSuber<string>;
  public pdes!: OnIoDupSuber<string>;
  public udes!: CatCesrSuber<EventSealTuple>;
  public uwes!: B64OnIoDupSuber<string[]>;
  public ooes!: OnIoDupSuber<string>;
  public dels!: OnIoDupSuber<string>;
  public ldes!: OnIoDupSuber<string>;
  public qnfs!: IoSetSuber<string>;
  public fons!: CesrSuber<NumberPrimitive>;
  public migs!: CesrSuber<Dater>;
  public vers!: Suber;
  public esrs!: Komer<EventSourceRecord>;
  public misfits!: IoSetSuber<string>;
  public delegables!: IoSetSuber<string>;
  public states!: Komer<KeyStateRecord>;
  public wits!: CesrIoSetSuber<Prefixer>;
  public habs!: Komer<HabitatRecord>;
  public names!: Suber;
  public sdts!: CesrSuber<Dater>;
  public ssgs!: CesrIoSetSuber<Siger>;
  public scgs!: CatCesrIoSetSuber<TransferableSignatureCouple>;
  public rpys!: SerderSuber<SerderKERI>;
  public rpes!: CesrIoSetSuber<Diger>;
  public eans!: CesrSuber<Diger>;
  public lans!: CesrSuber<Diger>;
  public ends!: Komer<EndpointRecord>;
  public locs!: Komer<LocationRecord>;
  public obvs!: Komer<ObservedRecord>;
  public tops!: Komer<TopicsRecord>;
  public gpse!: CatCesrIoSetSuber<EventSealTuple>;
  public gdee!: CatCesrIoSetSuber<EventSealTuple>;
  public gpwe!: CatCesrIoSetSuber<EventSealTuple>;
  public cgms!: CesrSuber<Diger>;
  public epse!: SerderSuber<SerderKERI>;
  public epsd!: CesrSuber<Dater>;
  public exns!: SerderSuber<SerderKERI>;
  public erpy!: CesrSuber<Saider>;
  public esigs!: CesrIoSetSuber<Siger>;
  public ecigs!: CatCesrIoSetSuber<TransferableSignatureCouple>;
  public epath!: IoSetSuber<string>;
  public essrs!: CesrIoSetSuber<Texter>;
  public chas!: CesrIoSetSuber<Diger>;
  public reps!: CesrIoSetSuber<Diger>;
  public wkas!: IoSetKomer<WellKnownAuthN>;
  public kdts!: CesrSuber<Dater>;
  public ksns!: Komer<KeyStateRecord>;
  public knas!: CesrSuber<Diger>;
  public wwas!: CesrSuber<Diger>;
  public oobis!: Komer<OobiRecord>;
  public eoobi!: Komer<OobiRecord>;
  public coobi!: Komer<OobiRecord>;
  public roobi!: Komer<OobiRecord>;
  public woobi!: Komer<OobiRecord>;
  public moobi!: Komer<OobiRecord>;
  public mfa!: Komer<OobiRecord>;
  public rmfa!: Komer<OobiRecord>;
  public schema!: SchemerSuber<SerderKERI>;
  public cfld!: Suber;
  public hbys!: Suber;
  public cons!: Suber;
  public ccigs!: CesrSuber<Cigar>;
  public imgs!: CatCesrSuber<BlindedImageTuple>;
  public ifld!: Suber;
  public sids!: Suber;
  public icigs!: CesrSuber<Cigar>;
  public iimgs!: CatCesrSuber<BlindedImageTuple>;
  public dpwe!: SerderSuber<SerderKERI>;
  public dune!: SerderSuber<SerderKERI>;
  public dpub!: SerderSuber<SerderKERI>;
  public cdel!: CesrOnSuber<Diger>;
  public meids!: CesrIoSetSuber<Diger>;
  public maids!: CesrIoSetSuber<Prefixer>;
  public ctyp!: Komer<CacheTypeRecord>;
  public msgc!: Komer<MsgCacheRecord>;
  public tmsc!: Komer<TxnMsgCacheRecord>;
  public pmkm!: SerderSuber<SerderKERI>;
  public pmks!: CesrIoSetSuber<Siger>;
  public pmsk!: CatCesrSuber<EventSealTuple>;
  public trqs!: CatCesrIoSetSuber<ValidatorReceiptQuadruple>;
  public tsgs!: CatCesrIoSetSuber<ValidatorReceiptQuadruple>;
  public sscs!: CatCesrIoSetSuber<EventSealTuple>;
  public ssts!: CatCesrIoSetSuber<SourceSealTriple>;
  public frcs!: CatCesrIoSetSuber<FirstSeenReplayCouple>;
  public tdcs!: CatCesrIoSetSuber<TypedDigestSealCouple>;
  public ptds!: IoSetSuber<string>;
  public bsqs!: CatCesrIoSetSuber<BoundStateQuadruple>;
  public bsss!: CatCesrIoSetSuber<BoundStateSextuple>;
  public tmqs!: CatCesrIoSetSuber<TypeMediaQuadruple>;

  static readonly TailDirPath = "keri/db";
  static readonly AltTailDirPath = ".tufa/db";
  static readonly CompatAltTailDirPath = ".keri/db";
  static readonly TempPrefix = "keri_db_";
  static readonly MaxNamedDBs = 128;

  constructor(options: BaserOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    const compat = options.compat ?? false;
    this.lmdber = new LMDBer(options, {
      tailDirPath: Baser.TailDirPath,
      cleanTailDirPath: "keri/clean/db",
      altTailDirPath: compat
        ? Baser.CompatAltTailDirPath
        : Baser.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/db" : ".tufa/clean/db",
      tempPrefix: Baser.TempPrefix,
      maxNamedDBs: Baser.MaxNamedDBs,
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

  get env() {
    return this.lmdber.env;
  }

  /**
   * Reopen the root LMDB environment and bind the KERIpy-style named subdbs.
   *
   * This keeps the `Baser` layer thin: the constructor owns path/lifecycle
   * defaults, `reopen()` binds the family-specific storage adapters, and
   * higher-layer runtime code interacts through those typed wrappers rather
   * than hand-rolled raw LMDB handles.
   */
  *reopen(options: Partial<BaserOptions> = {}): Operation<boolean> {
    const opened = yield* this.lmdber.reopen(options);
    if (!opened) {
      return false;
    }

    try {
      this.evts = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "evts." });
      this.evtsRaw = this.evts.sdb;
      this.fels = new OnSuber(this.lmdber, { subkey: "fels." });
      this.kels = new OnIoDupSuber(this.lmdber, { subkey: "kels." });
      this.dtss = new CesrSuber<Dater>(this.lmdber, { subkey: "dtss.", klas: Dater });
      this.aess = new CatCesrSuber<EventSealTuple>(this.lmdber, {
        subkey: "aess.",
        klas: [NumberPrimitive, Diger],
      });
      this.sigs = new CesrIoSetSuber<Siger>(this.lmdber, { subkey: "sigs.", klas: Siger });
      this.wigs = new CesrIoSetSuber<Siger>(this.lmdber, { subkey: "wigs.", klas: Siger });
      this.rcts = new CatCesrIoSetSuber<ReceiptCouple>(this.lmdber, {
        subkey: "rcts.",
        klas: [Prefixer, Cigar],
      });
      this.ures = new CatCesrIoSetSuber<UnverifiedReceiptTriple>(this.lmdber, {
        subkey: "ures.",
        klas: [Diger, Prefixer, Cigar],
      });
      this.vrcs = new CatCesrIoSetSuber<ValidatorReceiptQuadruple>(this.lmdber, {
        subkey: "vrcs.",
        klas: [Prefixer, NumberPrimitive, Diger, Siger],
      });
      this.vres = new CatCesrIoSetSuber<EscrowedValidatorReceiptQuintuple>(this.lmdber, {
        subkey: "vres.",
        klas: [Diger, Prefixer, NumberPrimitive, Diger, Siger],
      });
      this.pses = new OnIoDupSuber(this.lmdber, { subkey: "pses." });
      this.pwes = new OnIoDupSuber(this.lmdber, { subkey: "pwes." });
      this.pdes = new OnIoDupSuber(this.lmdber, { subkey: "pdes." });
      this.udes = new CatCesrSuber<EventSealTuple>(this.lmdber, {
        subkey: "udes.",
        klas: [NumberPrimitive, Diger],
      });
      this.uwes = new B64OnIoDupSuber(this.lmdber, { subkey: "uwes." });
      this.ooes = new OnIoDupSuber(this.lmdber, { subkey: "ooes." });
      this.dels = new OnIoDupSuber(this.lmdber, { subkey: "dels." });
      this.ldes = new OnIoDupSuber(this.lmdber, { subkey: "ldes." });
      this.qnfs = new IoSetSuber<string>(this.lmdber, { subkey: "qnfs." });
      this.fons = new CesrSuber<NumberPrimitive>(this.lmdber, {
        subkey: "fons.",
        klas: NumberPrimitive,
      });
      this.migs = new CesrSuber<Dater>(this.lmdber, { subkey: "migs.", klas: Dater });
      this.vers = new Suber(this.lmdber, { subkey: "vers." });
      this.esrs = new Komer<EventSourceRecord>(this.lmdber, { subkey: "esrs." });
      this.misfits = new IoSetSuber<string>(this.lmdber, { subkey: "mfes." });
      this.delegables = new IoSetSuber<string>(this.lmdber, { subkey: "dees." });
      this.states = new Komer<KeyStateRecord>(this.lmdber, { subkey: "stts." });
      this.wits = new CesrIoSetSuber<Prefixer>(this.lmdber, {
        subkey: "wits.",
        klas: Prefixer,
      });
      this.habs = new Komer<HabitatRecord>(this.lmdber, { subkey: "habs." });
      this.names = new Suber(this.lmdber, { subkey: "names.", sep: "^" });
      this.sdts = new CesrSuber<Dater>(this.lmdber, { subkey: "sdts.", klas: Dater });
      this.ssgs = new CesrIoSetSuber<Siger>(this.lmdber, { subkey: "ssgs.", klas: Siger });
      this.scgs = new CatCesrIoSetSuber<TransferableSignatureCouple>(this.lmdber, {
        subkey: "scgs.",
        klas: [Verfer, Cigar],
      });
      this.rpys = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "rpys." });
      this.rpes = new CesrIoSetSuber<Diger>(this.lmdber, { subkey: "rpes.", klas: Diger });
      this.eans = new CesrSuber<Diger>(this.lmdber, { subkey: "eans.", klas: Diger });
      this.lans = new CesrSuber<Diger>(this.lmdber, { subkey: "lans.", klas: Diger });
      this.ends = new Komer<EndpointRecord>(this.lmdber, { subkey: "ends." });
      this.locs = new Komer<LocationRecord>(this.lmdber, { subkey: "locs." });
      this.obvs = new Komer<ObservedRecord>(this.lmdber, { subkey: "obvs." });
      this.tops = new Komer<TopicsRecord>(this.lmdber, { subkey: "witm." });
      this.gpse = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "gpse.",
        klas: [NumberPrimitive, Diger],
      });
      this.gdee = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "gdee.",
        klas: [NumberPrimitive, Diger],
      });
      this.gpwe = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "gdwe.",
        klas: [NumberPrimitive, Diger],
      });
      this.cgms = new CesrSuber<Diger>(this.lmdber, { subkey: "cgms.", klas: Diger });
      this.epse = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "epse." });
      this.epsd = new CesrSuber<Dater>(this.lmdber, { subkey: "epsd.", klas: Dater });
      this.exns = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "exns." });
      this.erpy = new CesrSuber<Saider>(this.lmdber, { subkey: "erpy.", klas: Saider });
      this.esigs = new CesrIoSetSuber<Siger>(this.lmdber, { subkey: "esigs.", klas: Siger });
      this.ecigs = new CatCesrIoSetSuber<TransferableSignatureCouple>(this.lmdber, {
        subkey: "ecigs.",
        klas: [Verfer, Cigar],
      });
      this.epath = new IoSetSuber<string>(this.lmdber, { subkey: ".epath" });
      this.essrs = new CesrIoSetSuber<Texter>(this.lmdber, { subkey: ".essrs", klas: Texter });
      this.chas = new CesrIoSetSuber<Diger>(this.lmdber, { subkey: "chas.", klas: Diger });
      this.reps = new CesrIoSetSuber<Diger>(this.lmdber, { subkey: "reps.", klas: Diger });
      this.wkas = new IoSetKomer<WellKnownAuthN>(this.lmdber, { subkey: "wkas." });
      this.kdts = new CesrSuber<Dater>(this.lmdber, { subkey: "kdts.", klas: Dater });
      this.ksns = new Komer<KeyStateRecord>(this.lmdber, { subkey: "ksns." });
      this.knas = new CesrSuber<Diger>(this.lmdber, { subkey: "knas.", klas: Diger });
      this.wwas = new CesrSuber<Diger>(this.lmdber, { subkey: "wwas.", klas: Diger });
      this.oobis = new Komer<OobiRecord>(this.lmdber, { subkey: "oobis.", sep: ">" });
      this.eoobi = new Komer<OobiRecord>(this.lmdber, { subkey: "eoobi.", sep: ">" });
      this.coobi = new Komer<OobiRecord>(this.lmdber, { subkey: "coobi.", sep: ">" });
      this.roobi = new Komer<OobiRecord>(this.lmdber, { subkey: "roobi.", sep: ">" });
      this.woobi = new Komer<OobiRecord>(this.lmdber, { subkey: "woobi.", sep: ">" });
      this.moobi = new Komer<OobiRecord>(this.lmdber, { subkey: "moobi.", sep: ">" });
      this.mfa = new Komer<OobiRecord>(this.lmdber, { subkey: "mfa.", sep: ">" });
      this.rmfa = new Komer<OobiRecord>(this.lmdber, { subkey: "rmfa.", sep: ">" });
      this.schema = new SchemerSuber<SerderKERI>(this.lmdber, { subkey: "schema." });
      this.cfld = new Suber(this.lmdber, { subkey: "cfld." });
      this.hbys = new Suber(this.lmdber, { subkey: "hbys." });
      this.cons = new Suber(this.lmdber, { subkey: "cons." });
      this.ccigs = new CesrSuber<Cigar>(this.lmdber, { subkey: "ccigs.", klas: Cigar });
      this.imgs = new CatCesrSuber<BlindedImageTuple>(this.lmdber, {
        subkey: "imgs.",
        klas: [Noncer, Noncer, Labeler, Texter],
      });
      this.ifld = new Suber(this.lmdber, { subkey: "ifld." });
      this.sids = new Suber(this.lmdber, { subkey: "sids." });
      this.icigs = new CesrSuber<Cigar>(this.lmdber, { subkey: "icigs.", klas: Cigar });
      this.iimgs = new CatCesrSuber<BlindedImageTuple>(this.lmdber, {
        subkey: "iimgs.",
        klas: [Noncer, Noncer, Labeler, Texter],
      });
      this.dpwe = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "dpwe." });
      this.dune = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "dune." });
      this.dpub = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "dpub." });
      this.cdel = new CesrOnSuber<Diger>(this.lmdber, { subkey: "cdel.", klas: Diger });
      this.meids = new CesrIoSetSuber<Diger>(this.lmdber, { subkey: "meids.", klas: Diger });
      this.maids = new CesrIoSetSuber<Prefixer>(this.lmdber, { subkey: "maids.", klas: Prefixer });
      this.ctyp = new Komer<CacheTypeRecord>(this.lmdber, { subkey: "ctyp." });
      this.msgc = new Komer<MsgCacheRecord>(this.lmdber, { subkey: "msgc." });
      this.tmsc = new Komer<TxnMsgCacheRecord>(this.lmdber, { subkey: "tmsc." });
      this.pmkm = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "pmkm." });
      this.pmks = new CesrIoSetSuber<Siger>(this.lmdber, { subkey: "pmks.", klas: Siger });
      this.pmsk = new CatCesrSuber<EventSealTuple>(this.lmdber, {
        subkey: "pmsk.",
        klas: [NumberPrimitive, Diger],
      });
      this.trqs = new CatCesrIoSetSuber<ValidatorReceiptQuadruple>(this.lmdber, {
        subkey: "trqs.",
        klas: [Prefixer, NumberPrimitive, Diger, Siger],
      });
      this.tsgs = new CatCesrIoSetSuber<ValidatorReceiptQuadruple>(this.lmdber, {
        subkey: "tsgs.",
        klas: [Prefixer, NumberPrimitive, Diger, Siger],
      });
      this.sscs = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "sscs.",
        klas: [NumberPrimitive, Diger],
      });
      this.ssts = new CatCesrIoSetSuber<SourceSealTriple>(this.lmdber, {
        subkey: "ssts.",
        klas: [Prefixer, NumberPrimitive, Diger],
      });
      this.frcs = new CatCesrIoSetSuber<FirstSeenReplayCouple>(this.lmdber, {
        subkey: "frcs.",
        klas: [NumberPrimitive, Dater],
      });
      this.tdcs = new CatCesrIoSetSuber<TypedDigestSealCouple>(this.lmdber, {
        subkey: "tdcs.",
        klas: [Verser, Diger],
      });
      this.ptds = new IoSetSuber<string>(this.lmdber, { subkey: "ptds." });
      this.bsqs = new CatCesrIoSetSuber<BoundStateQuadruple>(this.lmdber, {
        subkey: "bsqs.",
        klas: [Diger, Noncer, Noncer, Labeler],
      });
      this.bsss = new CatCesrIoSetSuber<BoundStateSextuple>(this.lmdber, {
        subkey: "bsss.",
        klas: [Diger, Noncer, Noncer, Labeler, NumberPrimitive, Noncer],
      });
      this.tmqs = new CatCesrIoSetSuber<TypeMediaQuadruple>(this.lmdber, {
        subkey: "tmqs.",
        klas: [Diger, Noncer, Labeler, Texter],
      });

      return this.opened;
    } catch (error) {
      this.logger.error(`Failed to open Baser sub-databases: ${error}`);
      throw new DatabaseOperationError(
        "Failed to open Baser sub-databases",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /** Close the underlying LMDB resources. */
  *close(clear = false): Operation<boolean> {
    return yield* this.lmdber.close(clear);
  }

  getVer(): string | null {
    return this.lmdber.getVer();
  }

  setVer(val: string): void {
    this.lmdber.setVer(val);
  }

  /** Count raw physical entries in `evts.` for test/debug visibility. */
  cntEvts(): number {
    return this.lmdber.cnt(this.evtsRaw);
  }

  /** Raw insert helper kept for tests/debug tooling. */
  putEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.putVal(this.evtsRaw, key, val);
  }

  /** Raw upsert helper kept for tests/debug tooling. */
  setEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.setVal(this.evtsRaw, key, val);
  }

  /** Raw fetch helper kept for tests/debug tooling. */
  getEvt(key: Uint8Array): Uint8Array | null {
    return this.lmdber.getVal(this.evtsRaw, key);
  }

  /** Raw delete helper kept for tests/debug tooling. */
  delEvt(key: Uint8Array): boolean {
    return this.lmdber.delVal(this.evtsRaw, key);
  }

  /** Iterate `evts.` entries with optional byte-prefix filter. */
  *getAllEvtsIter(
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    yield* this.lmdber.getTopItemIter(this.evtsRaw, top);
  }

  /**
   * Persist one serialized event body in `evts.` under its digest key.
   *
   * Runtime code should prefer this helper over the raw `putEvt()` form so the
   * KERIpy `dgKey(pre, said)` event-key contract stays explicit.
   */
  putEvtSerder(pre: string, said: string, raw: Uint8Array): boolean {
    return this.setEvt(dgKey(pre, said), raw);
  }

  /** Read one serialized event from `evts.` through the typed serder wrapper. */
  getEvtSerder(pre: string, said: string): SerderKERI | null {
    return this.evts.get([pre, said]);
  }

  /** Append one event digest to the key-event log bucket for `(pre, sn)`. */
  putKel(pre: string, sn: number, said: string): boolean {
    return this.kels.addOn(pre, sn, said);
  }

  /** Read the latest stored event digest for `(pre, sn)` from `kels.`. */
  getKel(pre: string, sn: number): string | null {
    return this.kels.getOnLast(pre, sn);
  }

  /** Iterate the latest digest per sequence number for one identifier's KEL. */
  *getKelItemIter(pre: string): Generator<[number, string]> {
    for (const [, sn, said] of this.kels.getOnLastItemIter(pre)) {
      yield [sn, said];
    }
  }

  /** Append one digest to the first-seen event log for a prefix and return the assigned ordinal. */
  appendFel(pre: string, said: string): number {
    return this.fels.appendOn(pre, said);
  }

  /** Read one first-seen digest by `(pre, fn)` from `fels.`. */
  getFel(pre: string, fn: number): string | null {
    return this.fels.getOn(pre, fn);
  }

  /** Resolve the first-seen ordinal for one previously stored event digest. */
  getFelFn(pre: string, said: string): number | null {
    for (const [, fn, current] of this.fels.getOnItemIterAll(pre)) {
      if (current === said) {
        return fn;
      }
    }
    return null;
  }

  /** Upsert the datetime stamp for one event digest in `dtss.`. */
  putDts(pre: string, said: string, qb64: string): boolean {
    return this.dtss.pin([pre, said], new Dater({ qb64 }));
  }

  /** Read the stored datetime stamp for one event digest from `dtss.`. */
  getDts(pre: string, said: string): string | null {
    return this.dtss.get([pre, said])?.qb64 ?? null;
  }

  /** Insert one event-source record in `esrs.` if absent. */
  putEsr(pre: string, said: string, record: EventSourceRecord): boolean {
    return this.esrs.put([pre, said], record);
  }

  /** Upsert one event-source record in `esrs.`. */
  pinEsr(pre: string, said: string, record: EventSourceRecord): boolean {
    return this.esrs.pin([pre, said], record);
  }

  /** Read one event-source record from `esrs.`. */
  getEsr(pre: string, said: string): EventSourceRecord | null {
    return this.esrs.get([pre, said]);
  }

  /** Insert one current key-state record in `states.` if absent. */
  putState(pre: string, record: KeyStateRecord): boolean {
    return this.states.put(pre, record);
  }

  /** Upsert one current key-state record in `states.`. */
  pinState(pre: string, record: KeyStateRecord): boolean {
    return this.states.pin(pre, record);
  }

  /** Read one current key-state record from `states.`. */
  getState(pre: string): KeyStateRecord | null {
    return this.states.get(pre);
  }

  /** Iterate raw serialized events in KEL order for one identifier prefix. */
  *getKelRawIter(pre: string): Generator<Uint8Array> {
    for (const [, said] of this.getKelItemIter(pre)) {
      const raw = this.getEvt(dgKey(pre, said));
      if (raw !== null) {
        yield raw;
      }
    }
  }

  /**
   * Rebuild one CESR event message with its attached foot from DB state.
   *
   * KERIpy correspondence:
   * - mirrors `keri.db.basing.Baser.cloneEvtMsg`
   *
   * This is the durable export/replay seam for locally stored events. The
   * event body comes from `evts.`, while the attached foot is reconstructed
   * from the companion stores that hold controller signatures, witness
   * signatures, source seals, receipts, and first-seen replay metadata.
   */
  cloneEvtMsg(pre: string, fn: number, said: string): Uint8Array {
    const serder = this.getEvtSerder(pre, said);
    if (serder === null) {
      throw new DatabaseOperationError(
        `Missing event body for ${pre}:${said}`,
      );
    }

    const sigers = this.sigs.get([pre, said]);
    if (sigers.length === 0) {
      throw new DatabaseOperationError(
        `Missing indexed signatures for ${pre}:${said}`,
      );
    }

    const attachments: Uint8Array[] = [
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...sigers.map((siger) => siger.qb64b),
    ];

    const wigers = this.wigs.get([pre, said]);
    if (wigers.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.WitnessIdxSigs,
          count: wigers.length,
          version: KERI_V1,
        }).qb64b,
        ...wigers.map((wiger) => wiger.qb64b),
      );
    }

    const seal = this.aess.get([pre, said]);
    if (seal !== null) {
      const [number, diger] = seal;
      attachments.push(
        new Counter({
          code: CtrDexV1.SealSourceCouples,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        number.qb64b,
        diger.qb64b,
      );
    }

    const vrcs = this.vrcs.get([pre, said]);
    if (vrcs.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.TransReceiptQuadruples,
          count: vrcs.length,
          version: KERI_V1,
        }).qb64b,
        ...vrcs.flatMap(([prefixer, snu, diger, siger]) => [
          prefixer.qb64b,
          snu.qb64b,
          diger.qb64b,
          siger.qb64b,
        ]),
      );
    }

    const rcts = this.rcts.get([pre, said]);
    if (rcts.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.NonTransReceiptCouples,
          count: rcts.length,
          version: KERI_V1,
        }).qb64b,
        ...rcts.flatMap(([prefixer, cigar]) => [
          prefixer.qb64b,
          cigar.qb64b,
        ]),
      );
    }

    const dater = this.dtss.get([pre, said]);
    if (dater === null) {
      throw new DatabaseOperationError(
        `Missing datetime stamp for ${pre}:${said}`,
      );
    }
    attachments.push(
      new Counter({
        code: CtrDexV1.FirstSeenReplayCouples,
        count: 1,
        version: KERI_V1,
      }).qb64b,
      encodeHugeOrdinal(fn).qb64b,
      dater.qb64b,
    );

    const atc = concatBytes(...attachments);
    if (atc.length % 4 !== 0) {
      throw new DatabaseOperationError(
        `Invalid attachment quadlet size for ${pre}:${said}`,
      );
    }

    const group = new Counter({
      code: CtrDexV1.AttachmentGroup,
      count: atc.length / 4,
      version: KERI_V1,
    });
    return concatBytes(serder.raw, group.qb64b, atc);
  }

  /**
   * Replay one identifier's events in first-seen order as full CESR messages.
   *
   * KERIpy correspondence:
   * - mirrors `keri.db.basing.Baser.clonePreIter`
   *
   * Errors rebuilding individual events are skipped so export/replay callers
   * can continue streaming later entries, matching KERIpy's clone behavior.
   */
  *clonePreIter(pre: string, fn = 0): Generator<Uint8Array> {
    for (const [, currentFn, said] of this.fels.getOnItemIterAll(pre, fn)) {
      try {
        yield this.cloneEvtMsg(pre, currentFn, said);
      } catch {
        continue;
      }
    }
  }

  /** Insert one habitat metadata record in `habs.` if absent. */
  putHab(pre: string, record: HabitatRecord): boolean {
    return this.habs.put(pre, record);
  }

  /** Upsert one habitat metadata record in `habs.`. */
  pinHab(pre: string, record: HabitatRecord): boolean {
    return this.habs.pin(pre, record);
  }

  /** Read one habitat metadata record from `habs.`. */
  getHab(pre: string): HabitatRecord | null {
    return this.habs.get(pre);
  }

  /** Iterate persisted habitat metadata records keyed by identifier prefix. */
  *getHabItemIter(
    top = "",
  ): Generator<[string, HabitatRecord]> {
    for (const [keys, record] of this.habs.getTopItemIter(top)) {
      const pre = keys[0];
      if (!pre) {
        continue;
      }
      yield [pre, record];
    }
  }

  /** Insert indexed signatures for one event in `sigs.` if absent. */
  putSigs(pre: string, said: string, sigs: string[]): boolean {
    return this.sigs.put([pre, said], sigs.map((sig) => new Siger({ qb64: sig })));
  }

  /** Upsert indexed signatures for one event in `sigs.`. */
  pinSigs(pre: string, said: string, sigs: string[]): boolean {
    return this.sigs.pin([pre, said], sigs.map((sig) => new Siger({ qb64: sig })));
  }

  /** Read indexed signatures for one event from `sigs.` as qb64 text. */
  getSigs(pre: string, said: string): string[] {
    return this.sigs.get([pre, said]).map((sig) => sig.qb64);
  }

  /** Insert one namespace/name to prefix mapping in `names.` if absent. */
  putName(ns: string, name: string, pre: string): boolean {
    return this.names.put([ns, name], pre);
  }

  /** Upsert one namespace/name to prefix mapping in `names.`. */
  pinName(ns: string, name: string, pre: string): boolean {
    return this.names.pin([ns, name], pre);
  }

  /** Read one namespace/name to prefix mapping from `names.`. */
  getName(ns: string, name: string): string | null {
    return this.names.get([ns, name]);
  }

  /** Upsert one habery-scoped string setting in `hbys.`. */
  pinHby(name: string, value: string): boolean {
    return this.hbys.pin(name, value);
  }

  /** Read one habery-scoped string setting from `hbys.`. */
  getHby(name: string): string | null {
    return this.hbys.get(name);
  }
}

/** Constructor-safe async factory for a fully reopened `Baser`. */
export function* createBaser(options: BaserOptions = {}): Operation<Baser> {
  const baser = new Baser(options);
  const opened = yield* baser.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Baser");
  }
  return baser;
}
