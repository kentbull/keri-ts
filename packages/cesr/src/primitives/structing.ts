import { b, concatBytes } from "../core/bytes.ts";
import type { CounterCodeNameV1, CounterCodeNameV2 } from "../tables/counter-codex.ts";
import { Diger } from "./diger.ts";
import { Labeler } from "./labeler.ts";
import type { Matter, MatterInit } from "./matter.ts";
import { Noncer } from "./noncer.ts";
import { NumberPrimitive } from "./number.ts";
import { Prefixer } from "./prefixer.ts";
import { Texter } from "./texter.ts";
import { Verser } from "./verser.ts";

type Qb64b = Uint8Array;

/**
 * Fixed-field CESR primitive admitted by KERIpy `structing.py` cast tables.
 *
 * Maintainer model:
 * - these are the semantic field types used by the structing value classes
 * - this layer is narrower than parser/runtime helper unions on purpose
 */
export type StructingPrimitive =
  | Diger
  | Labeler
  | Noncer
  | NumberPrimitive
  | Prefixer
  | Texter
  | Verser;

/** Constructor contract for one primitive referenced by structing cast metadata. */
export type StructingPrimitiveCtor<
  T extends StructingPrimitive = StructingPrimitive,
> = new(init: Matter | MatterInit) => T;

/**
 * Field-cast metadata ported from KERIpy `Castage`.
 *
 * `ipn` records which primitive property should be exposed in crew/object form.
 * When `ipn` is `null`, the field serializes through canonical `qb64`.
 */
export class Castage<T extends StructingPrimitive = StructingPrimitive> {
  readonly kls: StructingPrimitiveCtor<T>;
  readonly ipn: string | null;

  constructor(kls: StructingPrimitiveCtor<T>, ipn: string | null = null) {
    this.kls = kls;
    this.ipn = ipn;
  }
}

function castage<T extends StructingPrimitive>(
  kls: StructingPrimitiveCtor<T>,
  ipn: string | null = null,
): Readonly<Castage<T>> {
  return Object.freeze(new Castage(kls, ipn));
}

type StructingCrewValue = string;

function serializeCrewField(
  field: StructingPrimitive,
  ipn: string | null,
): StructingCrewValue {
  const prop = ipn ?? "qb64";
  const value = Reflect.get(field as object, prop);
  if (typeof value !== "string") {
    throw new TypeError(
      `Structing field ${field.constructor.name} does not expose string property ${prop}.`,
    );
  }
  return value;
}

function buildCrew<K extends string>(
  fieldNames: readonly K[],
  castages: readonly Readonly<Castage>[],
  fields: readonly StructingPrimitive[],
): Readonly<Record<K, StructingCrewValue>> {
  if (
    fieldNames.length !== castages.length || castages.length !== fields.length
  ) {
    throw new Error(
      "Structing crew metadata is inconsistent with tuple width.",
    );
  }

  const out = {} as Record<K, StructingCrewValue>;
  for (let index = 0; index < fieldNames.length; index++) {
    out[fieldNames[index]] = serializeCrewField(
      fields[index],
      castages[index].ipn,
    );
  }
  return Object.freeze(out);
}

function invertClanCodens<TClan extends string, TCoden extends string>(
  map: Readonly<Record<TClan, TCoden>>,
): Readonly<Record<TCoden, TClan>> {
  const out = {} as Record<TCoden, TClan>;
  for (const [clan, coden] of Object.entries(map) as [TClan, TCoden][]) {
    out[coden] = clan;
  }
  return Object.freeze(out);
}

abstract class StructValue<
  TTuple extends readonly StructingPrimitive[],
  TCrew extends object,
> {
  protected abstract readonly fieldNames: readonly (keyof TCrew & string)[];
  protected abstract readonly castages: readonly Readonly<Castage>[];

  /** Return the fixed ordered primitive tuple for this struct value. */
  abstract toTuple(): TTuple;

  /** KERIpy-aligned clan/tag name for the fixed-field struct family. */
  get clan(): string {
    return (this.constructor as { name: string }).name;
  }

  /**
   * Crew/object projection using KERIpy `Castage.ipn` semantics.
   *
   * TypeScript divergence:
   * - KERIpy uses namedtuples of strings
   * - `keri-ts` stores narrow primitives directly and projects crew lazily
   */
  get crew(): Readonly<TCrew> {
    return buildCrew(
      this.fieldNames as readonly string[],
      this.castages,
      this.toTuple(),
    ) as Readonly<TCrew>;
  }

  /** Plain object copy of the current crew projection. */
  asDict(): TCrew {
    return { ...this.crew };
  }

  /** Concatenated qb64 payload (`counter` excluded). */
  get qb64(): string {
    return this.toTuple().map((field) => field.qb64).join("");
  }

  /** UTF-8 companion to `.qb64`. */
  get qb64b(): Uint8Array {
    return b(this.qb64);
  }

  /** Concatenated qb2 payload (`counter` excluded). */
  get qb2(): Uint8Array {
    return concatBytes(...this.toTuple().map((field) => field.qb2));
  }
}

export type SealDigestTuple = readonly [Diger];
export interface SealDigestCrew {
  d: string;
}

const SEAL_DIGEST_FIELDS = Object.freeze(["d"] as const);
const SEAL_DIGEST_CASTS = Object.freeze([castage(Diger)] as const);

/**
 * Digest seal fixed-field value (`d`).
 *
 * KERIpy substance:
 * - named single-value seal used for SAID/digest anchoring
 */
export class SealDigest extends StructValue<SealDigestTuple, SealDigestCrew> {
  protected readonly fieldNames = SEAL_DIGEST_FIELDS;
  protected readonly castages = SEAL_DIGEST_CASTS;
  readonly d: Diger;

  constructor(d: Diger) {
    super();
    this.d = d;
  }

  static fromTuple(tuple: SealDigestTuple): SealDigest {
    return new SealDigest(tuple[0]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b]): SealDigest {
    return new SealDigest(new Diger({ qb64b: tuple[0] }));
  }

  toTuple(): SealDigestTuple {
    return [this.d];
  }

  get said(): string {
    return this.d.qb64;
  }

  get saidb(): Uint8Array {
    return this.d.qb64b;
  }
}

export type SealRootTuple = readonly [Diger];
export interface SealRootCrew {
  rd: string;
}

const SEAL_ROOT_FIELDS = Object.freeze(["rd"] as const);
const SEAL_ROOT_CASTS = Object.freeze([castage(Diger)] as const);

/**
 * Merkle-root seal fixed-field value (`rd`).
 *
 * KERIpy substance:
 * - named single-value seal for anchored Merkle-tree root digests
 */
export class SealRoot extends StructValue<SealRootTuple, SealRootCrew> {
  protected readonly fieldNames = SEAL_ROOT_FIELDS;
  protected readonly castages = SEAL_ROOT_CASTS;
  readonly rd: Diger;

  constructor(rd: Diger) {
    super();
    this.rd = rd;
  }

  static fromTuple(tuple: SealRootTuple): SealRoot {
    return new SealRoot(tuple[0]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b]): SealRoot {
    return new SealRoot(new Diger({ qb64b: tuple[0] }));
  }

  toTuple(): SealRootTuple {
    return [this.rd];
  }

  get root(): string {
    return this.rd.qb64;
  }

  get rootb(): Uint8Array {
    return this.rd.qb64b;
  }
}

export type SealSourceTuple = readonly [NumberPrimitive, Diger];
export interface SealSourceCrew {
  s: string;
  d: string;
}

const SEAL_SOURCE_FIELDS = Object.freeze(["s", "d"] as const);
const SEAL_SOURCE_CASTS = Object.freeze(
  [
    castage(NumberPrimitive, "numh"),
    castage(Diger),
  ] as const,
);

/**
 * Source seal fixed-field value (`s`, `d`).
 *
 * Maintainer model:
 * - the issuer/delegator prefix is implied by surrounding context
 * - `s` stays a real `NumberPrimitive`; crew/object form projects `.numh`
 */
export class SealSource extends StructValue<SealSourceTuple, SealSourceCrew> {
  protected readonly fieldNames = SEAL_SOURCE_FIELDS;
  protected readonly castages = SEAL_SOURCE_CASTS;
  readonly s: NumberPrimitive;
  readonly d: Diger;

  constructor(s: NumberPrimitive, d: Diger) {
    super();
    this.s = s;
    this.d = d;
  }

  static fromTuple(tuple: SealSourceTuple): SealSource {
    return new SealSource(tuple[0], tuple[1]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b, Qb64b]): SealSource {
    return new SealSource(
      new NumberPrimitive({ qb64b: tuple[0] }),
      new Diger({ qb64b: tuple[1] }),
    );
  }

  toTuple(): SealSourceTuple {
    return [this.s, this.d];
  }

  get sn(): bigint {
    return this.s.num;
  }

  get snh(): string {
    return this.s.numh;
  }

  get said(): string {
    return this.d.qb64;
  }

  get saidb(): Uint8Array {
    return this.d.qb64b;
  }
}

export type SealEventTuple = readonly [Prefixer, NumberPrimitive, Diger];
export interface SealEventCrew {
  i: string;
  s: string;
  d: string;
}

const SEAL_EVENT_FIELDS = Object.freeze(["i", "s", "d"] as const);
const SEAL_EVENT_CASTS = Object.freeze(
  [
    castage(Prefixer),
    castage(NumberPrimitive, "numh"),
    castage(Diger),
  ] as const,
);

/**
 * Event seal fixed-field value (`i`, `s`, `d`).
 *
 * KERIpy substance:
 * - named triple pointing at one anchoring or delegated key event
 */
export class SealEvent extends StructValue<SealEventTuple, SealEventCrew> {
  protected readonly fieldNames = SEAL_EVENT_FIELDS;
  protected readonly castages = SEAL_EVENT_CASTS;
  readonly i: Prefixer;
  readonly s: NumberPrimitive;
  readonly d: Diger;

  constructor(i: Prefixer, s: NumberPrimitive, d: Diger) {
    super();
    this.i = i;
    this.s = s;
    this.d = d;
  }

  static fromTuple(tuple: SealEventTuple): SealEvent {
    return new SealEvent(tuple[0], tuple[1], tuple[2]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b, Qb64b, Qb64b]): SealEvent {
    return new SealEvent(
      new Prefixer({ qb64b: tuple[0] }),
      new NumberPrimitive({ qb64b: tuple[1] }),
      new Diger({ qb64b: tuple[2] }),
    );
  }

  toTuple(): SealEventTuple {
    return [this.i, this.s, this.d];
  }

  get pre(): string {
    return this.i.qb64;
  }

  get preb(): Uint8Array {
    return this.i.qb64b;
  }

  get sn(): bigint {
    return this.s.num;
  }

  get snh(): string {
    return this.s.numh;
  }

  get said(): string {
    return this.d.qb64;
  }

  get saidb(): Uint8Array {
    return this.d.qb64b;
  }
}

export type SealLastTuple = readonly [Prefixer];
export interface SealLastCrew {
  i: string;
}

const SEAL_LAST_FIELDS = Object.freeze(["i"] as const);
const SEAL_LAST_CASTS = Object.freeze([castage(Prefixer)] as const);

/**
 * Last-establishment lookup seal (`i`).
 *
 * KERIpy substance:
 * - named single-value marker that says "use the latest establishment event
 *   from this prefix"
 */
export class SealLast extends StructValue<SealLastTuple, SealLastCrew> {
  protected readonly fieldNames = SEAL_LAST_FIELDS;
  protected readonly castages = SEAL_LAST_CASTS;
  readonly i: Prefixer;

  constructor(i: Prefixer) {
    super();
    this.i = i;
  }

  static fromTuple(tuple: SealLastTuple): SealLast {
    return new SealLast(tuple[0]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b]): SealLast {
    return new SealLast(new Prefixer({ qb64b: tuple[0] }));
  }

  toTuple(): SealLastTuple {
    return [this.i];
  }

  get pre(): string {
    return this.i.qb64;
  }

  get preb(): Uint8Array {
    return this.i.qb64b;
  }
}

export type SealBackTuple = readonly [Prefixer, Diger];
export interface SealBackCrew {
  bi: string;
  d: string;
}

const SEAL_BACK_FIELDS = Object.freeze(["bi", "d"] as const);
const SEAL_BACK_CASTS = Object.freeze(
  [
    castage(Prefixer),
    castage(Diger),
  ] as const,
);

/**
 * Backer/registrar seal fixed-field value (`bi`, `d`).
 *
 * KERIpy substance:
 * - named pair used for registrar/backer references where `bi` is the backer
 *   prefix and `d` is the attached metadata/event digest
 */
export class SealBack extends StructValue<SealBackTuple, SealBackCrew> {
  protected readonly fieldNames = SEAL_BACK_FIELDS;
  protected readonly castages = SEAL_BACK_CASTS;
  readonly bi: Prefixer;
  readonly d: Diger;

  constructor(bi: Prefixer, d: Diger) {
    super();
    this.bi = bi;
    this.d = d;
  }

  static fromTuple(tuple: SealBackTuple): SealBack {
    return new SealBack(tuple[0], tuple[1]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b, Qb64b]): SealBack {
    return new SealBack(
      new Prefixer({ qb64b: tuple[0] }),
      new Diger({ qb64b: tuple[1] }),
    );
  }

  toTuple(): SealBackTuple {
    return [this.bi, this.d];
  }

  get backer(): string {
    return this.bi.qb64;
  }

  get backerb(): Uint8Array {
    return this.bi.qb64b;
  }

  get said(): string {
    return this.d.qb64;
  }

  get saidb(): Uint8Array {
    return this.d.qb64b;
  }
}

export type SealKindTuple = readonly [Verser, Diger];
export interface SealKindCrew {
  t: string;
  d: string;
}

const SEAL_KIND_FIELDS = Object.freeze(["t", "d"] as const);
const SEAL_KIND_CASTS = Object.freeze(
  [
    castage(Verser),
    castage(Diger),
  ] as const,
);

/**
 * Typed-digest seal fixed-field value (`t`, `d`).
 *
 * KERIpy substance:
 * - pairs one `Verser` with one digest so typed/versioned digests stay
 *   explicit in counted attachment groups
 */
export class SealKind extends StructValue<SealKindTuple, SealKindCrew> {
  protected readonly fieldNames = SEAL_KIND_FIELDS;
  protected readonly castages = SEAL_KIND_CASTS;
  readonly t: Verser;
  readonly d: Diger;

  constructor(t: Verser, d: Diger) {
    super();
    this.t = t;
    this.d = d;
  }

  static fromTuple(tuple: SealKindTuple): SealKind {
    return new SealKind(tuple[0], tuple[1]);
  }

  static fromQb64bTuple(tuple: readonly [Qb64b, Qb64b]): SealKind {
    return new SealKind(
      new Verser({ qb64b: tuple[0] }),
      new Diger({ qb64b: tuple[1] }),
    );
  }

  toTuple(): SealKindTuple {
    return [this.t, this.d];
  }

  get proto(): string {
    return this.t.proto;
  }

  get pvrsn() {
    return this.t.pvrsn;
  }

  get gvrsn() {
    return this.t.gvrsn;
  }

  get said(): string {
    return this.d.qb64;
  }

  get saidb(): Uint8Array {
    return this.d.qb64b;
  }
}

export type BlindStateTuple = readonly [Noncer, Noncer, Noncer, Labeler];
export interface BlindStateCrew {
  d: string;
  u: string;
  td: string;
  ts: string;
}

const BLIND_STATE_FIELDS = Object.freeze(["d", "u", "td", "ts"] as const);
const BLIND_STATE_CASTS = Object.freeze(
  [
    castage(Noncer, "nonce"),
    castage(Noncer, "nonce"),
    castage(Noncer, "nonce"),
    castage(Labeler, "text"),
  ] as const,
);

/**
 * Blind-state fixed-field value (`d`, `u`, `td`, `ts`).
 *
 * TypeScript divergence:
 * - the digest-like slots remain `Noncer`, not `Diger`, so empty-placeholder
 *   state keeps the same expressive range as KERIpy
 */
export class BlindState extends StructValue<BlindStateTuple, BlindStateCrew> {
  protected readonly fieldNames = BLIND_STATE_FIELDS;
  protected readonly castages = BLIND_STATE_CASTS;
  readonly d: Noncer;
  readonly u: Noncer;
  readonly td: Noncer;
  readonly ts: Labeler;

  constructor(d: Noncer, u: Noncer, td: Noncer, ts: Labeler) {
    super();
    this.d = d;
    this.u = u;
    this.td = td;
    this.ts = ts;
  }

  static fromTuple(tuple: BlindStateTuple): BlindState {
    return new BlindState(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
  ): BlindState {
    return new BlindState(
      new Noncer({ qb64b: tuple[0] }),
      new Noncer({ qb64b: tuple[1] }),
      new Noncer({ qb64b: tuple[2] }),
      new Labeler({ qb64b: tuple[3] }),
    );
  }

  toTuple(): BlindStateTuple {
    return [this.d, this.u, this.td, this.ts];
  }

  get said(): string {
    return this.d.nonce;
  }

  get saidb(): Uint8Array {
    return this.d.nonceb;
  }

  get blid(): string {
    return this.said;
  }

  get blidb(): Uint8Array {
    return this.saidb;
  }

  get uuid(): string {
    return this.u.nonce;
  }

  get uuidb(): Uint8Array {
    return this.u.nonceb;
  }

  get acdc(): string {
    return this.td.nonce;
  }

  get acdcb(): Uint8Array {
    return this.td.nonceb;
  }

  get state(): string {
    return this.ts.text;
  }

  get stateb(): Uint8Array {
    return b(this.state);
  }
}

export type BoundStateTuple = readonly [
  Noncer,
  Noncer,
  Noncer,
  Labeler,
  NumberPrimitive,
  Noncer,
];
export interface BoundStateCrew {
  d: string;
  u: string;
  td: string;
  ts: string;
  bn: string;
  bd: string;
}

const BOUND_STATE_FIELDS = Object.freeze(
  [
    "d",
    "u",
    "td",
    "ts",
    "bn",
    "bd",
  ] as const,
);
const BOUND_STATE_CASTS = Object.freeze(
  [
    castage(Noncer, "nonce"),
    castage(Noncer, "nonce"),
    castage(Noncer, "nonce"),
    castage(Labeler, "text"),
    castage(NumberPrimitive, "numh"),
    castage(Noncer, "nonce"),
  ] as const,
);

/**
 * Bound blind-state fixed-field value (`d`, `u`, `td`, `ts`, `bn`, `bd`).
 *
 * KERIpy substance:
 * - extends blind state with the issuee key-state cross-anchor pair used for
 *   bound-state sextuples
 */
export class BoundState extends StructValue<BoundStateTuple, BoundStateCrew> {
  protected readonly fieldNames = BOUND_STATE_FIELDS;
  protected readonly castages = BOUND_STATE_CASTS;
  readonly d: Noncer;
  readonly u: Noncer;
  readonly td: Noncer;
  readonly ts: Labeler;
  readonly bn: NumberPrimitive;
  readonly bd: Noncer;

  constructor(
    d: Noncer,
    u: Noncer,
    td: Noncer,
    ts: Labeler,
    bn: NumberPrimitive,
    bd: Noncer,
  ) {
    super();
    this.d = d;
    this.u = u;
    this.td = td;
    this.ts = ts;
    this.bn = bn;
    this.bd = bd;
  }

  static fromTuple(tuple: BoundStateTuple): BoundState {
    return new BoundState(
      tuple[0],
      tuple[1],
      tuple[2],
      tuple[3],
      tuple[4],
      tuple[5],
    );
  }

  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b, Qb64b, Qb64b],
  ): BoundState {
    return new BoundState(
      new Noncer({ qb64b: tuple[0] }),
      new Noncer({ qb64b: tuple[1] }),
      new Noncer({ qb64b: tuple[2] }),
      new Labeler({ qb64b: tuple[3] }),
      new NumberPrimitive({ qb64b: tuple[4] }),
      new Noncer({ qb64b: tuple[5] }),
    );
  }

  toTuple(): BoundStateTuple {
    return [this.d, this.u, this.td, this.ts, this.bn, this.bd];
  }

  get said(): string {
    return this.d.nonce;
  }

  get saidb(): Uint8Array {
    return this.d.nonceb;
  }

  get blid(): string {
    return this.said;
  }

  get blidb(): Uint8Array {
    return this.saidb;
  }

  get uuid(): string {
    return this.u.nonce;
  }

  get uuidb(): Uint8Array {
    return this.u.nonceb;
  }

  get acdc(): string {
    return this.td.nonce;
  }

  get acdcb(): Uint8Array {
    return this.td.nonceb;
  }

  get state(): string {
    return this.ts.text;
  }

  get stateb(): Uint8Array {
    return b(this.state);
  }

  get bsn(): bigint {
    return this.bn.num;
  }

  get bnh(): string {
    return this.bn.numh;
  }

  get bnhb(): Uint8Array {
    return b(this.bnh);
  }

  get boundSaid(): string {
    return this.bd.nonce;
  }

  get boundSaidb(): Uint8Array {
    return this.bd.nonceb;
  }
}

export type TypeMediaTuple = readonly [Noncer, Noncer, Labeler, Texter];
export interface TypeMediaCrew {
  d: string;
  u: string;
  mt: string;
  mv: string;
}

const TYPE_MEDIA_FIELDS = Object.freeze(["d", "u", "mt", "mv"] as const);
const TYPE_MEDIA_CASTS = Object.freeze(
  [
    castage(Noncer, "nonce"),
    castage(Noncer, "nonce"),
    castage(Labeler, "text"),
    castage(Texter, "text"),
  ] as const,
);

/**
 * Typed-media fixed-field value (`d`, `u`, `mt`, `mv`).
 *
 * TypeScript divergence:
 * - the primitive field names stay KERIpy-exact (`mt`, `mv`)
 * - convenience text projections use `mediaType` / `mediaValue` so the field
 *   names can remain primitive-valued without ambiguity
 */
export class TypeMedia extends StructValue<TypeMediaTuple, TypeMediaCrew> {
  protected readonly fieldNames = TYPE_MEDIA_FIELDS;
  protected readonly castages = TYPE_MEDIA_CASTS;
  readonly d: Noncer;
  readonly u: Noncer;
  readonly mt: Labeler;
  readonly mv: Texter;

  constructor(d: Noncer, u: Noncer, mt: Labeler, mv: Texter) {
    super();
    this.d = d;
    this.u = u;
    this.mt = mt;
    this.mv = mv;
  }

  static fromTuple(tuple: TypeMediaTuple): TypeMedia {
    return new TypeMedia(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  static fromQb64bTuple(
    tuple: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
  ): TypeMedia {
    return new TypeMedia(
      new Noncer({ qb64b: tuple[0] }),
      new Noncer({ qb64b: tuple[1] }),
      new Labeler({ qb64b: tuple[2] }),
      new Texter({ qb64b: tuple[3] }),
    );
  }

  toTuple(): TypeMediaTuple {
    return [this.d, this.u, this.mt, this.mv];
  }

  get said(): string {
    return this.d.nonce;
  }

  get saidb(): Uint8Array {
    return this.d.nonceb;
  }

  get uuid(): string {
    return this.u.nonce;
  }

  get uuidb(): Uint8Array {
    return this.u.nonceb;
  }

  get mediaType(): string {
    return this.mt.text;
  }

  get mediaTypeb(): Uint8Array {
    return b(this.mediaType);
  }

  get mediaValue(): string {
    return this.mv.text;
  }

  get mediaValueb(): Uint8Array {
    return b(this.mediaValue);
  }
}

/** Empty clan registry placeholder retained for KERIpy naming familiarity. */
export const EmptyClanDom = Object.freeze({} as const);
/** Empty cast registry placeholder retained for KERIpy naming familiarity. */
export const EmptyCastDom = Object.freeze({} as const);
/** KERIpy alias for `EmptyClanDom`. */
export const EClanDom = EmptyClanDom;
/** KERIpy alias for `EmptyCastDom`. */
export const ECastDom = EmptyCastDom;

/** Seal-struct clan registry (`SealDigest` through `SealKind`). */
export const SealClanDom = Object.freeze(
  {
    SealDigest,
    SealRoot,
    SealSource,
    SealEvent,
    SealLast,
    SealBack,
    SealKind,
  } as const,
);
/** KERIpy alias for `SealClanDom`. */
export const SClanDom = SealClanDom;

/** Seal-struct cast registry keyed by clan name. */
export const SealCastDom = Object.freeze(
  {
    SealDigest: Object.freeze({ d: castage(Diger) }),
    SealRoot: Object.freeze({ rd: castage(Diger) }),
    SealSource: Object.freeze({
      s: castage(NumberPrimitive, "numh"),
      d: castage(Diger),
    }),
    SealEvent: Object.freeze({
      i: castage(Prefixer),
      s: castage(NumberPrimitive, "numh"),
      d: castage(Diger),
    }),
    SealLast: Object.freeze({ i: castage(Prefixer) }),
    SealBack: Object.freeze({
      bi: castage(Prefixer),
      d: castage(Diger),
    }),
    SealKind: Object.freeze({
      t: castage(Verser),
      d: castage(Diger),
    }),
  } as const,
);
/** KERIpy alias for `SealCastDom`. */
export const SCastDom = SealCastDom;

/** Blind-state clan registry (`BlindState`, `BoundState`). */
export const BlindStateClanDom = Object.freeze(
  {
    BlindState,
    BoundState,
  } as const,
);
/** KERIpy alias for `BlindStateClanDom`. */
export const BSClanDom = BlindStateClanDom;

/** Blind-state cast registry keyed by clan name. */
export const BlindStateCastDom = Object.freeze(
  {
    BlindState: Object.freeze({
      d: castage(Noncer, "nonce"),
      u: castage(Noncer, "nonce"),
      td: castage(Noncer, "nonce"),
      ts: castage(Labeler, "text"),
    }),
    BoundState: Object.freeze({
      d: castage(Noncer, "nonce"),
      u: castage(Noncer, "nonce"),
      td: castage(Noncer, "nonce"),
      ts: castage(Labeler, "text"),
      bn: castage(NumberPrimitive, "numh"),
      bd: castage(Noncer, "nonce"),
    }),
  } as const,
);
/** KERIpy alias for `BlindStateCastDom`. */
export const BSCastDom = BlindStateCastDom;

/** Typed-media clan registry (`TypeMedia`). */
export const TypeMediaClanDom = Object.freeze(
  {
    TypeMedia,
  } as const,
);
/** KERIpy alias for `TypeMediaClanDom`. */
export const TMClanDom = TypeMediaClanDom;

/** Typed-media cast registry keyed by clan name. */
export const TypeMediaCastDom = Object.freeze(
  {
    TypeMedia: Object.freeze({
      d: castage(Noncer, "nonce"),
      u: castage(Noncer, "nonce"),
      mt: castage(Labeler, "text"),
      mv: castage(Texter, "text"),
    }),
  } as const,
);
/** KERIpy alias for `TypeMediaCastDom`. */
export const TMCastDom = TypeMediaCastDom;

/** All structing clan registries combined into one authoritative CESR view. */
export const AllClanDom = Object.freeze(
  {
    ...SealClanDom,
    ...BlindStateClanDom,
    ...TypeMediaClanDom,
  } as const,
);
/** KERIpy alias for `AllClanDom`. */
export const AClanDom = AllClanDom;

/** All structing cast registries combined into one authoritative CESR view. */
export const AllCastDom = Object.freeze(
  {
    ...SealCastDom,
    ...BlindStateCastDom,
    ...TypeMediaCastDom,
  } as const,
);
/** KERIpy alias for `AllCastDom`. */
export const ACastDom = AllCastDom;

export type StructClanName = keyof typeof AllClanDom;
export type StructingCoden =
  | "DigestSealSingles"
  | "MerkleRootSealSingles"
  | "SealSourceCouples"
  | "SealSourceTriples"
  | "SealSourceLastSingles"
  | "BackerRegistrarSealCouples"
  | "TypedDigestSealCouples"
  | "BlindedStateQuadruples"
  | "BoundStateSextuples"
  | "TypedMediaQuadruples";

/**
 * Authoritative clan-name -> semantic counter-name map for structing families.
 *
 * This mirrors KERIpy `ClanToCodens`, but stores semantic counter names rather
 * than Python codex members.
 */
export const ClanToCodens = Object.freeze(
  {
    SealDigest: "DigestSealSingles",
    SealRoot: "MerkleRootSealSingles",
    SealSource: "SealSourceCouples",
    SealEvent: "SealSourceTriples",
    SealLast: "SealSourceLastSingles",
    SealBack: "BackerRegistrarSealCouples",
    SealKind: "TypedDigestSealCouples",
    BlindState: "BlindedStateQuadruples",
    BoundState: "BoundStateSextuples",
    TypeMedia: "TypedMediaQuadruples",
  } as const satisfies Record<
    StructClanName,
    CounterCodeNameV1 | CounterCodeNameV2
  >,
);

/** Inverse semantic counter-name -> clan-name registry for structing families. */
export const CodenToClans = invertClanCodens(ClanToCodens);
