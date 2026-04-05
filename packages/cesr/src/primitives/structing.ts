import { b, concatBytes } from "../core/bytes.ts";
import type { Tier } from "../core/vocabulary.ts";
import type { CounterCodeNameV1, CounterCodeNameV2 } from "../tables/counter-codex.ts";
import { Bexter } from "./bexter.ts";
import { DigDex, DIGEST_CODES, LabelDex, NonceDex } from "./codex.ts";
import { Diger } from "./diger.ts";
import { Labeler } from "./labeler.ts";
import type { Matter, MatterInit } from "./matter.ts";
import { Noncer } from "./noncer.ts";
import { NumberPrimitive } from "./number.ts";
import { Prefixer } from "./prefixer.ts";
import { Salter } from "./salter.ts";
import { Texter } from "./texter.ts";
import { Verser } from "./verser.ts";

type Qb64b = Uint8Array;

/**
 * Fixed-field CESR primitive admitted by KERIpy `structing.py` cast tables.
 *
 * Maintainer model:
 * - this is the only public primitive taxonomy the module needs
 * - the named struct values themselves stay plain frozen records
 */
export type StructingPrimitive =
  | Diger
  | Labeler
  | Noncer
  | NumberPrimitive
  | Prefixer
  | Texter
  | Verser;

/**
 * Field-cast metadata ported from KERIpy `Castage`.
 *
 * `ipn` records which primitive property should be exposed in crew/object
 * form. When `ipn` is `null`, the field serializes through canonical `qb64`.
 */
export type Castage = Readonly<{
  kls: new(init: Matter | MatterInit) => StructingPrimitive;
  ipn: string | null;
}>;

export function castage(
  kls: new(init: Matter | MatterInit) => StructingPrimitive,
  ipn: string | null = null,
): Castage {
  return Object.freeze({ kls, ipn });
}

const NUMBER_CAPACITIES = [
  { code: "M", rawSize: 2 },
  { code: "0H", rawSize: 4 },
  { code: "R", rawSize: 5 },
  { code: "N", rawSize: 8 },
  { code: "S", rawSize: 11 },
  { code: "T", rawSize: 14 },
  { code: "0A", rawSize: 16 },
  { code: "U", rawSize: 17 },
] as const;

function freezeRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function bigintToBytes(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new TypeError(`Negative CESR number=${value}`);
  }
  if (value === 0n) {
    return new Uint8Array([0]);
  }
  const bytes: number[] = [];
  let working = value;
  while (working > 0n) {
    bytes.unshift(Number(working & 0xffn));
    working >>= 8n;
  }
  return new Uint8Array(bytes);
}

function hydrateNumber(numh: string): NumberPrimitive {
  const bigint = BigInt(`0x${numh || "0"}`);
  const raw = bigintToBytes(bigint);
  const entry = NUMBER_CAPACITIES.find(({ rawSize }) => raw.length <= rawSize);
  if (!entry) {
    throw new TypeError(`Unsupported CESR number width=${raw.length}`);
  }
  const padded = new Uint8Array(entry.rawSize);
  padded.set(raw, entry.rawSize - raw.length);
  return new NumberPrimitive({ code: entry.code, raw: padded });
}

function encodeTag(text: string): string {
  const code = new Map<number, string>([
    [1, LabelDex.Tag1],
    [2, LabelDex.Tag2],
    [3, LabelDex.Tag3],
    [4, LabelDex.Tag4],
    [5, LabelDex.Tag5],
    [6, LabelDex.Tag6],
    [7, LabelDex.Tag7],
    [8, LabelDex.Tag8],
    [9, LabelDex.Tag9],
    [10, LabelDex.Tag10],
    [11, LabelDex.Tag11],
  ]).get(text.length);
  if (!code) {
    throw new TypeError(`Unsupported label text length=${text.length}`);
  }
  const pad = code === LabelDex.Tag1 || code === LabelDex.Tag5
      || code === LabelDex.Tag9
    ? "_"
    : "";
  return `${code}${pad}${text}`;
}

function encodeBext(text: string): string {
  const rem = text.length % 4;
  const code = rem === 0
    ? LabelDex.StrB64_L0
    : rem === 1
    ? LabelDex.StrB64_L1
    : LabelDex.StrB64_L2;
  return new Bexter({ code, raw: Bexter.rawify(text) }).qb64;
}

function encodeBytes(text: string): string {
  const raw = b(text);
  const rem = raw.length % 3;
  const code = rem === 0
    ? LabelDex.Bytes_L0
    : rem === 1
    ? LabelDex.Bytes_L1
    : LabelDex.Bytes_L2;
  return new Texter({ code, raw }).qb64;
}

function encodeLabelText(text: string): string {
  if (text.length === 0) {
    return LabelDex.Empty;
  }
  if (/^[A-Za-z0-9_-]{1,11}$/.test(text)) {
    return encodeTag(text);
  }
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    return encodeBext(text);
  }
  return encodeBytes(text);
}

function hydrateStructingField(spec: Castage, value: string): StructingPrimitive {
  if (spec.kls === NumberPrimitive) {
    return hydrateNumber(value);
  }
  if (spec.kls === Noncer) {
    return value === ""
      ? new Noncer({ code: NonceDex.Empty, raw: new Uint8Array() })
      : new Noncer({ qb64: value });
  }
  if (spec.kls === Labeler) {
    return new Labeler({ qb64: encodeLabelText(value) });
  }
  if (spec.kls === Texter) {
    return new Texter({ qb64: encodeBytes(value) });
  }
  return new spec.kls({ qb64: value });
}

function serializeCrewField(field: StructingPrimitive, spec: Castage): string {
  const prop = spec.ipn ?? "qb64";
  const value = Reflect.get(field as object, prop);
  if (typeof value !== "string") {
    throw new TypeError(
      `Structing field ${field.constructor.name} does not expose string property ${prop}.`,
    );
  }
  return value;
}

function buildCrew<TFields extends readonly string[]>(
  fields: TFields,
  cast: Readonly<Record<TFields[number], Castage>>,
  value: Readonly<Record<TFields[number], StructingPrimitive>>,
): Readonly<Record<TFields[number], string>> {
  const out = {} as Record<TFields[number], string>;
  for (const field of fields) {
    const key = field as TFields[number];
    out[key] = serializeCrewField(value[key], cast[key]);
  }
  return Object.freeze(out);
}

function serializeTupleQb64(tuple: readonly StructingPrimitive[]): string {
  return tuple.map((field) => field.qb64).join("");
}

function serializeTupleQb64b(tuple: readonly StructingPrimitive[]): Uint8Array {
  return b(serializeTupleQb64(tuple));
}

function serializeTupleQb2(tuple: readonly StructingPrimitive[]): Uint8Array {
  return concatBytes(...tuple.map((field) => field.qb2));
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

function emptyNoncer(): Noncer {
  return new Noncer({ code: NonceDex.Empty, raw: new Uint8Array() });
}

type NumberLike = NumberPrimitive | number | bigint | string;
type NoncerLike = Noncer | string | null | undefined;
type LabelerLike = Labeler | string | null | undefined;
type TexterLike = Texter | string | null | undefined;

function coerceNumh(value: NumberLike): string {
  if (value instanceof NumberPrimitive) {
    return value.numh;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`Expected non-negative integer number, got ${value}`);
    }
    return BigInt(value).toString(16);
  }
  if (value < 0n) {
    throw new TypeError(`Expected non-negative bigint, got ${value}`);
  }
  return value.toString(16);
}

function coerceNonceText(value: NoncerLike): string {
  if (value instanceof Noncer) {
    return value.nonce;
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function coerceLabelText(value: LabelerLike): string {
  if (value instanceof Labeler) {
    return value.text;
  }
  return value ?? "";
}

function coerceTexterText(value: TexterLike): string {
  if (value instanceof Texter) {
    return value.text;
  }
  return value ?? "";
}

function ensurePresentUuid(
  value: NoncerLike,
  options: MakeBlindUuidOptions,
): Noncer {
  if (value instanceof Noncer) {
    if (value.code === NonceDex.Empty) {
      throw new TypeError("Disclosure UUID may not be empty.");
    }
    return value;
  }
  if (typeof value === "string") {
    const nonce = new Noncer({ qb64: value });
    if (nonce.code === NonceDex.Empty) {
      throw new TypeError("Disclosure UUID may not be empty.");
    }
    return nonce;
  }
  return makeBlindUuid(options);
}

type SaidiveStructingRecord = BlindState | BoundState | TypeMedia;
type SaidiveStructingDescriptor<
  TRecord extends SaidiveStructingRecord,
  TSad extends Readonly<{ d: string }>,
> = {
  readonly fields: readonly string[];
  toSad(value: TRecord): TSad;
  toTuple(value: TRecord): readonly StructingPrimitive[];
  fromSad(value: TSad): TRecord;
};

function effectiveDisclosureCode(current: Noncer, code?: string): string {
  if (code !== undefined) {
    return code;
  }
  return DIGEST_CODES.has(current.code) ? current.code : DigDex.Blake3_256;
}

function computeDisclosureNonce<
  TRecord extends SaidiveStructingRecord,
  TSad extends Readonly<{ d: string }>,
>(
  descriptor: SaidiveStructingDescriptor<TRecord, TSad>,
  value: TRecord,
  code?: string,
): Noncer {
  const effectiveCode = effectiveDisclosureCode(value.d, code);
  const tuple = descriptor.toTuple(value);
  const ser = descriptor.fields.map((field, index) =>
    field === "d" ? "#".repeat(Noncer.fullSizeForCode(effectiveCode)) : tuple[index].qb64
  ).join("");
  return new Noncer({
    code: effectiveCode,
    raw: Diger.digest(b(ser), effectiveCode),
  });
}

function saidifyDisclosureRecord<
  TRecord extends SaidiveStructingRecord,
  TSad extends Readonly<{ d: string }>,
>(
  descriptor: SaidiveStructingDescriptor<TRecord, TSad>,
  value: TRecord,
  code?: string,
): TRecord {
  const d = computeDisclosureNonce(descriptor, value, code);
  return descriptor.fromSad({
    ...descriptor.toSad(value),
    d: d.nonce,
  } as TSad);
}

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

type StructingDescriptorShape<
  TFields extends readonly string[],
  TRecord extends Readonly<Record<TFields[number], StructingPrimitive>>,
  TSad extends Readonly<Record<TFields[number], string>>,
  TTuple extends readonly StructingPrimitive[],
> = {
  readonly name: string;
  readonly fields: TFields;
  readonly cast: Readonly<Record<TFields[number], Castage>>;
  readonly coden: StructingCoden;
  fromTuple(tuple: TTuple): TRecord;
  fromQb64bTuple(tuple: { readonly [K in keyof TTuple]: Qb64b }): TRecord;
  toTuple(value: TRecord): TTuple;
  toCrew(value: TRecord): TSad;
  qb64(value: TRecord): string;
  qb64b(value: TRecord): Uint8Array;
  qb2(value: TRecord): Uint8Array;
};

function isSadShape<TFields extends readonly string[]>(
  fields: TFields,
  value: unknown,
): value is Readonly<Record<TFields[number], string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== fields.length) {
    return false;
  }
  for (const field of fields) {
    if (typeof candidate[field] !== "string") {
      return false;
    }
  }
  return keys.every((key) => fields.includes(key as TFields[number]));
}

function withSadProjection<
  TFields extends readonly string[],
  TRecord extends Readonly<Record<TFields[number], StructingPrimitive>>,
  TSad extends Readonly<Record<TFields[number], string>>,
  TTuple extends readonly StructingPrimitive[],
>(
  descriptor: StructingDescriptorShape<TFields, TRecord, TSad, TTuple>,
) {
  return Object.freeze(
    {
      ...descriptor,
      isSad(value: unknown): value is TSad {
        return isSadShape(descriptor.fields, value);
      },
      fromSad(value: TSad): TRecord {
        const tuple = descriptor.fields.map((field) => {
          const key = field as TFields[number];
          return hydrateStructingField(descriptor.cast[key], value[key]);
        }) as unknown as TTuple;
        return descriptor.fromTuple(tuple);
      },
      toSad(value: TRecord): TSad {
        return descriptor.toCrew(value);
      },
    } as const,
  );
}

type SealDigestCrew = Readonly<{ d: string }>;
const SEAL_DIGEST_FIELDS = Object.freeze(["d"] as const);
const SEAL_DIGEST_CAST = Object.freeze({ d: castage(Diger) } as const);

/**
 * Digest seal fixed-field value (`d`).
 *
 * KERIpy substance:
 * - named single-value seal used for SAID/digest anchoring
 */
export type SealDigest = Readonly<{ d: Diger }>;
export const SealDigest = withSadProjection(
  {
    name: "SealDigest",
    fields: SEAL_DIGEST_FIELDS,
    cast: SEAL_DIGEST_CAST,
    coden: "DigestSealSingles" as const,
    fromTuple([d]: readonly [Diger]): SealDigest {
      return freezeRecord({ d });
    },
    fromQb64bTuple([d]: readonly [Qb64b]): SealDigest {
      return freezeRecord({ d: new Diger({ qb64b: d }) });
    },
    toTuple(value: SealDigest): readonly [Diger] {
      return [value.d] as const;
    },
    toCrew(value: SealDigest): SealDigestCrew {
      return buildCrew(SEAL_DIGEST_FIELDS, SEAL_DIGEST_CAST, value);
    },
    qb64(value: SealDigest): string {
      return serializeTupleQb64([value.d]);
    },
    qb64b(value: SealDigest): Uint8Array {
      return serializeTupleQb64b([value.d]);
    },
    qb2(value: SealDigest): Uint8Array {
      return serializeTupleQb2([value.d]);
    },
  } as const,
);

type SealRootCrew = Readonly<{ rd: string }>;
const SEAL_ROOT_FIELDS = Object.freeze(["rd"] as const);
const SEAL_ROOT_CAST = Object.freeze({ rd: castage(Diger) } as const);

/**
 * Merkle-root seal fixed-field value (`rd`).
 *
 * KERIpy substance:
 * - named single-value seal for anchored Merkle-tree root digests
 */
export type SealRoot = Readonly<{ rd: Diger }>;
export const SealRoot = withSadProjection(
  {
    name: "SealRoot",
    fields: SEAL_ROOT_FIELDS,
    cast: SEAL_ROOT_CAST,
    coden: "MerkleRootSealSingles" as const,
    fromTuple([rd]: readonly [Diger]): SealRoot {
      return freezeRecord({ rd });
    },
    fromQb64bTuple([rd]: readonly [Qb64b]): SealRoot {
      return freezeRecord({ rd: new Diger({ qb64b: rd }) });
    },
    toTuple(value: SealRoot): readonly [Diger] {
      return [value.rd] as const;
    },
    toCrew(value: SealRoot): SealRootCrew {
      return buildCrew(SEAL_ROOT_FIELDS, SEAL_ROOT_CAST, value);
    },
    qb64(value: SealRoot): string {
      return serializeTupleQb64([value.rd]);
    },
    qb64b(value: SealRoot): Uint8Array {
      return serializeTupleQb64b([value.rd]);
    },
    qb2(value: SealRoot): Uint8Array {
      return serializeTupleQb2([value.rd]);
    },
  } as const,
);

type SealSourceCrew = Readonly<{ s: string; d: string }>;
const SEAL_SOURCE_FIELDS = Object.freeze(["s", "d"] as const);
const SEAL_SOURCE_CAST = Object.freeze(
  {
    s: castage(NumberPrimitive, "numh"),
    d: castage(Diger),
  } as const,
);

/**
 * Source seal fixed-field value (`s`, `d`).
 *
 * Maintainer model:
 * - the issuer/delegator prefix is implied by surrounding context
 * - `s` stays a real `NumberPrimitive`; crew/object form projects `.numh`
 */
export type SealSource = Readonly<{ s: NumberPrimitive; d: Diger }>;
export const SealSource = withSadProjection(
  {
    name: "SealSource",
    fields: SEAL_SOURCE_FIELDS,
    cast: SEAL_SOURCE_CAST,
    coden: "SealSourceCouples" as const,
    fromTuple([s, d]: readonly [NumberPrimitive, Diger]): SealSource {
      return freezeRecord({ s, d });
    },
    fromQb64bTuple([s, d]: readonly [Qb64b, Qb64b]): SealSource {
      return freezeRecord({
        s: new NumberPrimitive({ qb64b: s }),
        d: new Diger({ qb64b: d }),
      });
    },
    toTuple(value: SealSource): readonly [NumberPrimitive, Diger] {
      return [value.s, value.d] as const;
    },
    toCrew(value: SealSource): SealSourceCrew {
      return buildCrew(SEAL_SOURCE_FIELDS, SEAL_SOURCE_CAST, value);
    },
    qb64(value: SealSource): string {
      return serializeTupleQb64([value.s, value.d]);
    },
    qb64b(value: SealSource): Uint8Array {
      return serializeTupleQb64b([value.s, value.d]);
    },
    qb2(value: SealSource): Uint8Array {
      return serializeTupleQb2([value.s, value.d]);
    },
  } as const,
);

type SealEventCrew = Readonly<{ i: string; s: string; d: string }>;
const SEAL_EVENT_FIELDS = Object.freeze(["i", "s", "d"] as const);
const SEAL_EVENT_CAST = Object.freeze(
  {
    i: castage(Prefixer),
    s: castage(NumberPrimitive, "numh"),
    d: castage(Diger),
  } as const,
);

/**
 * Event seal fixed-field value (`i`, `s`, `d`).
 *
 * KERIpy substance:
 * - named triple pointing at one anchoring or delegated key event
 */
export type SealEvent = Readonly<{
  i: Prefixer;
  s: NumberPrimitive;
  d: Diger;
}>;
export const SealEvent = withSadProjection(
  {
    name: "SealEvent",
    fields: SEAL_EVENT_FIELDS,
    cast: SEAL_EVENT_CAST,
    coden: "SealSourceTriples" as const,
    fromTuple(
      [i, s, d]: readonly [Prefixer, NumberPrimitive, Diger],
    ): SealEvent {
      return freezeRecord({ i, s, d });
    },
    fromQb64bTuple(
      [i, s, d]: readonly [Qb64b, Qb64b, Qb64b],
    ): SealEvent {
      return freezeRecord({
        i: new Prefixer({ qb64b: i }),
        s: new NumberPrimitive({ qb64b: s }),
        d: new Diger({ qb64b: d }),
      });
    },
    toTuple(value: SealEvent): readonly [Prefixer, NumberPrimitive, Diger] {
      return [value.i, value.s, value.d] as const;
    },
    toCrew(value: SealEvent): SealEventCrew {
      return buildCrew(SEAL_EVENT_FIELDS, SEAL_EVENT_CAST, value);
    },
    qb64(value: SealEvent): string {
      return serializeTupleQb64([value.i, value.s, value.d]);
    },
    qb64b(value: SealEvent): Uint8Array {
      return serializeTupleQb64b([value.i, value.s, value.d]);
    },
    qb2(value: SealEvent): Uint8Array {
      return serializeTupleQb2([value.i, value.s, value.d]);
    },
  } as const,
);

type SealLastCrew = Readonly<{ i: string }>;
const SEAL_LAST_FIELDS = Object.freeze(["i"] as const);
const SEAL_LAST_CAST = Object.freeze({ i: castage(Prefixer) } as const);

/**
 * Last-establishment lookup seal (`i`).
 *
 * KERIpy substance:
 * - named single-value marker that says "use the latest establishment event
 *   from this prefix"
 */
export type SealLast = Readonly<{ i: Prefixer }>;
export const SealLast = withSadProjection(
  {
    name: "SealLast",
    fields: SEAL_LAST_FIELDS,
    cast: SEAL_LAST_CAST,
    coden: "SealSourceLastSingles" as const,
    fromTuple([i]: readonly [Prefixer]): SealLast {
      return freezeRecord({ i });
    },
    fromQb64bTuple([i]: readonly [Qb64b]): SealLast {
      return freezeRecord({ i: new Prefixer({ qb64b: i }) });
    },
    toTuple(value: SealLast): readonly [Prefixer] {
      return [value.i] as const;
    },
    toCrew(value: SealLast): SealLastCrew {
      return buildCrew(SEAL_LAST_FIELDS, SEAL_LAST_CAST, value);
    },
    qb64(value: SealLast): string {
      return serializeTupleQb64([value.i]);
    },
    qb64b(value: SealLast): Uint8Array {
      return serializeTupleQb64b([value.i]);
    },
    qb2(value: SealLast): Uint8Array {
      return serializeTupleQb2([value.i]);
    },
  } as const,
);

type SealBackCrew = Readonly<{ bi: string; d: string }>;
const SEAL_BACK_FIELDS = Object.freeze(["bi", "d"] as const);
const SEAL_BACK_CAST = Object.freeze(
  {
    bi: castage(Prefixer),
    d: castage(Diger),
  } as const,
);

/**
 * Backer/registrar seal fixed-field value (`bi`, `d`).
 *
 * KERIpy substance:
 * - named pair used for registrar/backer references where `bi` is the backer
 *   prefix and `d` is the attached metadata/event digest
 */
export type SealBack = Readonly<{ bi: Prefixer; d: Diger }>;
export const SealBack = withSadProjection(
  {
    name: "SealBack",
    fields: SEAL_BACK_FIELDS,
    cast: SEAL_BACK_CAST,
    coden: "BackerRegistrarSealCouples" as const,
    fromTuple([bi, d]: readonly [Prefixer, Diger]): SealBack {
      return freezeRecord({ bi, d });
    },
    fromQb64bTuple([bi, d]: readonly [Qb64b, Qb64b]): SealBack {
      return freezeRecord({
        bi: new Prefixer({ qb64b: bi }),
        d: new Diger({ qb64b: d }),
      });
    },
    toTuple(value: SealBack): readonly [Prefixer, Diger] {
      return [value.bi, value.d] as const;
    },
    toCrew(value: SealBack): SealBackCrew {
      return buildCrew(SEAL_BACK_FIELDS, SEAL_BACK_CAST, value);
    },
    qb64(value: SealBack): string {
      return serializeTupleQb64([value.bi, value.d]);
    },
    qb64b(value: SealBack): Uint8Array {
      return serializeTupleQb64b([value.bi, value.d]);
    },
    qb2(value: SealBack): Uint8Array {
      return serializeTupleQb2([value.bi, value.d]);
    },
  } as const,
);

type SealKindCrew = Readonly<{ t: string; d: string }>;
const SEAL_KIND_FIELDS = Object.freeze(["t", "d"] as const);
const SEAL_KIND_CAST = Object.freeze(
  {
    t: castage(Verser),
    d: castage(Diger),
  } as const,
);

/**
 * Typed-digest seal fixed-field value (`t`, `d`).
 *
 * KERIpy substance:
 * - pairs one `Verser` with one digest so typed/versioned digests stay
 *   explicit in counted attachment groups
 */
export type SealKind = Readonly<{ t: Verser; d: Diger }>;
export const SealKind = withSadProjection(
  {
    name: "SealKind",
    fields: SEAL_KIND_FIELDS,
    cast: SEAL_KIND_CAST,
    coden: "TypedDigestSealCouples" as const,
    fromTuple([t, d]: readonly [Verser, Diger]): SealKind {
      return freezeRecord({ t, d });
    },
    fromQb64bTuple([t, d]: readonly [Qb64b, Qb64b]): SealKind {
      return freezeRecord({
        t: new Verser({ qb64b: t }),
        d: new Diger({ qb64b: d }),
      });
    },
    toTuple(value: SealKind): readonly [Verser, Diger] {
      return [value.t, value.d] as const;
    },
    toCrew(value: SealKind): SealKindCrew {
      return buildCrew(SEAL_KIND_FIELDS, SEAL_KIND_CAST, value);
    },
    qb64(value: SealKind): string {
      return serializeTupleQb64([value.t, value.d]);
    },
    qb64b(value: SealKind): Uint8Array {
      return serializeTupleQb64b([value.t, value.d]);
    },
    qb2(value: SealKind): Uint8Array {
      return serializeTupleQb2([value.t, value.d]);
    },
  } as const,
);

type BlindStateCrew = Readonly<
  { d: string; u: string; td: string; ts: string }
>;
const BLIND_STATE_FIELDS = Object.freeze(["d", "u", "td", "ts"] as const);
const BLIND_STATE_CAST = Object.freeze(
  {
    d: castage(Noncer, "nonce"),
    u: castage(Noncer, "nonce"),
    td: castage(Noncer, "nonce"),
    ts: castage(Labeler, "text"),
  } as const,
);

/**
 * Blind-state fixed-field value (`d`, `u`, `td`, `ts`).
 *
 * TypeScript divergence:
 * - the digest-like slots remain `Noncer`, not `Diger`, so empty-placeholder
 *   state keeps the same expressive range as KERIpy
 */
export type BlindState = Readonly<{
  d: Noncer;
  u: Noncer;
  td: Noncer;
  ts: Labeler;
}>;
export const BlindState = withSadProjection(
  {
    name: "BlindState",
    fields: BLIND_STATE_FIELDS,
    cast: BLIND_STATE_CAST,
    coden: "BlindedStateQuadruples" as const,
    fromTuple(
      [d, u, td, ts]: readonly [Noncer, Noncer, Noncer, Labeler],
    ): BlindState {
      return freezeRecord({ d, u, td, ts });
    },
    fromQb64bTuple(
      [d, u, td, ts]: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
    ): BlindState {
      return freezeRecord({
        d: new Noncer({ qb64b: d }),
        u: new Noncer({ qb64b: u }),
        td: new Noncer({ qb64b: td }),
        ts: new Labeler({ qb64b: ts }),
      });
    },
    toTuple(value: BlindState): readonly [Noncer, Noncer, Noncer, Labeler] {
      return [value.d, value.u, value.td, value.ts] as const;
    },
    toCrew(value: BlindState): BlindStateCrew {
      return buildCrew(BLIND_STATE_FIELDS, BLIND_STATE_CAST, value);
    },
    qb64(value: BlindState): string {
      return serializeTupleQb64([value.d, value.u, value.td, value.ts]);
    },
    qb64b(value: BlindState): Uint8Array {
      return serializeTupleQb64b([value.d, value.u, value.td, value.ts]);
    },
    qb2(value: BlindState): Uint8Array {
      return serializeTupleQb2([value.d, value.u, value.td, value.ts]);
    },
  } as const,
);

type BoundStateCrew = Readonly<{
  d: string;
  u: string;
  td: string;
  ts: string;
  bn: string;
  bd: string;
}>;
const BOUND_STATE_FIELDS = Object.freeze(
  ["d", "u", "td", "ts", "bn", "bd"] as const,
);
const BOUND_STATE_CAST = Object.freeze(
  {
    d: castage(Noncer, "nonce"),
    u: castage(Noncer, "nonce"),
    td: castage(Noncer, "nonce"),
    ts: castage(Labeler, "text"),
    bn: castage(NumberPrimitive, "numh"),
    bd: castage(Noncer, "nonce"),
  } as const,
);

/**
 * Bound blind-state fixed-field value (`d`, `u`, `td`, `ts`, `bn`, `bd`).
 *
 * KERIpy substance:
 * - extends blind state with the issuee key-state cross-anchor pair used for
 *   bound-state sextuples
 */
export type BoundState = Readonly<{
  d: Noncer;
  u: Noncer;
  td: Noncer;
  ts: Labeler;
  bn: NumberPrimitive;
  bd: Noncer;
}>;
export const BoundState = withSadProjection(
  {
    name: "BoundState",
    fields: BOUND_STATE_FIELDS,
    cast: BOUND_STATE_CAST,
    coden: "BoundStateSextuples" as const,
    fromTuple(
      [d, u, td, ts, bn, bd]: readonly [
        Noncer,
        Noncer,
        Noncer,
        Labeler,
        NumberPrimitive,
        Noncer,
      ],
    ): BoundState {
      return freezeRecord({ d, u, td, ts, bn, bd });
    },
    fromQb64bTuple(
      [d, u, td, ts, bn, bd]: readonly [
        Qb64b,
        Qb64b,
        Qb64b,
        Qb64b,
        Qb64b,
        Qb64b,
      ],
    ): BoundState {
      return freezeRecord({
        d: new Noncer({ qb64b: d }),
        u: new Noncer({ qb64b: u }),
        td: new Noncer({ qb64b: td }),
        ts: new Labeler({ qb64b: ts }),
        bn: new NumberPrimitive({ qb64b: bn }),
        bd: new Noncer({ qb64b: bd }),
      });
    },
    toTuple(
      value: BoundState,
    ): readonly [Noncer, Noncer, Noncer, Labeler, NumberPrimitive, Noncer] {
      return [
        value.d,
        value.u,
        value.td,
        value.ts,
        value.bn,
        value.bd,
      ] as const;
    },
    toCrew(value: BoundState): BoundStateCrew {
      return buildCrew(BOUND_STATE_FIELDS, BOUND_STATE_CAST, value);
    },
    qb64(value: BoundState): string {
      return serializeTupleQb64([
        value.d,
        value.u,
        value.td,
        value.ts,
        value.bn,
        value.bd,
      ]);
    },
    qb64b(value: BoundState): Uint8Array {
      return serializeTupleQb64b([
        value.d,
        value.u,
        value.td,
        value.ts,
        value.bn,
        value.bd,
      ]);
    },
    qb2(value: BoundState): Uint8Array {
      return serializeTupleQb2([
        value.d,
        value.u,
        value.td,
        value.ts,
        value.bn,
        value.bd,
      ]);
    },
  } as const,
);

type TypeMediaCrew = Readonly<{ d: string; u: string; mt: string; mv: string }>;
const TYPE_MEDIA_FIELDS = Object.freeze(["d", "u", "mt", "mv"] as const);
const TYPE_MEDIA_CAST = Object.freeze(
  {
    d: castage(Noncer, "nonce"),
    u: castage(Noncer, "nonce"),
    mt: castage(Labeler, "text"),
    mv: castage(Texter, "text"),
  } as const,
);

/**
 * Typed-media fixed-field value (`d`, `u`, `mt`, `mv`).
 *
 * Maintainer model:
 * - the field names stay KERIpy-exact
 * - callers read primitive projections directly from the fields
 */
export type TypeMedia = Readonly<{
  d: Noncer;
  u: Noncer;
  mt: Labeler;
  mv: Texter;
}>;
export const TypeMedia = withSadProjection(
  {
    name: "TypeMedia",
    fields: TYPE_MEDIA_FIELDS,
    cast: TYPE_MEDIA_CAST,
    coden: "TypedMediaQuadruples" as const,
    fromTuple(
      [d, u, mt, mv]: readonly [Noncer, Noncer, Labeler, Texter],
    ): TypeMedia {
      return freezeRecord({ d, u, mt, mv });
    },
    fromQb64bTuple(
      [d, u, mt, mv]: readonly [Qb64b, Qb64b, Qb64b, Qb64b],
    ): TypeMedia {
      return freezeRecord({
        d: new Noncer({ qb64b: d }),
        u: new Noncer({ qb64b: u }),
        mt: new Labeler({ qb64b: mt }),
        mv: new Texter({ qb64b: mv }),
      });
    },
    toTuple(value: TypeMedia): readonly [Noncer, Noncer, Labeler, Texter] {
      return [value.d, value.u, value.mt, value.mv] as const;
    },
    toCrew(value: TypeMedia): TypeMediaCrew {
      return buildCrew(TYPE_MEDIA_FIELDS, TYPE_MEDIA_CAST, value);
    },
    qb64(value: TypeMedia): string {
      return serializeTupleQb64([value.d, value.u, value.mt, value.mv]);
    },
    qb64b(value: TypeMedia): Uint8Array {
      return serializeTupleQb64b([value.d, value.u, value.mt, value.mv]);
    },
    qb2(value: TypeMedia): Uint8Array {
      return serializeTupleQb2([value.d, value.u, value.mt, value.mv]);
    },
  } as const,
);

export interface MakeBlindUuidOptions {
  raw?: Uint8Array;
  salt?: string;
  sn?: NumberLike;
  tier?: Tier;
}

export interface MakeBlindStateOptions extends MakeBlindUuidOptions {
  uuid?: NoncerLike;
  acdc?: NoncerLike;
  state?: LabelerLike;
  code?: string;
}

export interface MakeBoundStateOptions extends MakeBlindStateOptions {
  bsn?: NumberLike;
  bd?: NoncerLike;
}

export interface MakeTypeMediaOptions extends MakeBlindUuidOptions {
  uuid?: NoncerLike;
  mt?: LabelerLike;
  mv?: TexterLike;
  code?: string;
}

export interface UnblindBlindStateOptions extends MakeBlindUuidOptions {
  said: string;
  uuid?: NoncerLike;
  acdc?: NoncerLike;
  states?: readonly LabelerLike[];
  code?: string;
}

export interface UnblindBoundStateOptions extends UnblindBlindStateOptions {
  bounds?: readonly (readonly [NumberLike, NoncerLike])[];
}

/**
 * Derive the deterministic disclosure UUID used by blinded/bound/media
 * commitment records.
 *
 * KERIpy correspondence:
 * - mirrors `Blinder.makeUUID(...)`
 * - sequence numbers feed the salty path through `numh`, not decimal text
 */
export function makeBlindUuid(
  {
    raw,
    salt,
    sn = 1,
    tier,
  }: MakeBlindUuidOptions = {},
): Noncer {
  const salter = salt !== undefined || raw !== undefined || tier !== undefined
    ? new Salter({ qb64: salt, raw, tier })
    : new Salter({});
  return new Noncer({
    code: NonceDex.Salt_256,
    raw: salter.stretch({ path: coerceNumh(sn), tier }),
  });
}

/** Compute the blinded commitment nonce for one `BlindState` record. */
export function commitBlindState(
  value: BlindState,
  code?: string,
): BlindState {
  return saidifyDisclosureRecord(BlindState, value, code);
}

/** Compute the blinded commitment nonce for one `BoundState` record. */
export function commitBoundState(
  value: BoundState,
  code?: string,
): BoundState {
  return saidifyDisclosureRecord(BoundState, value, code);
}

/** Compute the blinded commitment nonce for one `TypeMedia` record. */
export function commitTypeMedia(
  value: TypeMedia,
  code?: string,
): TypeMedia {
  return saidifyDisclosureRecord(TypeMedia, value, code);
}

/**
 * Build one blinded disclosure-state record and compute its `d` commitment.
 *
 * KERIpy correspondence:
 * - mirrors `Blinder.blind(..., bound=False)`
 */
export function makeBlindState(
  {
    uuid,
    raw,
    salt,
    sn = 1,
    tier,
    acdc = "",
    state = "",
    code,
  }: MakeBlindStateOptions = {},
): BlindState {
  return commitBlindState(
    BlindState.fromSad({
      d: "",
      u: ensurePresentUuid(uuid, { raw, salt, sn, tier }).nonce,
      td: coerceNonceText(acdc),
      ts: coerceLabelText(state),
    }),
    code,
  );
}

/**
 * Build one bound blinded-state record and compute its `d` commitment.
 *
 * KERIpy correspondence:
 * - mirrors `Blinder.blind(..., bound=True)`
 */
export function makeBoundState(
  {
    uuid,
    raw,
    salt,
    sn = 1,
    tier,
    acdc = "",
    state = "",
    bsn = 0,
    bd = "",
    code,
  }: MakeBoundStateOptions = {},
): BoundState {
  return commitBoundState(
    BoundState.fromSad({
      d: "",
      u: ensurePresentUuid(uuid, { raw, salt, sn, tier }).nonce,
      td: coerceNonceText(acdc),
      ts: coerceLabelText(state),
      bn: coerceNumh(bsn),
      bd: coerceNonceText(bd),
    }),
    code,
  );
}

/**
 * Build one typed-media disclosure record and compute its `d` commitment.
 *
 * KERIpy correspondence:
 * - matches `Mediar(..., makify=True)` without recreating a wrapper object
 */
export function makeTypeMedia(
  {
    uuid,
    raw,
    salt,
    sn = 1,
    tier,
    mt = "",
    mv = "",
    code,
  }: MakeTypeMediaOptions = {},
): TypeMedia {
  return commitTypeMedia(
    TypeMedia.fromSad({
      d: "",
      u: ensurePresentUuid(uuid, { raw, salt, sn, tier }).nonce,
      mt: coerceLabelText(mt),
      mv: coerceTexterText(mv),
    }),
    code,
  );
}

/**
 * Rebuild the matching blinded-state candidate if one exists.
 *
 * KERIpy correspondence:
 * - mirrors `Blinder.unblind(..., bound=False)`
 * - tries the placeholder combinations too, so callers do not need to add the
 *   empty `acdc` / empty `state` cases themselves
 */
export function unblindBlindState(
  {
    said,
    uuid,
    raw,
    salt,
    sn = 1,
    tier,
    acdc = "",
    states = [],
    code,
  }: UnblindBlindStateOptions,
): BlindState | null {
  const resolvedUuid = ensurePresentUuid(uuid, { raw, salt, sn, tier });
  const acdcs = [...new Set([coerceNonceText(acdc), ""])];
  const stateTexts = [...new Set(states.map(coerceLabelText).concat(""))];

  for (const td of acdcs) {
    for (const ts of stateTexts) {
      const candidate = makeBlindState({
        uuid: resolvedUuid,
        acdc: td,
        state: ts,
        code,
      });
      if (candidate.d.nonce === said) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Rebuild the matching bound blinded-state candidate if one exists.
 *
 * KERIpy correspondence:
 * - mirrors `Blinder.unblind(..., bound=True)`
 * - tries placeholder bound pairs automatically by including `(0, "")`
 */
export function unblindBoundState(
  {
    said,
    uuid,
    raw,
    salt,
    sn = 1,
    tier,
    acdc = "",
    states = [],
    bounds = [],
    code,
  }: UnblindBoundStateOptions,
): BoundState | null {
  const resolvedUuid = ensurePresentUuid(uuid, { raw, salt, sn, tier });
  const acdcs = [...new Set([coerceNonceText(acdc), ""])];
  const stateTexts = [...new Set(states.map(coerceLabelText).concat(""))];
  const normalizedBounds = [
    ...bounds.map(([bsn, bd]) => [coerceNumh(bsn), coerceNonceText(bd)] as const),
    ["0", ""] as const,
  ];
  const uniqueBounds = [
    ...new Map(normalizedBounds.map((bound) => [`${bound[0]}:${bound[1]}`, bound])).values(),
  ];

  for (const [bn, bd] of uniqueBounds) {
    for (const td of acdcs) {
      for (const ts of stateTexts) {
        const candidate = makeBoundState({
          uuid: resolvedUuid,
          acdc: td,
          state: ts,
          bsn: bn,
          bd,
          code,
        });
        if (candidate.d.nonce === said) {
          return candidate;
        }
      }
    }
  }

  return null;
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
    SealDigest: SealDigest.cast,
    SealRoot: SealRoot.cast,
    SealSource: SealSource.cast,
    SealEvent: SealEvent.cast,
    SealLast: SealLast.cast,
    SealBack: SealBack.cast,
    SealKind: SealKind.cast,
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
    BlindState: BlindState.cast,
    BoundState: BoundState.cast,
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
    TypeMedia: TypeMedia.cast,
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

/** Fixed-field seal union used by typed KERI seal projections. */
export type SealRecord =
  | SealDigest
  | SealRoot
  | SealSource
  | SealEvent
  | SealLast
  | SealBack
  | SealKind;

/** Fixed-field structing record union. */
export type StructingRecord =
  | SealRecord
  | BlindState
  | BoundState
  | TypeMedia;

/** Ordered seal descriptor registry for raw-SAD projection helpers. */
export const SealDescriptors = Object.freeze(
  [
    SealDigest,
    SealRoot,
    SealSource,
    SealEvent,
    SealLast,
    SealBack,
    SealKind,
  ] as const,
);

/**
 * Authoritative clan-name -> semantic counter-name map for structing families.
 *
 * This mirrors KERIpy `ClanToCodens`, but stores semantic counter names rather
 * than Python codex members.
 */
export const ClanToCodens = Object.freeze(
  {
    SealDigest: SealDigest.coden,
    SealRoot: SealRoot.coden,
    SealSource: SealSource.coden,
    SealEvent: SealEvent.coden,
    SealLast: SealLast.coden,
    SealBack: SealBack.coden,
    SealKind: SealKind.coden,
    BlindState: BlindState.coden,
    BoundState: BoundState.coden,
    TypeMedia: TypeMedia.coden,
  } as const satisfies Record<
    StructClanName,
    CounterCodeNameV1 | CounterCodeNameV2
  >,
);

/** Inverse semantic counter-name -> clan-name registry for structing families. */
export const CodenToClans = invertClanCodens(ClanToCodens);
