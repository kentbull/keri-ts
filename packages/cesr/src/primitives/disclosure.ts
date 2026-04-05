import { b } from "../core/bytes.ts";
import type { Tier } from "../core/vocabulary.ts";
import { DigDex, DIGEST_CODES, NonceDex } from "./codex.ts";
import { Diger } from "./diger.ts";
import { Labeler } from "./labeler.ts";
import { Noncer } from "./noncer.ts";
import { NumberPrimitive } from "./number.ts";
import { Salter } from "./salter.ts";
import {
  BlindState,
  type BlindState as BlindStateRecord,
  BoundState,
  type BoundState as BoundStateRecord,
  TypeMedia,
  type TypeMedia as TypeMediaRecord,
} from "./structing.ts";
import { Texter } from "./texter.ts";

/**
 * Disclosure-workflow input accepted for sequence-number slots.
 *
 * TypeScript-specific convenience:
 * - KERIpy takes flexible Python values through keyword arguments; this union
 *   keeps the same ergonomic range while staying explicit in TS.
 */
export type NumberLike = NumberPrimitive | number | bigint | string;

/**
 * Disclosure-workflow input accepted for nonce-like slots.
 *
 * Empty string / null / undefined preserve KERIpy placeholder semantics.
 */
export type NoncerLike = Noncer | string | null | undefined;

/** Disclosure-workflow input accepted for label-text slots. */
export type LabelerLike = Labeler | string | null | undefined;

/** Disclosure-workflow input accepted for text-payload slots. */
export type TexterLike = Texter | string | null | undefined;

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

type DisclosureRecord = BlindStateRecord | BoundStateRecord | TypeMediaRecord;
type DisclosureSad = Readonly<{ d: string }>;
type DisclosureTupleField = Readonly<{ qb64: string }>;
type DisclosureDescriptor<
  TRecord extends DisclosureRecord,
  TSad extends DisclosureSad,
> = {
  readonly fields: readonly string[];
  toSad(value: TRecord): TSad;
  toTuple(value: TRecord): readonly DisclosureTupleField[];
  fromSad(value: TSad): TRecord;
};

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

function effectiveDisclosureCode(current: Noncer, code?: string): string {
  if (code !== undefined) {
    return code;
  }
  return DIGEST_CODES.has(current.code) ? current.code : DigDex.Blake3_256;
}

function computeDisclosureNonce<
  TRecord extends DisclosureRecord,
  TSad extends DisclosureSad,
>(
  descriptor: DisclosureDescriptor<TRecord, TSad>,
  value: TRecord,
  code?: string,
): Noncer {
  const effectiveCode = effectiveDisclosureCode(value.d, code);
  const tuple = descriptor.toTuple(value);
  const ser = descriptor.fields.map((field, index) =>
    field === "d"
      ? "#".repeat(Noncer.fullSizeForCode(effectiveCode))
      : tuple[index].qb64
  ).join("");
  return new Noncer({
    code: effectiveCode,
    raw: Diger.digest(b(ser), effectiveCode),
  });
}

function saidifyDisclosureRecord<
  TRecord extends DisclosureRecord,
  TSad extends DisclosureSad,
>(
  descriptor: DisclosureDescriptor<TRecord, TSad>,
  value: TRecord,
  code?: string,
): TRecord {
  const d = computeDisclosureNonce(descriptor, value, code);
  return descriptor.fromSad({
    ...descriptor.toSad(value),
    d: d.nonce,
  } as TSad);
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
  value: BlindStateRecord,
  code?: string,
): BlindStateRecord {
  return saidifyDisclosureRecord(BlindState, value, code);
}

/** Compute the blinded commitment nonce for one `BoundState` record. */
export function commitBoundState(
  value: BoundStateRecord,
  code?: string,
): BoundStateRecord {
  return saidifyDisclosureRecord(BoundState, value, code);
}

/** Compute the blinded commitment nonce for one `TypeMedia` record. */
export function commitTypeMedia(
  value: TypeMediaRecord,
  code?: string,
): TypeMediaRecord {
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
): BlindStateRecord {
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
): BoundStateRecord {
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
): TypeMediaRecord {
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
): BlindStateRecord | null {
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
): BoundStateRecord | null {
  const resolvedUuid = ensurePresentUuid(uuid, { raw, salt, sn, tier });
  const acdcs = [...new Set([coerceNonceText(acdc), ""])];
  const stateTexts = [...new Set(states.map(coerceLabelText).concat(""))];
  const normalizedBounds = [
    ...bounds.map(([bsn, bd]) => [coerceNumh(bsn), coerceNonceText(bd)] as const),
    ["0", ""] as const,
  ];
  const uniqueBounds = [
    ...new Map(
      normalizedBounds.map((bound) => [`${bound[0]}:${bound[1]}`, bound]),
    ).values(),
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
