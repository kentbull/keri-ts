import type { AttachmentGroup } from "cesr-ts";
import {
  type BlindState,
  type BoundState,
  type CesrFrame,
  Cigar,
  Diger,
  type EssrPayload,
  type FirstSeen,
  NumberPrimitive,
  Prefixer,
  type SealEvent,
  type SealKind,
  type SealSource,
  Seqner,
  SerderKERI,
  Siger,
  type TypeMedia,
} from "cesr-ts";

/** Fixed-width or compact ordinal primitive accepted by runtime dispatch groups. */
export type DispatchOrdinal = Seqner | NumberPrimitive;

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

  toTuple(): [Prefixer, Siger[]] {
    return [this.prefixer, [...this.sigers]];
  }

  get pre(): string {
    return this.prefixer.qb64;
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

/** Construction arguments for one normalized KERI dispatch envelope. */
export interface KeriDispatchEnvelopeInit {
  serder: SerderKERI;
  attachmentGroups: AttachmentGroup[];
  local: boolean;
  sigers?: Siger[];
  wigers?: Siger[];
  cigars?: Cigar[];
  trqs?: TransReceiptQuadruple[];
  tsgs?: TransIdxSigGroup[];
  ssgs?: TransLastIdxSigGroup[];
  frcs?: FirstSeen[];
  sscs?: SealSource[];
  ssts?: SealEvent[];
  tdcs?: SealKind[];
  ptds?: PathedMaterialGroup[];
  /** Reopenable ESSR wire and decoded view; the dispatch caller owns disposal. */
  essr?: EssrPayload;
  /** Borrowed child trees retain separate evidence and caller-owned payloads. */
  nests?: readonly CesrFrame[];
  bsqs?: BlindState[];
  bsss?: BoundState[];
  tmqs?: TypeMedia[];
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
 * - fixed-field seal/blind/media families now use CESR structing records
 *   directly instead of `packages/keri`-local wrapper classes
 *
 * KERIpy runtime rule:
 * - non-transferable receipt couples are normalized into `Cigar` instances
 *   with attached `.verfer` before they reach reply/runtime processors
 */
export class KeriDispatchEnvelope {
  readonly serder: SerderKERI;
  readonly attachmentGroups: readonly AttachmentGroup[];
  readonly local: boolean;
  readonly sigers: Siger[];
  readonly wigers: Siger[];
  readonly cigars: Cigar[];
  readonly trqs: TransReceiptQuadruple[];
  readonly tsgs: TransIdxSigGroup[];
  readonly ssgs: TransLastIdxSigGroup[];
  readonly frcs: FirstSeen[];
  readonly sscs: SealSource[];
  readonly ssts: SealEvent[];
  readonly tdcs: SealKind[];
  readonly ptds: PathedMaterialGroup[];
  /** Shared payload views preserve parser ownership through dispatch. */
  readonly essr?: EssrPayload;
  /** Child evidence is route-specific and never merged into parent signatures. */
  readonly nests: readonly CesrFrame[];
  readonly bsqs: BlindState[];
  readonly bsss: BoundState[];
  readonly tmqs: TypeMedia[];

  /** Project parent evidence while borrowing complete child trees from the dispatch owner. */
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
    this.essr = init.essr;
    this.nests = init.nests ?? [];
    this.bsqs = [...(init.bsqs ?? [])];
    this.bsss = [...(init.bsss ?? [])];
    this.tmqs = [...(init.tmqs ?? [])];
  }

  get lastFrc(): FirstSeen | null {
    return this.frcs.at(-1) ?? null;
  }

  get lastSsc(): SealSource | null {
    return this.sscs.at(-1) ?? null;
  }

  get lastSst(): SealEvent | null {
    return this.ssts.at(-1) ?? null;
  }
}
