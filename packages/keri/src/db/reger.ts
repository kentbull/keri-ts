/**
 * Verifiable data registry database owner.
 *
 * KERIpy correspondence:
 * - mirrors `keri.vdr.eventing.Reger`
 *
 * Boundary:
 * - this module owns durable VDR/TEL/credential storage and replay helpers
 * - TEL state machines, registry orchestration, credential issuance, and
 *   verifier policy live in later VDR runtime modules
 */
import { type Operation } from "npm:effection@^3.6.0";
import {
  Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
  Dater,
  Diger,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  Siger,
  t,
  Verfer,
} from "../../../cesr/mod.ts";
import { DatabaseNotOpenError, DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { RegistryRecord, RegStateRecord, type VerferCigarCouple } from "../core/records.ts";
import { Broker } from "./escrowing.ts";
import { dgKey } from "./core/keys.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";
import {
  BytesSuber,
  CatCesrIoSetSuber,
  CatCesrSuber,
  CesrDupSuber,
  CesrIoSetSuber,
  CesrOnSuber,
  CesrSuber,
  IoDupSuber,
  OnIoDupSuber,
  SerderSuber,
} from "./subing.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

type KeyPart = string | Uint8Array;
type TelAnchorTuple = [NumberPrimitive, Diger];
type CredentialAnchorTuple = [Prefixer, NumberPrimitive, Diger];
type TelSealTuple = [Prefixer, NumberPrimitive, Diger];
type TelCompletionTuple = [Prefixer, NumberPrimitive, Saider];
export type CredentialSource = [SerderACDC, Uint8Array];

/** Options for opening a `Reger` LMDB environment. */
export interface RegerOptions extends LMDBerOptions {
  compat?: boolean;
}

function keyText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : t(value);
}

function digestText(value: string | Uint8Array | Diger | Saider): string {
  if (value instanceof Diger || value instanceof Saider) {
    return value.qb64;
  }
  return keyText(value);
}

function fixedOrdinalRaw(num: bigint, size = 16): Uint8Array {
  const raw = new Uint8Array(size);
  let value = num;
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return raw;
}

function seqnerFromNumber(number: NumberPrimitive): Seqner {
  return new Seqner({ code: NumDex.Huge, raw: fixedOrdinalRaw(number.num) });
}

function saiderFromDigest(diger: Diger): Saider {
  return new Saider({ qb64: diger.qb64 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * VDR/TEL credential database owner.
 *
 * Bound stores are literal KERIpy `Reger` subkeys. Keeping this class thin
 * lets higher VDR processors share one storage contract with KERIpy fixtures.
 */
export class Reger extends LMDBer {
  public readonly registries = new Set<string>();
  public readonly tevers = new Map<string, unknown>();

  public tvts!: BytesSuber; // Serialized TEL events keyed by `(pre, said)`.
  public tels!: CesrOnSuber<Diger>; // TEL sequence ordinals mapped to event digests.
  public ancs!: CatCesrSuber<TelAnchorTuple>; // TEL event source seal couples.
  public baks!: IoDupSuber<string>; // Backer AIDs at one TEL management state.
  public tibs!: CesrDupSuber<Siger>; // Indexed backer receipt signatures.
  public oots!: OnIoDupSuber<string>; // Out-of-order TEL event escrows.
  public twes!: OnIoDupSuber<string>; // Partially witnessed TEL event escrows.
  public taes!: OnIoDupSuber<string>; // Anchorless TEL event escrows.
  public tets!: CesrSuber<Dater>; // TEL event first-seen datetimes.
  public states!: Komer<RegStateRecord>; // Latest registry state records.
  public creds!: SerderSuber<SerderACDC>; // Stored credentials by SAID.
  public cancs!: CatCesrSuber<CredentialAnchorTuple>; // Credential anchor triples.
  public spsgs!: CesrIoSetSuber<Siger>; // SAD path indexed signatures.
  public spcgs!: CatCesrIoSetSuber<VerferCigarCouple>; // SAD path non-indexed signatures.
  public saved!: CesrSuber<Saider>; // Fully processed credential markers.
  public issus!: CesrDupSuber<Saider>; // Credential SAIDs indexed by issuer.
  public subjs!: CesrDupSuber<Saider>; // Credential SAIDs indexed by subject.
  public schms!: CesrDupSuber<Saider>; // Credential SAIDs indexed by schema.
  public mre!: CesrSuber<Dater>; // Missing registry escrow timestamps.
  public mce!: CesrSuber<Dater>; // Missing chain escrow timestamps.
  public mse!: CesrSuber<Dater>; // Missing schema escrow timestamps.
  public txnsb!: Broker; // Transaction-state notice broker.
  public regs!: Komer<RegistryRecord>; // Registry metadata keyed by name.
  public tpwe!: CatCesrIoSetSuber<TelSealTuple>; // TEL partial witness escrow.
  public tmse!: CatCesrIoSetSuber<TelSealTuple>; // TEL multisig anchor escrow.
  public tede!: CatCesrIoSetSuber<TelCompletionTuple>; // TEL dissemination escrow.
  public ctel!: CesrSuber<Saider>; // Completed TEL event marker.
  public cmse!: SerderSuber<SerderACDC>; // Credential missing-signature escrow.
  public ccrd!: SerderSuber<SerderACDC>; // Completed credentials.

  static override readonly TailDirPath = "keri/reg";
  static override readonly AltTailDirPath = ".tufa/reg";
  static readonly CompatAltTailDirPath = ".keri/reg";
  static override readonly TempPrefix = "keri_reg_";
  static override readonly MaxNamedDBs = 96;

  constructor(options: RegerOptions = {}) {
    const compat = options.compat ?? false;
    super(options, {
      tailDirPath: Reger.TailDirPath,
      cleanTailDirPath: "keri/clean/reg",
      altTailDirPath: compat ? Reger.CompatAltTailDirPath : Reger.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/reg" : ".tufa/clean/reg",
      tempPrefix: Reger.TempPrefix,
      maxNamedDBs: Reger.MaxNamedDBs,
    });
  }

  /** Open the root LMDB environment and bind the KERIpy `Reger` subdb surface. */
  override *reopen(
    options: Partial<RegerOptions> = {},
  ): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) {
      return false;
    }

    try {
      this.tvts = new BytesSuber(this, { subkey: "tvts." });
      this.tels = new CesrOnSuber<Diger>(this, {
        subkey: "tels.",
        ctor: Diger,
      });
      this.ancs = new CatCesrSuber<TelAnchorTuple>(this, {
        subkey: "ancs.",
        ctor: [NumberPrimitive, Diger],
      });
      this.baks = new IoDupSuber<string>(this, { subkey: "baks." });
      this.tibs = new CesrDupSuber<Siger>(this, {
        subkey: "tibs.",
        ctor: Siger,
      });
      this.oots = new OnIoDupSuber<string>(this, { subkey: "oots" });
      this.twes = new OnIoDupSuber<string>(this, { subkey: "twes" });
      this.taes = new OnIoDupSuber<string>(this, { subkey: "taes" });
      this.tets = new CesrSuber<Dater>(this, {
        subkey: "tets.",
        ctor: Dater,
      });
      this.states = new Komer<RegStateRecord>(this, {
        subkey: "stts.",
        recordClass: RegStateRecord,
      });
      this.creds = new SerderSuber<SerderACDC>(this, {
        subkey: "creds.",
        ctor: SerderACDC,
      });
      this.cancs = new CatCesrSuber<CredentialAnchorTuple>(this, {
        subkey: "cancs.",
        ctor: [Prefixer, NumberPrimitive, Diger],
      });
      this.spsgs = new CesrIoSetSuber<Siger>(this, {
        subkey: "ssgs.",
        ctor: Siger,
      });
      this.spcgs = new CatCesrIoSetSuber<VerferCigarCouple>(this, {
        subkey: "scgs.",
        ctor: [Verfer, Cigar],
      });
      this.saved = new CesrSuber<Saider>(this, {
        subkey: "saved.",
        ctor: Saider,
      });
      this.issus = new CesrDupSuber<Saider>(this, {
        subkey: "issus.",
        ctor: Saider,
      });
      this.subjs = new CesrDupSuber<Saider>(this, {
        subkey: "subjs.",
        ctor: Saider,
      });
      this.schms = new CesrDupSuber<Saider>(this, {
        subkey: "schms.",
        ctor: Saider,
      });
      this.mre = new CesrSuber<Dater>(this, { subkey: "mre.", ctor: Dater });
      this.mce = new CesrSuber<Dater>(this, { subkey: "mce.", ctor: Dater });
      this.mse = new CesrSuber<Dater>(this, { subkey: "mse.", ctor: Dater });
      this.txnsb = new Broker(this, "txn.");
      this.regs = new Komer<RegistryRecord>(this, {
        subkey: "regs.",
        recordClass: RegistryRecord,
      });
      this.tpwe = new CatCesrIoSetSuber<TelSealTuple>(this, {
        subkey: "tpwe.",
        ctor: [Prefixer, NumberPrimitive, Diger],
      });
      this.tmse = new CatCesrIoSetSuber<TelSealTuple>(this, {
        subkey: "tmse.",
        ctor: [Prefixer, NumberPrimitive, Diger],
      });
      this.tede = new CatCesrIoSetSuber<TelCompletionTuple>(this, {
        subkey: "tede.",
        ctor: [Prefixer, NumberPrimitive, Saider],
      });
      this.ctel = new CesrSuber<Saider>(this, {
        subkey: "ctel.",
        ctor: Saider,
      });
      this.cmse = new SerderSuber<SerderACDC>(this, {
        subkey: "cmse.",
        ctor: SerderACDC,
      });
      this.ccrd = new SerderSuber<SerderACDC>(this, {
        subkey: "ccrd.",
        ctor: SerderACDC,
      });

      return this.opened;
    } catch (error) {
      throw new DatabaseOperationError(
        "Failed to open Reger sub-databases",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /** Persist one base credential and its anchoring event triple. */
  logCred(
    creder: SerderACDC,
    prefixer: Prefixer,
    number: NumberPrimitive,
    diger: Diger,
  ): boolean {
    const key = creder.said;
    if (!key) {
      throw new ValidationError("Cannot log credential without SAID.");
    }
    this.cancs.pin([key], [prefixer, number, diger]);
    return this.creds.put([key], creder);
  }

  /** Load one stored credential and the event triple that anchored it. */
  cloneCred(said: string): [SerderACDC, Prefixer, NumberPrimitive, Diger] {
    const creder = this.creds.get([said]);
    if (creder === null) {
      throw new ValidationError(`no credential found with said ${said}`);
    }
    const anchor = this.cancs.get([said]);
    if (anchor === null) {
      throw new ValidationError(`no credential anchor found with said ${said}`);
    }
    const [prefixer, number, diger] = anchor;
    return [creder, prefixer, number, diger];
  }

  /** Iterate TEL event messages for `pre` from ordinal `fn`, with attachments. */
  *clonePreIter(pre: KeyPart, fn = 0): Generator<Uint8Array> {
    for (const [, , diger] of this.tels.getAllItemIter(pre, fn)) {
      yield this.cloneTvt(pre, diger);
    }
  }

  /** Clone one TEL event message at sequence number `sn`, with attachments. */
  cloneTvtAt(pre: KeyPart, sn = 0): Uint8Array {
    const diger = this.tels.getOn(pre, sn);
    if (diger === null) {
      throw new ValidationError(
        `Missing event digest for pre=${keyText(pre)} sn=${sn}.`,
      );
    }
    return this.cloneTvt(pre, diger);
  }

  /** Clone one TEL event message by digest, including KERIpy attachment groups. */
  cloneTvt(pre: KeyPart, dig: string | Uint8Array | Diger | Saider): Uint8Array {
    const preText = keyText(pre);
    const digText = digestText(dig);
    const dgkey = dgKey(preText, digText);
    const raw = this.tvts.get(dgkey);
    if (raw === null) {
      throw new ValidationError(`Missing event for dig=${digText}.`);
    }

    const attachments: Uint8Array[] = [];
    const tibs = this.tibs.get([preText, digText]);
    if (tibs.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.WitnessIdxSigs,
          count: tibs.length,
          version: KERI_V1,
        }).qb64b,
        ...tibs.map((tib) => tib.qb64b),
      );
    }

    const couple = this.ancs.get(dgkey);
    if (couple !== null) {
      const [number, diger] = couple;
      attachments.push(
        new Counter({
          code: CtrDexV1.SealSourceCouples,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        seqnerFromNumber(number).qb64b,
        saiderFromDigest(diger).qb64b,
      );
    }

    const atc = attachments.length === 0 ? new Uint8Array() : concatBytes(...attachments);
    if (atc.length % 4 !== 0) {
      throw new ValidationError(
        `Invalid attachments size=${atc.length}, nonintegral quadlets.`,
      );
    }
    return concatBytes(
      raw,
      new Counter({
        code: CtrDexV1.AttachmentGroup,
        count: atc.length / 4,
        version: KERI_V1,
      }).qb64b,
      atc,
    );
  }

  /** Return recursive source credentials with `SealSourceTriples` attachments. */
  sources(_db: unknown, creder: SerderACDC): CredentialSource[] {
    const chains = isRecord(creder.edge) ? creder.edge : {};
    const saids: string[] = [];
    for (const [key, source] of Object.entries(chains)) {
      if (key === "d" || !isRecord(source) || typeof source.n !== "string") {
        continue;
      }
      saids.push(source.n);
    }

    const sources: CredentialSource[] = [];
    for (const said of saids) {
      const [sourceCreder, prefixer, number, diger] = this.cloneCred(said);
      const atc = concatBytes(
        new Counter({
          code: CtrDexV1.SealSourceTriples,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        prefixer.qb64b,
        number.qb64b,
        saiderFromDigest(diger).qb64b,
      );
      sources.push([sourceCreder, atc]);
      sources.push(...this.sources(_db, sourceCreder));
    }

    return sources;
  }
}

/** Open a `Reger` and return the ready-to-use databaser. */
export function* createReger(options: RegerOptions = {}): Operation<Reger> {
  const reger = new Reger(options);
  const opened = yield* reger.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Reger");
  }
  return reger;
}
