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
import {
  b,
  Cigar,
  concatBytes,
  Counter,
  Dater,
  Diger,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  SerderKERI,
  Siger,
  t,
  Verfer,
  type Versionage,
  Vrsn_1_0,
} from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import {
  attachmentCounterPayloadQb64b,
  attachmentCounterQb64b,
  resolveAttachmentGvrsn,
} from "../core/attachment-countering.ts";
import { DatabaseNotOpenError, DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { RegistryRecord, RegStateRecord, type VerferCigarCouple } from "../core/records.ts";
import { dgKey, splitOnKey } from "./core/keys.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { Broker } from "./escrowing.ts";
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
import { CapturedTelReplay, type TelReplayRange, type TelReplaySettings } from "./tel-replay.ts";

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

/** Widen the ordinal value to the fixed v1 seal encoding. */
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
 * Protocol evidence uses literal KERIpy `Reger` subkeys. The local `bens.`
 * endorsement-choice table additionally prevents a hosted signer from endorsing
 * competing digests; it is not reference protocol evidence or a delivery queue.
 */
export class Reger extends LMDBer {
  public readonly registries = new Set<string>();
  public readonly tevers = new Map<string, unknown>();

  public tvts!: BytesSuber; // Serialized TEL events keyed by `(pre, said)`.
  public tels!: CesrOnSuber<Diger>; // TEL sequence ordinals mapped to event digests.
  public ancs!: CatCesrSuber<TelAnchorTuple>; // TEL event source seal couples.
  public baks!: IoDupSuber<string>; // Backer AIDs at one TEL management state.
  /** Indexed backer proofs; out-of-order candidates are reverified against accepted cohorts before admission. */
  public tibs!: CesrDupSuber<Siger>;
  /** Local backer choice at (backer AID, TEL prefix, ordinal); signatures remain in tibs. Not an outbox. */
  public bens!: CesrOnSuber<Diger>;
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
  public ctel!: CesrSuber<Saider>; // Completed local TEL publication, valued by issuer anchor SAID.
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
      this.bens = new CesrOnSuber<Diger>(this, { subkey: "bens.", ctor: Diger });
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
        { cause: error },
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

  /** Iterate TEL events from ordinal `fn`, honoring the requested attachment genus floor. */
  *clonePreIter(
    pre: KeyPart,
    fn = 0,
    gvrsn: Versionage = Vrsn_1_0,
  ): Generator<Uint8Array> {
    for (const [, , diger] of this.tels.getAllItemIter(pre, fn)) {
      yield this.cloneTvt(pre, diger, gvrsn);
    }
  }

  /** Capture one TEL extent without body reads; each reader releases its cursor before yielding. */
  replay(
    pre: string,
    { gvrsn = Vrsn_1_0, genusify = false }: {
      gvrsn?: Versionage;
      genusify?: boolean;
    } = {},
  ): CapturedTelReplay | null {
    let end: number | null = null;
    for (const entry of this.tels.sdb.getRange({ start: b(`${pre}.${"f".repeat(32)}`), reverse: true, limit: 1 })) {
      const [prefix, ordinal] = splitOnKey(entry.key);
      if (t(prefix) === pre) end = ordinal;
    }
    if (end === null) return null;
    if (!Number.isFinite(end) || end < 0) throw new DatabaseOperationError("Corrupt TEL replay ordinal");
    if (!Number.isSafeInteger(end)) throw new RangeError("TEL replay ordinal exceeds supported range");
    return new CapturedTelReplay(this, [[pre, end]], { gvrsn, genusify });
  }

  /** Consume one captured horizon without retaining a cursor or event queue across a yield. */
  *replayRange(
    [pre, last]: TelReplayRange,
    { gvrsn, genusify }: TelReplaySettings,
  ): Generator<Uint8Array> {
    if (
      !pre || !Number.isSafeInteger(last) || last < 0
    ) {
      throw new RangeError("Invalid captured TEL range");
    }
    let next = 0;
    while (next <= last) {
      const rows = this.tels.getAllItemIter(pre, next);
      let row: [string[], number, Diger] | undefined;
      try {
        row = rows.next().value;
      } finally {
        rows.return(undefined);
      }
      if (!row || row[1] > last) break;
      const [, ordinal, diger] = row;
      if (!Number.isSafeInteger(ordinal) || ordinal < next) {
        throw new DatabaseOperationError("Corrupt TEL replay sequence");
      }
      next = ordinal + 1;
      yield this.cloneTvt(pre, diger, gvrsn, genusify);
    }
  }

  /** Clone one TEL event at sequence `sn`, preserving its body and honoring the genus floor. */
  cloneTvtAt(
    pre: KeyPart,
    sn = 0,
    gvrsn: Versionage = Vrsn_1_0,
  ): Uint8Array {
    const diger = this.tels.getOn(pre, sn);
    if (diger === null) {
      throw new ValidationError(
        `Missing event digest for pre=${keyText(pre)} sn=${sn}.`,
      );
    }
    return this.cloneTvt(pre, diger, gvrsn);
  }

  /** Clone one TEL body and its stored proofs, preserving its minimum/requested genus. */
  cloneTvt(
    pre: KeyPart,
    dig: string | Uint8Array | Diger | Saider,
    gvrsn: Versionage = Vrsn_1_0,
    genusify = false,
  ): Uint8Array {
    const preText = keyText(pre);
    const digText = digestText(dig);
    const dgkey = dgKey(preText, digText);
    const raw = this.tvts.get(dgkey);
    if (raw === null) {
      throw new ValidationError(`Missing event for dig=${digText}.`);
    }

    // Native dupsort yields one fixed signature record at a time, without collecting its bucket.
    const tibPayload: Uint8Array[] = [];
    for (const tib of this.tibs.getIter([preText, digText])) {
      tibPayload.push(tib.qb64b);
    }
    const couple = this.ancs.get(dgkey);
    if (tibPayload.length === 0 && couple === null && !genusify) return raw;
    // A requested genus is a floor; retain the body bytes and honor its declared minimum.
    gvrsn = resolveAttachmentGvrsn(new SerderKERI({ raw }), gvrsn);
    const selector = genusify ? Counter.makeGVC(gvrsn) : new Uint8Array();
    if (tibPayload.length === 0 && couple === null) {
      return concatBytes(selector, raw);
    }
    const attachments: Uint8Array[] = [];
    if (tibPayload.length > 0) {
      attachments.push(attachmentCounterPayloadQb64b("WitnessIdxSigs", tibPayload.length, tibPayload, gvrsn));
      for (const part of tibPayload) attachments.push(part);
    }

    if (couple !== null) {
      const [number, diger] = couple;
      const sealPayload = [
        gvrsn.major === 1 ? seqnerFromNumber(number).qb64b : number.qb64b,
        saiderFromDigest(diger).qb64b,
      ];
      attachments.push(
        attachmentCounterPayloadQb64b(
          "SealSourceCouples",
          1,
          sealPayload,
          gvrsn,
        ),
        ...sealPayload,
      );
    }

    const attachmentBytes = attachments.reduce((total, item) => total + item.length, 0);
    const counter = attachmentCounterQb64b("AttachmentGroup", attachmentBytes / 4, gvrsn);
    const atc = new Uint8Array(attachmentBytes);
    let offset = 0;
    for (const part of attachments) {
      atc.set(part, offset);
      offset += part.length;
    }
    if (atc.length % 4 !== 0) {
      throw new ValidationError(
        `Invalid attachments size=${atc.length}, nonintegral quadlets.`,
      );
    }
    return concatBytes(
      selector,
      raw,
      counter,
      atc,
    );
  }

  /** Return recursive source credentials with source seals at each body/requested genus floor. */
  sources(
    _db: unknown,
    creder: SerderACDC,
    gvrsn: Versionage = Vrsn_1_0,
  ): CredentialSource[] {
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
      const selected = resolveAttachmentGvrsn(sourceCreder, gvrsn);
      const sealPayload = [
        prefixer.qb64b,
        selected.major === 1 ? seqnerFromNumber(number).qb64b : number.qb64b,
        saiderFromDigest(diger).qb64b,
      ];
      const atc = concatBytes(
        attachmentCounterPayloadQb64b(
          "SealSourceTriples",
          1,
          sealPayload,
          selected,
        ),
        ...sealPayload,
      );
      sources.push([sourceCreder, atc]);
      sources.push(...this.sources(_db, sourceCreder, gvrsn));
    }

    return sources;
  }
}

/** Transfer a ready `Reger` to its caller, closing unreturned acquisitions on failure or cancellation. */
export function* createReger(options: RegerOptions = {}): Operation<Reger> {
  const reger = new Reger(options);
  let delivered = false;
  let failure: { error: unknown } | undefined;
  try {
    const opened = yield* reger.reopen(options);
    if (!opened) {
      throw new DatabaseNotOpenError("Failed to open Reger");
    }
    delivered = true;
    return reger;
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    if (!delivered) {
      try {
        yield* reger.close();
      } catch (error) {
        if (failure) {
          // deno-lint-ignore no-unsafe-finally -- Preserve the operation failure alongside shutdown failure.
          throw new AggregateError([failure.error, error], "Database acquisition and close failed", {
            cause: failure.error,
          });
        }
        // deno-lint-ignore no-unsafe-finally -- A shutdown failure must propagate.
        throw error;
      }
    }
  }
}
