import type { AttachmentGroup } from "../../../cesr/mod.ts";
import {
  Cigar,
  Dater,
  Diger,
  Labeler,
  Noncer,
  NumberPrimitive,
  Prefixer,
  Seqner,
  SerderKERI,
  Siger,
  Texter,
  Verfer,
  Verser,
} from "../../../cesr/mod.ts";

/** Fixed-width or compact ordinal primitive accepted by runtime dispatch groups. */
export type DispatchOrdinal = Seqner | NumberPrimitive;
type Qb64b = Uint8Array;

/** One non-transferable receipt couple carried in parser dispatch state. */
export class CigarCouple {
  readonly verfer: Verfer;
  readonly cigar: Cigar;

  constructor(verfer: Verfer, cigar: Cigar) {
    this.verfer = verfer;
    this.cigar = cigar;
  }

  static fromTuple(tuple: readonly [Verfer, Cigar]): CigarCouple {
    return new CigarCouple(tuple[0], tuple[1]);
  }

  /** Hydrate one parser-facing receipt couple directly from qb64b primitives. */
  static fromQb64bTuple(tuple: readonly [Qb64b, Qb64b]): CigarCouple {
    return new CigarCouple(
      new Verfer({ qb64b: tuple[0] }),
      new Cigar({ qb64b: tuple[1] }),
    );
  }

  toTuple(): [Verfer, Cigar] {
    return [this.verfer, this.cigar];
  }

  get aid(): string {
    return this.verfer.qb64;
  }

  get verferQb64(): string {
    return this.verfer.qb64;
  }
}

/** One transferable receipt quadruple carried in parser dispatch state. */
export class TransReceiptQuadruple {
  readonly prefixer: Prefixer;
  readonly seqner: DispatchOrdinal;
  readonly diger: Diger;
  readonly siger: Siger;

  constructor(
    prefixer: Prefixer,
    seqner: DispatchOrdinal,
    diger: Diger,
    siger: Siger,
  ) {
    this.prefixer = prefixer;
    this.seqner = seqner;
    this.diger = diger;
    this.siger = siger;
  }

  static fromTuple(
    tuple: readonly [Prefixer, DispatchOrdinal, Diger, Siger],
  ): TransReceiptQuadruple {
    return new TransReceiptQuadruple(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  /**
   * Hydrate one parser-facing transferable receipt quadruple from qb64b
   * primitives.
   */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
  ): TransReceiptQuadruple {
    return new TransReceiptQuadruple(
      new Prefixer({ qb64b: tuple[0] }),
      new NumberPrimitive({ qb64b: tuple[1] }),
      new Diger({ qb64b: tuple[2] }),
      new Siger({ qb64b: tuple[3] }),
    );
  }

  toTuple(): [Prefixer, DispatchOrdinal, Diger, Siger] {
    return [this.prefixer, this.seqner, this.diger, this.siger];
  }

  get pre(): string {
    return this.prefixer.qb64;
  }

  get sn(): bigint {
    return this.seqner instanceof Seqner ? this.seqner.sn : this.seqner.num;
  }

  get snh(): string {
    return this.seqner instanceof Seqner ? this.seqner.snh : this.seqner.numh;
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** One transferable indexed-signature group carried in parser dispatch state. */
export class TransIdxSigGroup {
  readonly prefixer: Prefixer;
  readonly seqner: DispatchOrdinal;
  readonly diger: Diger;
  readonly sigers: Siger[];

  constructor(
    prefixer: Prefixer,
    seqner: DispatchOrdinal,
    diger: Diger,
    sigers: readonly Siger[],
  ) {
    this.prefixer = prefixer;
    this.seqner = seqner;
    this.diger = diger;
    this.sigers = [...sigers];
  }

  static fromTuple(
    tuple: readonly [Prefixer, DispatchOrdinal, Diger, readonly Siger[]],
  ): TransIdxSigGroup {
    return new TransIdxSigGroup(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  /**
   * Hydrate one parser-facing transferable indexed-signature group from qb64b
   * primitives plus already-normalized `Siger` members.
   */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b],
    sigers: readonly Siger[],
  ): TransIdxSigGroup {
    return new TransIdxSigGroup(
      new Prefixer({ qb64b: tuple[0] }),
      new NumberPrimitive({ qb64b: tuple[1] }),
      new Diger({ qb64b: tuple[2] }),
      sigers,
    );
  }

  toTuple(): [Prefixer, DispatchOrdinal, Diger, Siger[]] {
    return [this.prefixer, this.seqner, this.diger, [...this.sigers]];
  }

  get pre(): string {
    return this.prefixer.qb64;
  }

  get sn(): bigint {
    return this.seqner instanceof Seqner ? this.seqner.sn : this.seqner.num;
  }

  get snh(): string {
    return this.seqner instanceof Seqner ? this.seqner.snh : this.seqner.numh;
  }

  get said(): string {
    return this.diger.qb64;
  }

  get routeKey(): string {
    return `${this.pre}.${this.snh}.${this.said}`;
  }
}

/** One last-establishment transferable signature group carried in dispatch state. */
export class TransLastIdxSigGroup {
  readonly prefixer: Prefixer;
  readonly sigers: Siger[];

  constructor(prefixer: Prefixer, sigers: readonly Siger[]) {
    this.prefixer = prefixer;
    this.sigers = [...sigers];
  }

  static fromTuple(
    tuple: readonly [Prefixer, readonly Siger[]],
  ): TransLastIdxSigGroup {
    return new TransLastIdxSigGroup(tuple[0], tuple[1]);
  }

  /**
   * Hydrate one parser-facing last-establishment signature group from qb64b
   * prefix material plus already-normalized `Siger` members.
   */
  static fromQb64bTuple(
    prefixerQb64b: Qb64b,
    sigers: readonly Siger[],
  ): TransLastIdxSigGroup {
    return new TransLastIdxSigGroup(
      new Prefixer({ qb64b: prefixerQb64b }),
      sigers,
    );
  }

  toTuple(): [Prefixer, Siger[]] {
    return [this.prefixer, [...this.sigers]];
  }

  get pre(): string {
    return this.prefixer.qb64;
  }
}

/** One first-seen replay couple carried in parser dispatch state. */
export class FirstSeenReplayCouple {
  readonly firner: NumberPrimitive;
  readonly dater: Dater;

  constructor(firner: NumberPrimitive, dater: Dater) {
    this.firner = firner;
    this.dater = dater;
  }

  static fromTuple(
    tuple: readonly [NumberPrimitive, Dater],
  ): FirstSeenReplayCouple {
    return new FirstSeenReplayCouple(tuple[0], tuple[1]);
  }

  /** Hydrate one parser-facing first-seen replay couple from qb64b primitives. */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b],
  ): FirstSeenReplayCouple {
    return new FirstSeenReplayCouple(
      new NumberPrimitive({ qb64b: tuple[0] }),
      new Dater({ qb64b: tuple[1] }),
    );
  }

  toTuple(): [NumberPrimitive, Dater] {
    return [this.firner, this.dater];
  }

  get fn(): bigint {
    return this.firner.num;
  }

  get fnh(): string {
    return this.firner.numh;
  }
}

/** One source-seal couple carried in parser dispatch state. */
export class SourceSealCouple {
  readonly seqner: DispatchOrdinal;
  readonly diger: Diger;

  constructor(seqner: DispatchOrdinal, diger: Diger) {
    this.seqner = seqner;
    this.diger = diger;
  }

  static fromTuple(tuple: readonly [DispatchOrdinal, Diger]): SourceSealCouple {
    return new SourceSealCouple(tuple[0], tuple[1]);
  }

  /** Hydrate one parser-facing source-seal couple from qb64b primitives. */
  static fromQb64bTuple(tuple: readonly [Qb64b, Qb64b]): SourceSealCouple {
    return new SourceSealCouple(
      new NumberPrimitive({ qb64b: tuple[0] }),
      new Diger({ qb64b: tuple[1] }),
    );
  }

  toTuple(): [DispatchOrdinal, Diger] {
    return [this.seqner, this.diger];
  }

  get sn(): bigint {
    return this.seqner instanceof Seqner ? this.seqner.sn : this.seqner.num;
  }

  get snh(): string {
    return this.seqner instanceof Seqner ? this.seqner.snh : this.seqner.numh;
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** One source-seal triple carried in parser dispatch state. */
export class SourceSealTriple {
  readonly prefixer: Prefixer;
  readonly seqner: DispatchOrdinal;
  readonly diger: Diger;

  constructor(prefixer: Prefixer, seqner: DispatchOrdinal, diger: Diger) {
    this.prefixer = prefixer;
    this.seqner = seqner;
    this.diger = diger;
  }

  static fromTuple(
    tuple: readonly [Prefixer, DispatchOrdinal, Diger],
  ): SourceSealTriple {
    return new SourceSealTriple(tuple[0], tuple[1], tuple[2]);
  }

  /** Hydrate one parser-facing source-seal triple from qb64b primitives. */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b],
  ): SourceSealTriple {
    return new SourceSealTriple(
      new Prefixer({ qb64b: tuple[0] }),
      new NumberPrimitive({ qb64b: tuple[1] }),
      new Diger({ qb64b: tuple[2] }),
    );
  }

  toTuple(): [Prefixer, DispatchOrdinal, Diger] {
    return [this.prefixer, this.seqner, this.diger];
  }

  get pre(): string {
    return this.prefixer.qb64;
  }

  get sn(): bigint {
    return this.seqner instanceof Seqner ? this.seqner.sn : this.seqner.num;
  }

  get snh(): string {
    return this.seqner instanceof Seqner ? this.seqner.snh : this.seqner.numh;
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** One typed-digest seal couple carried in parser dispatch state. */
export class TypedDigestSealCouple {
  readonly verser: Verser;
  readonly diger: Diger;

  constructor(verser: Verser, diger: Diger) {
    this.verser = verser;
    this.diger = diger;
  }

  static fromTuple(
    tuple: readonly [Verser, Diger],
  ): TypedDigestSealCouple {
    return new TypedDigestSealCouple(tuple[0], tuple[1]);
  }

  /** Hydrate one parser-facing typed-digest seal couple from qb64b primitives. */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b],
  ): TypedDigestSealCouple {
    return new TypedDigestSealCouple(
      new Verser({ qb64b: tuple[0] }),
      new Diger({ qb64b: tuple[1] }),
    );
  }

  toTuple(): [Verser, Diger] {
    return [this.verser, this.diger];
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** One pathed-material payload group carried in parser dispatch state. */
export class PathedMaterialGroup {
  readonly raw: Uint8Array;

  constructor(raw: Uint8Array) {
    this.raw = raw.slice();
  }

  /** Hydrate one parser-facing pathed-material payload from raw group bytes. */
  static fromRaw(raw: Uint8Array): PathedMaterialGroup {
    return new PathedMaterialGroup(raw);
  }
}

/** One blinded-state quadruple carried in parser dispatch state. */
export class BlindedStateQuadruple {
  readonly diger: Diger;
  readonly noncer: Noncer;
  readonly acdcer: Noncer;
  readonly stater: Labeler;

  constructor(
    diger: Diger,
    noncer: Noncer,
    acdcer: Noncer,
    stater: Labeler,
  ) {
    this.diger = diger;
    this.noncer = noncer;
    this.acdcer = acdcer;
    this.stater = stater;
  }

  static fromTuple(
    tuple: readonly [Diger, Noncer, Noncer, Labeler],
  ): BlindedStateQuadruple {
    return new BlindedStateQuadruple(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  /** Hydrate one parser-facing blinded-state quadruple from qb64b primitives. */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
  ): BlindedStateQuadruple {
    return new BlindedStateQuadruple(
      new Diger({ qb64b: tuple[0] }),
      new Noncer({ qb64b: tuple[1] }),
      new Noncer({ qb64b: tuple[2] }),
      new Labeler({ qb64b: tuple[3] }),
    );
  }

  toTuple(): [Diger, Noncer, Noncer, Labeler] {
    return [this.diger, this.noncer, this.acdcer, this.stater];
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** One bound-state sextuple carried in parser dispatch state. */
export class BoundStateSextuple {
  readonly diger: Diger;
  readonly noncer: Noncer;
  readonly acdcer: Noncer;
  readonly stater: Labeler;
  readonly number: NumberPrimitive;
  readonly eventer: Noncer;

  constructor(
    diger: Diger,
    noncer: Noncer,
    acdcer: Noncer,
    stater: Labeler,
    number: NumberPrimitive,
    eventer: Noncer,
  ) {
    this.diger = diger;
    this.noncer = noncer;
    this.acdcer = acdcer;
    this.stater = stater;
    this.number = number;
    this.eventer = eventer;
  }

  static fromTuple(
    tuple: readonly [Diger, Noncer, Noncer, Labeler, NumberPrimitive, Noncer],
  ): BoundStateSextuple {
    return new BoundStateSextuple(
      tuple[0],
      tuple[1],
      tuple[2],
      tuple[3],
      tuple[4],
      tuple[5],
    );
  }

  /** Hydrate one parser-facing bound-state sextuple from qb64b primitives. */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b, Qb64b, Qb64b],
  ): BoundStateSextuple {
    return new BoundStateSextuple(
      new Diger({ qb64b: tuple[0] }),
      new Noncer({ qb64b: tuple[1] }),
      new Noncer({ qb64b: tuple[2] }),
      new Labeler({ qb64b: tuple[3] }),
      new NumberPrimitive({ qb64b: tuple[4] }),
      new Noncer({ qb64b: tuple[5] }),
    );
  }

  toTuple(): [Diger, Noncer, Noncer, Labeler, NumberPrimitive, Noncer] {
    return [
      this.diger,
      this.noncer,
      this.acdcer,
      this.stater,
      this.number,
      this.eventer,
    ];
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** One typed-media quadruple carried in parser dispatch state. */
export class TypedMediaQuadruple {
  readonly diger: Diger;
  readonly noncer: Noncer;
  readonly labeler: Labeler;
  readonly texter: Texter;

  constructor(
    diger: Diger,
    noncer: Noncer,
    labeler: Labeler,
    texter: Texter,
  ) {
    this.diger = diger;
    this.noncer = noncer;
    this.labeler = labeler;
    this.texter = texter;
  }

  static fromTuple(
    tuple: readonly [Diger, Noncer, Labeler, Texter],
  ): TypedMediaQuadruple {
    return new TypedMediaQuadruple(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  /** Hydrate one parser-facing typed-media quadruple from qb64b primitives. */
  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
  ): TypedMediaQuadruple {
    return new TypedMediaQuadruple(
      new Diger({ qb64b: tuple[0] }),
      new Noncer({ qb64b: tuple[1] }),
      new Labeler({ qb64b: tuple[2] }),
      new Texter({ qb64b: tuple[3] }),
    );
  }

  toTuple(): [Diger, Noncer, Labeler, Texter] {
    return [this.diger, this.noncer, this.labeler, this.texter];
  }

  get said(): string {
    return this.diger.qb64;
  }
}

/** Construction arguments for one normalized KERI dispatch envelope. */
export interface KeriDispatchEnvelopeInit {
  serder: SerderKERI;
  attachmentGroups: AttachmentGroup[];
  local: boolean;
  sigers?: Siger[];
  wigers?: Siger[];
  cigars?: CigarCouple[];
  trqs?: TransReceiptQuadruple[];
  tsgs?: TransIdxSigGroup[];
  ssgs?: TransLastIdxSigGroup[];
  frcs?: FirstSeenReplayCouple[];
  sscs?: SourceSealCouple[];
  ssts?: SourceSealTriple[];
  tdcs?: TypedDigestSealCouple[];
  ptds?: PathedMaterialGroup[];
  essrs?: Texter[];
  bsqs?: BlindedStateQuadruple[];
  bsss?: BoundStateSextuple[];
  tmqs?: TypedMediaQuadruple[];
}

/**
 * Normalized parser-dispatch envelope.
 *
 * KERIpy correspondence:
 * - this is the `keri-ts` equivalent of the parser `exts` accumulation dict
 *   used to hand normalized attachment families into KERI/TEL dispatch
 *
 * Design rule:
 * - keep KERIpy family names on the envelope for porting familiarity
 * - use named value objects for each family element so maintainers do not have
 *   to mentally decode anonymous tuple-like object literals at every call site
 */
export class KeriDispatchEnvelope {
  readonly serder: SerderKERI;
  readonly attachmentGroups: readonly AttachmentGroup[];
  readonly local: boolean;
  readonly sigers: Siger[];
  readonly wigers: Siger[];
  readonly cigars: CigarCouple[];
  readonly trqs: TransReceiptQuadruple[];
  readonly tsgs: TransIdxSigGroup[];
  readonly ssgs: TransLastIdxSigGroup[];
  readonly frcs: FirstSeenReplayCouple[];
  readonly sscs: SourceSealCouple[];
  readonly ssts: SourceSealTriple[];
  readonly tdcs: TypedDigestSealCouple[];
  readonly ptds: PathedMaterialGroup[];
  readonly essrs: Texter[];
  readonly bsqs: BlindedStateQuadruple[];
  readonly bsss: BoundStateSextuple[];
  readonly tmqs: TypedMediaQuadruple[];

  constructor(init: KeriDispatchEnvelopeInit) {
    this.serder = init.serder;
    this.attachmentGroups = [...init.attachmentGroups];
    this.local = init.local;
    this.sigers = [...(init.sigers ?? [])];
    this.wigers = [...(init.wigers ?? [])];
    this.cigars = [...(init.cigars ?? [])];
    this.trqs = [...(init.trqs ?? [])];
    this.tsgs = [...(init.tsgs ?? [])];
    this.ssgs = [...(init.ssgs ?? [])];
    this.frcs = [...(init.frcs ?? [])];
    this.sscs = [...(init.sscs ?? [])];
    this.ssts = [...(init.ssts ?? [])];
    this.tdcs = [...(init.tdcs ?? [])];
    this.ptds = [...(init.ptds ?? [])];
    this.essrs = [...(init.essrs ?? [])];
    this.bsqs = [...(init.bsqs ?? [])];
    this.bsss = [...(init.bsss ?? [])];
    this.tmqs = [...(init.tmqs ?? [])];
  }

  get lastFrc(): FirstSeenReplayCouple | null {
    return this.frcs.at(-1) ?? null;
  }

  get lastSsc(): SourceSealCouple | null {
    return this.sscs.at(-1) ?? null;
  }

  get lastSst(): SourceSealTriple | null {
    return this.ssts.at(-1) ?? null;
  }
}
