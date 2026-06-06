/**
 * Fixed-field graduated-disclosure workflow helpers.
 *
 * This module is the verb layer for the fixed-field blinded disclosure records
 * defined in `structing.ts`.
 *
 * Keep the boundary clear:
 * - `structing.ts` owns the nouns and representation conversions
 * - this file owns deterministic UUID derivation, blind/bound/media
 *   commitment recomputation, and candidate unblinding search
 * - `blinder.ts` / `mediar.ts` own counted-group transport framing only
 *
 * This is intentionally different from KERIpy's richer `Blinder` /
 * `Mediar` classes. `keri-ts` keeps semantic records as plain data and puts
 * workflow verbs in a dedicated module so schema and workflow can evolve
 * independently.
 */
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

/**
 * Inputs used to derive the deterministic disclosure UUID.
 *
 * KERIpy correspondence:
 * - mirrors the keyword-argument surface accepted by `Blinder.makeUUID(...)`
 *
 * Defaults:
 * - `sn=1`
 * - if `raw`, `salt`, and `tier` are omitted, a fresh `Salter` is generated
 */
export interface MakeBlindUuidOptions {
  /** Raw salt bytes fed into `Salter` when the caller already has them. */
  raw?: Uint8Array;
  /** Qualified CESR salt (`Salter.qb64`) used instead of `raw`. */
  salt?: string;
  /** Sequence number projected through `numh` before entering the salty path. */
  sn?: NumberLike;
  /** Salty derivation tier forwarded into `Salter.stretch(...)`. */
  tier?: Tier;
}

/**
 * Inputs for building one `BlindState`.
 *
 * Placeholder semantics intentionally match KERIpy:
 * - omitted `uuid` means "derive it deterministically"
 * - omitted `acdc` / `state` mean "use empty disclosure placeholders"
 * - omitted `code` means "reuse an existing digest-capable code or default to
 *   Blake3-256"
 */
export interface MakeBlindStateOptions extends MakeBlindUuidOptions {
  /** Disclosure UUID. Omit to derive via `makeBlindUuid(...)`. */
  uuid?: NoncerLike;
  /** Disclosed ACDC/TEL SAID, or empty placeholder. */
  acdc?: NoncerLike;
  /** Disclosed state label, or empty placeholder. */
  state?: LabelerLike;
  /** Optional digest/noncer code for the committed `d` field. */
  code?: string;
}

/**
 * Inputs for building one `BoundState`.
 *
 * Adds the issuee key-state cross-anchor pair used by bound-state sextuples.
 */
export interface MakeBoundStateOptions extends MakeBlindStateOptions {
  /** Bound issuee key-state sequence number. Defaults to placeholder `0`. */
  bsn?: NumberLike;
  /** Bound issuee key-state digest/nonce. Defaults to empty placeholder. */
  bd?: NoncerLike;
}

/**
 * Inputs for building one `TypeMedia`.
 *
 * This is the typed-media sibling to blind/bound state disclosure helpers.
 */
export interface MakeTypeMediaOptions extends MakeBlindUuidOptions {
  /** Disclosure UUID. Omit to derive via `makeBlindUuid(...)`. */
  uuid?: NoncerLike;
  /** Media type label, such as `application/json`. */
  mt?: LabelerLike;
  /** Media value/payload text. */
  mv?: TexterLike;
  /** Optional digest/noncer code for the committed `d` field. */
  code?: string;
}

/**
 * Inputs for rebuilding one matching `BlindState` from a disclosed commitment.
 *
 * Search semantics:
 * - `said` is the commitment being matched
 * - `states` is the candidate state-label search space
 * - the helper automatically includes the empty placeholder state and empty
 *   placeholder ACDC value so callers do not need to remember those cases
 */
export interface UnblindBlindStateOptions extends MakeBlindUuidOptions {
  /** Target commitment nonce (`BlindState.d.nonce`) to match. */
  said: string;
  /** Disclosure UUID. Omit to deterministically reconstruct it. */
  uuid?: NoncerLike;
  /** Candidate disclosed ACDC/TEL SAID. Empty placeholder is auto-included. */
  acdc?: NoncerLike;
  /** Candidate state labels to try while searching for the matching record. */
  states?: readonly LabelerLike[];
  /** Optional digest/noncer code for recomputed candidates. */
  code?: string;
}

/**
 * Inputs for rebuilding one matching `BoundState` from a disclosed commitment.
 *
 * Search semantics:
 * - `bounds` is the candidate `(bn, bd)` cross-anchor search space
 * - the helper automatically includes placeholder `(0, "")`
 */
export interface UnblindBoundStateOptions extends UnblindBlindStateOptions {
  /** Candidate issuee key-state cross-anchor pairs to try. */
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

/** Normalize `Number`-like input into the KERIpy `numh` hex string projection. */
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

/** Normalize nonce-like input into crew/SAD text while preserving empty placeholders. */
function coerceNonceText(value: NoncerLike): string {
  if (value instanceof Noncer) {
    return value.nonce;
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

/** Normalize label-like input into label text while preserving empty placeholders. */
function coerceLabelText(value: LabelerLike): string {
  if (value instanceof Labeler) {
    return value.text;
  }
  return value ?? "";
}

/** Normalize text-like input into plain text while preserving empty placeholders. */
function coerceTexterText(value: TexterLike): string {
  if (value instanceof Texter) {
    return value.text;
  }
  return value ?? "";
}

/**
 * Require a non-empty disclosure UUID, deriving one when omitted.
 *
 * Maintainer rule:
 * - placeholder semantics apply to blinded record fields
 * - they do not apply to the disclosure UUID itself, because the UUID scopes
 *   the blind/unblind computation
 */
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

/** Choose the digest/noncer code used for the recomputed commitment field `d`. */
function effectiveDisclosureCode(current: Noncer, code?: string): string {
  if (code !== undefined) {
    return code;
  }
  return DIGEST_CODES.has(current.code) ? current.code : DigDex.Blake3_256;
}

/**
 * Recompute the committed `d` field for one fixed-field disclosure record.
 *
 * Parity rule:
 * - the commitment is computed from tuple `qb64` field serializations with a
 *   dummied `d` slot
 * - it is not computed from crew/SAD strings
 *
 * This mirrors the saidive/makify behavior KERIpy gets through `Structor`.
 */
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
  // Fixed-field disclosure commitments work over canonical primitive tuple
  // bytes. Crew/SAD projections are for readability and object transport, not
  // for commitment material.
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

/** Rebuild the record with a freshly committed `d` field. */
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

/**
 * Recompute the committed `d` field for one `BlindState`.
 *
 * KERIpy correspondence:
 * - same semantic role as building `Blinder(..., makify=True)` for the
 *   blind-state quadruple without instantiating a transport wrapper
 */
export function commitBlindState(
  value: BlindStateRecord,
  code?: string,
): BlindStateRecord {
  return saidifyDisclosureRecord(BlindState, value, code);
}

/**
 * Recompute the committed `d` field for one `BoundState`.
 *
 * KERIpy correspondence:
 * - same semantic role as the bound-state branch of `Blinder.blind(...)`
 */
export function commitBoundState(
  value: BoundStateRecord,
  code?: string,
): BoundStateRecord {
  return saidifyDisclosureRecord(BoundState, value, code);
}

/**
 * Recompute the committed `d` field for one `TypeMedia`.
 *
 * KERIpy correspondence:
 * - same semantic role as `Mediar(..., makify=True)` for typed-media records
 */
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
 *
 * Search strategy:
 * - derive or validate the UUID
 * - try the candidate `acdc` plus empty placeholder
 * - try each caller-supplied state plus empty placeholder
 * - return the first candidate whose recomputed `d` matches `said`
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

  // KERIpy search semantics intentionally treat empty ACDC/state placeholders
  // as real candidates, because a disclosure may reveal them later or keep
  // them compact for the current step.
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
 *
 * Search strategy:
 * - same placeholder search as `unblindBlindState(...)`
 * - plus candidate `(bn, bd)` pairs, with placeholder `(0, "")` always added
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
  // Placeholder bound pairs matter for parity with KERIpy's partially revealed
  // disclosure states, so the search space always includes `(0, "")`.
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
