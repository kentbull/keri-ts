import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { Bexter } from "./bexter.ts";
import { LabelDex } from "./codex.ts";
import { THOLDER_NUMERIC_CODES, THOLDER_WEIGHTED_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { NumberPrimitive } from "./number.ts";

/**
 * SAD-facing textual threshold weight token such as `"1"` or `"1/2"`.
 *
 * KERIpy correspondence: weighted threshold members are expressed as strings
 * in the event body, then normalized into exact rational arithmetic for
 * satisfaction checks.
 */
export type ThresholdWeight = string;

/**
 * Single nested weighted group inside one clause.
 *
 * Boundary contract:
 * - the map must contain exactly one entry
 * - the key is the outer group weight contributed to the clause when the group
 *   itself is satisfied
 * - the value array lists the nested member weights that consume consecutive
 *   signer slots inside the group
 */
export type ThresholdNestedGroup = Record<string, ThresholdWeight[]>;

/** One top-level entry inside a weighted clause. */
export type ThresholdClauseEntry = ThresholdWeight | ThresholdNestedGroup;

/**
 * One weighted clause.
 *
 * Maintainer model: entries inside a clause contribute toward that clause's
 * `>= 1` satisfaction test, while multiple clauses in a full threshold are
 * AND'ed together.
 */
export type ThresholdClause = ThresholdClauseEntry[];

/**
 * Full weighted threshold expression.
 *
 * A single clause may be represented directly as `ThresholdClause`; a
 * multi-clause threshold is represented as `ThresholdClause[]`.
 */
export type WeightedThreshold = ThresholdClause | ThresholdClause[];

/**
 * Public semantic threshold union used at SAD and state-record boundaries.
 *
 * Examples for maintainers defining thresholds with the exported type system:
 * ```ts
 * const numeric: ThresholdSith = "2";
 *
 * const flatWeighted: ThresholdSith = ["1/2", "1/2", "1/4", "1/4"];
 *
 * const groupedWeighted: ThresholdSith = [
 *   { "1/2": ["1/2", "1/4", "1/4"] },
 *   "1/2",
 * ];
 *
 * const multiClause: ThresholdSith = [
 *   ["1/2", "1/2"],
 *   [{ "1/2": ["1/3", "1/3", "1/3"] }, "1/2"],
 * ];
 * ```
 *
 * Slot-order rule:
 * - signer slots are consumed from left to right
 * - plain weights consume one signer slot each
 * - nested groups consume one signer slot per nested member, not one slot for
 *   the outer map wrapper
 */
export type ThresholdSith = string | WeightedThreshold;

/** Constructor-friendly threshold input accepted by `Tholder`. */
export type ThresholdInput = ThresholdSith | number | bigint;

/** Exact rational used internally so weighted arithmetic never depends on floats. */
interface Rational {
  numerator: bigint;
  denominator: bigint;
}

/**
 * Normalized nested group.
 *
 * `weight` is the clause contribution unlocked by the group, and `members`
 * holds the nested signer-member weights that must themselves sum to `>= 1`.
 */
interface WeightedGroup {
  weight: Rational;
  members: Rational[];
}

/** Internal union for one normalized weighted clause entry. */
type NormalizedClauseEntry = Rational | WeightedGroup;

/** Internal normalized clause representation used by satisfaction logic. */
type NormalizedWeightedThreshold = NormalizedClauseEntry[];

/**
 * Numeric tholder codex capacities keyed by the code used for a given raw width.
 *
 * This is the bridge between bigint numeric thresholds and the compact CESR
 * numeric codex family that `Tholder` reuses.
 */
const NUMERIC_CAPACITIES = [
  { code: "M", rawSize: 2 },
  { code: "0H", rawSize: 4 },
  { code: "R", rawSize: 5 },
  { code: "N", rawSize: 8 },
  { code: "S", rawSize: 11 },
  { code: "T", rawSize: 14 },
  { code: "0A", rawSize: 16 },
  { code: "U", rawSize: 17 },
] as const;

/** Largest bigint that can be mirrored into a lossless JS `number`. */
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/** Narrow `unknown` into a plain object map rather than an array-like value. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recognize constructor inputs that already describe a `Matter`/`MatterInit`
 * wire representation rather than a semantic threshold expression.
 */
function isMatterInitLike(value: unknown): value is Matter | MatterInit {
  return value instanceof Matter || (
    isRecord(value)
    && ("raw" in value || "qb64" in value || "qb64b" in value || "qb2" in value
      || "code" in value)
  );
}

/** Euclidean greatest-common-divisor helper for rational normalization. */
function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left === 0n ? 1n : left;
}

/**
 * Reduce a rational to canonical sign/lowest-terms form.
 *
 * Invariant: denominator is always positive on return.
 */
function normalizeRational(
  numerator: bigint,
  denominator: bigint,
): Rational {
  if (denominator === 0n) {
    throw new Error("Invalid threshold weight denominator=0.");
  }
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

/** Add two exact rationals without passing through floating-point math. */
function addRationals(left: Rational, right: Rational): Rational {
  return normalizeRational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

/** Compare two exact rationals using cross-multiplication. */
function compareRationals(left: Rational, right: Rational): number {
  const lhs = left.numerator * right.denominator;
  const rhs = right.numerator * left.denominator;
  if (lhs === rhs) return 0;
  return lhs > rhs ? 1 : -1;
}

/** True when a rational meets the KERI weighted-threshold satisfaction floor of `1`. */
function atLeastOne(value: Rational): boolean {
  return compareRationals(value, { numerator: 1n, denominator: 1n }) >= 0;
}

/** Shared zero rational constant constructor. */
function rationalZero(): Rational {
  return { numerator: 0n, denominator: 1n };
}

/** Shared one rational constant constructor. */
function rationalOne(): Rational {
  return { numerator: 1n, denominator: 1n };
}

/** Convert a normalized rational back into the SAD-facing textual weight form. */
function formatWeight(weight: Rational): string {
  if (
    weight.denominator === 1n
    || weight.numerator === 0n
    || weight.numerator === weight.denominator
  ) {
    return weight.numerator.toString(10);
  }
  return `${weight.numerator.toString(10)}/${weight.denominator.toString(10)}`;
}

/** Encode one rational into the compact bext token form used inside weighted limens. */
function encodeBextWeight(weight: Rational): string {
  if (
    weight.denominator === 1n
    || weight.numerator === 0n
    || weight.numerator === weight.denominator
  ) {
    return weight.numerator.toString(10);
  }
  return `${weight.numerator.toString(10)}s${weight.denominator.toString(10)}`;
}

/**
 * Parse and validate one SAD-facing weight token.
 *
 * Boundary contract:
 * - accepts only integer `0`/`1` or fractional `n/d` forms
 * - rejects values outside the inclusive range `[0, 1]`
 * - normalizes equivalent forms such as `2/4` into exact reduced rationals
 */
function parseWeight(input: string): Rational {
  const text = input.trim();
  if (text.length === 0) {
    throw new Error("Empty threshold weight.");
  }
  if (/^-?\d+$/.test(text)) {
    const value = BigInt(text);
    if (value < 0n || value > 1n) {
      throw new Error(`Invalid threshold weight not 0 <= ${text} <= 1.`);
    }
    return { numerator: value, denominator: 1n };
  }
  const match = text.match(/^(-?\d+)\/(\d+)$/);
  if (!match) {
    throw new Error(`Invalid threshold weight ${text}.`);
  }
  const numerator = BigInt(match[1]);
  const denominator = BigInt(match[2]);
  const normalized = normalizeRational(numerator, denominator);
  if (
    compareRationals(normalized, rationalZero()) < 0
    || compareRationals(normalized, rationalOne()) > 0
  ) {
    throw new Error(
      `Invalid threshold weight not 0 <= ${text} <= 1.`,
    );
  }
  return normalized;
}

/** Deep-clone the public semantic threshold shape before returning it outward. */
function cloneThresholdSith(sith: ThresholdSith): ThresholdSith {
  if (typeof sith === "string") {
    return sith;
  }
  return sith.map((clauseOrEntry) => {
    if (typeof clauseOrEntry === "string") {
      return clauseOrEntry;
    }
    if (Array.isArray(clauseOrEntry)) {
      return clauseOrEntry.map((entry) =>
        typeof entry === "string"
          ? entry
          : Object.fromEntries(
            Object.entries(entry).map(([k, values]) => [k, [...values]]),
          )
      );
    }
    return Object.fromEntries(
      Object.entries(clauseOrEntry).map(([k, values]) => [k, [...values]]),
    );
  }) as ThresholdSith;
}

/**
 * Choose the StrB64/Bexter code family variant for a weighted threshold limen.
 *
 * The selection depends on raw byte length, not bext text length, because
 * StrB64 lead-size semantics are defined over the underlying CESR raw payload.
 */
function chooseBexterCode(rawLength: number): string {
  const leadSize = (3 - (rawLength % 3)) % 3;
  return leadSize === 0
    ? LabelDex.StrB64_L0
    : leadSize === 1
    ? LabelDex.StrB64_L1
    : LabelDex.StrB64_L2;
}

/** Resolve the smallest numeric-threshold codex entry that can carry `rawSize` bytes. */
function chooseNumberCode(rawSize: number): string {
  const entry = NUMERIC_CAPACITIES.find(({ rawSize: max }) => rawSize <= max);
  if (!entry) {
    throw new Error(`Unsupported threshold width=${rawSize}.`);
  }
  return entry.code;
}

/** Convert a non-negative bigint threshold into big-endian raw bytes. */
function bigintToBytes(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error(`Negative threshold number=${value}.`);
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

/** Build the `MatterInit` used to serialize a numeric threshold into CESR. */
function makeNumberMatterInit(value: bigint): MatterInit {
  const raw = bigintToBytes(value);
  const code = chooseNumberCode(raw.length);
  const entry = NUMERIC_CAPACITIES.find(({ code: current }) => current === code);
  if (!entry) {
    throw new Error(`Unsupported threshold number code=${code}.`);
  }
  const padded = new Uint8Array(entry.rawSize);
  padded.set(raw, entry.rawSize - raw.length);
  return { code, raw: padded };
}

/**
 * Normalize a public weighted threshold expression into exact arithmetic form.
 *
 * Responsibilities:
 * - validate clause/group shape and KERIpy-style invariants
 * - compute the internal rational AST used by `satisfy(indices)`
 * - return a canonical semantic clone suitable for `sith` exposure
 */
function normalizeWeightedInput(
  value: WeightedThreshold,
): { clauses: NormalizedWeightedThreshold[]; semantic: WeightedThreshold } {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Empty weighted threshold expression.");
  }

  const wrapSingleClause = value.some((entry) => !Array.isArray(entry));
  const sourceClauses = wrapSingleClause
    ? [value as ThresholdClause]
    : value as ThresholdClause[];

  const clauses: NormalizedWeightedThreshold[] = [];
  for (const clause of sourceClauses) {
    if (!Array.isArray(clause) || clause.length === 0) {
      throw new Error("Empty weighted threshold clause.");
    }
    let topWeight = rationalZero();
    const normalizedClause: NormalizedWeightedThreshold = [];
    for (const entry of clause) {
      if (typeof entry === "string") {
        const weight = parseWeight(entry);
        normalizedClause.push(weight);
        topWeight = addRationals(topWeight, weight);
        continue;
      }
      if (!isRecord(entry)) {
        throw new Error("Invalid weighted threshold clause entry.");
      }
      const keys = Object.keys(entry);
      if (keys.length !== 1) {
        throw new Error("Nested weighted threshold groups must have exactly one key.");
      }
      const groupKey = keys[0];
      const nested = entry[groupKey];
      if (!Array.isArray(nested) || nested.length === 0) {
        throw new Error("Nested weighted threshold groups must contain member weights.");
      }
      const groupWeight = parseWeight(groupKey);
      const members = nested.map((member) => {
        if (typeof member !== "string") {
          throw new Error("Nested threshold member weights must be strings.");
        }
        return parseWeight(member);
      });
      let memberSum = rationalZero();
      for (const member of members) {
        memberSum = addRationals(memberSum, member);
      }
      if (!atLeastOne(memberSum)) {
        throw new Error("All nested weighted threshold sums must be at least 1.");
      }
      normalizedClause.push({ weight: groupWeight, members });
      topWeight = addRationals(topWeight, groupWeight);
    }
    if (!atLeastOne(topWeight)) {
      throw new Error("All weighted threshold clause sums must be at least 1.");
    }
    clauses.push(normalizedClause);
  }

  const semanticClauses = clauses.map((clause) =>
    clause.map((entry) =>
      "numerator" in entry
        ? formatWeight(entry)
        : { [formatWeight(entry.weight)]: entry.members.map(formatWeight) }
    )
  );
  return {
    clauses,
    semantic: semanticClauses.length === 1 ? semanticClauses[0] : semanticClauses,
  };
}

/** Parse a JSON threshold literal supplied through string-only config or CLI seams. */
function parseWeightedJson(text: string): WeightedThreshold {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Weighted threshold JSON must decode to an array.");
  }
  return parsed as WeightedThreshold;
}

/**
 * Normalize any semantic threshold input into one constructor-ready bundle.
 *
 * This is the central semantic funnel for `{ sith }`/numeric/weighted inputs:
 * callers receive CESR serialization material plus the precomputed state needed
 * for `weighted`, `size`, `num`, `thold`, and `sith`.
 */
function normalizeThresholdInput(
  value: ThresholdInput,
): {
  matterInit: MatterInit;
  weighted: boolean;
  numeric: bigint | null;
  size: number;
  thold: bigint | NormalizedWeightedThreshold[];
  semantic: ThresholdSith;
} {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid numeric threshold=${value}.`);
    }
    return normalizeThresholdInput(BigInt(value));
  }
  if (typeof value === "bigint") {
    const matterInit = makeNumberMatterInit(value);
    const size = value > MAX_SAFE_BIGINT ? Number.MAX_SAFE_INTEGER : Number(value);
    return {
      matterInit,
      weighted: false,
      numeric: value,
      size,
      thold: value,
      semantic: value.toString(16),
    };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("Empty threshold expression.");
    }
    if (trimmed.startsWith("[")) {
      return normalizeThresholdInput(parseWeightedJson(trimmed));
    }
    if (!/^[0-9a-f]+$/i.test(trimmed)) {
      throw new Error(`Invalid numeric threshold ${trimmed}.`);
    }
    return normalizeThresholdInput(BigInt(`0x${trimmed}`));
  }

  const weighted = normalizeWeightedInput(value);
  const bext = weighted.clauses.map((clause) =>
    clause.map((entry) =>
      "numerator" in entry
        ? encodeBextWeight(entry)
        : `${encodeBextWeight(entry.weight)}k${entry.members.map(encodeBextWeight).join("v")}`
    ).join("c")
  ).join("a");
  const raw = Bexter.rawify(bext);
  const code = chooseBexterCode(raw.length);
  return {
    matterInit: { code, raw },
    weighted: true,
    numeric: null,
    size: weighted.clauses.reduce(
      (count, clause) =>
        count
        + clause.reduce((clauseCount, entry) => clauseCount + ("numerator" in entry ? 1 : entry.members.length), 0),
      0,
    ),
    thold: weighted.clauses,
    semantic: weighted.semantic,
  };
}

/**
 * Decode an already-qualified CESR threshold primitive back into semantic form.
 *
 * Numeric and weighted codex families intentionally converge here so reload,
 * parser hydration, and `limen` construction all share one interpretation path.
 */
function decodeThresholdMatter(
  matter: Matter,
): {
  weighted: boolean;
  numeric: bigint | null;
  size: number;
  thold: bigint | NormalizedWeightedThreshold[];
  semantic: ThresholdSith;
} {
  if (THOLDER_NUMERIC_CODES.has(matter.code)) {
    const number = new NumberPrimitive(matter);
    const value = number.num;
    return {
      weighted: false,
      numeric: value,
      size: value > MAX_SAFE_BIGINT ? Number.MAX_SAFE_INTEGER : Number(value),
      thold: value,
      semantic: value.toString(16),
    };
  }
  if (THOLDER_WEIGHTED_CODES.has(matter.code)) {
    const bexter = new Bexter(matter);
    const clauses = bexter.bext.replaceAll("s", "/").split("a").map((clause) =>
      clause.split("c").map((entry) => {
        const at = entry.indexOf("k");
        if (at < 0) {
          return entry;
        }
        const weight = entry.slice(0, at);
        const members = entry.slice(at + 1).split("v");
        return { [weight]: members };
      })
    );
    const normalized = normalizeWeightedInput(
      clauses.length === 1 ? clauses[0] : clauses,
    );
    return {
      weighted: true,
      numeric: null,
      size: normalized.clauses.reduce(
        (count, clause) =>
          count
          + clause.reduce((clauseCount, entry) => clauseCount + ("numerator" in entry ? 1 : entry.members.length), 0),
        0,
      ),
      thold: normalized.clauses,
      semantic: normalized.semantic,
    };
  }
  throw new UnknownCodeError(`Expected threshold code, got ${matter.code}`);
}

/**
 * Accept the full constructor surface supported by `Tholder`.
 *
 * Order matters here:
 * 1. explicit `Matter`/`MatterInit`
 * 2. explicit `limen`
 * 3. semantic `sith` or direct numeric/weighted input
 */
function normalizeConstructorInput(
  init: Matter | MatterInit | ThresholdInput | {
    limen?: string | Uint8Array;
    sith?: ThresholdInput;
  },
): {
  matterInit: Matter | MatterInit;
  weighted: boolean;
  numeric: bigint | null;
  size: number;
  thold: bigint | NormalizedWeightedThreshold[];
  semantic: ThresholdSith;
} {
  if (isMatterInitLike(init)) {
    const matter = init instanceof Matter ? init : new Matter(init);
    return { matterInit: init, ...decodeThresholdMatter(matter) };
  }
  if (isRecord(init) && "limen" in init && init.limen !== undefined) {
    const matterInit = typeof init.limen === "string"
      ? { qb64: init.limen }
      : { qb64b: init.limen };
    const matter = new Matter(matterInit);
    return { matterInit, ...decodeThresholdMatter(matter) };
  }
  const semantic = isRecord(init) && "sith" in init ? init.sith : init;
  return normalizeThresholdInput(semantic as ThresholdInput);
}

/**
 * Threshold expression primitive.
 *
 * KERIpy substance:
 * - `Tholder` supports both numeric thresholds and weighted threshold
 *   expressions encoded as StrB64 payloads
 * - `satisfy(indices)` is the semantic contract upper layers rely on when
 *   validating current and prior-next threshold satisfaction
 */
export class Tholder extends Matter {
  private readonly _weighted: boolean;
  private readonly _num: bigint | null;
  private readonly _size: number;
  private readonly _thold: bigint | NormalizedWeightedThreshold[];
  private readonly _sith: ThresholdSith;

  /**
   * Construct from wire material (`Matter`, `MatterInit`, `limen`) or semantic
   * threshold input (`sith`, bigint, number, hex string, weighted arrays).
   */
  constructor(
    init:
      | Matter
      | MatterInit
      | ThresholdInput
      | {
        limen?: string | Uint8Array;
        sith?: ThresholdInput;
      },
  ) {
    const normalized = normalizeConstructorInput(init);
    super(normalized.matterInit);
    if (
      !THOLDER_NUMERIC_CODES.has(this.code)
      && !THOLDER_WEIGHTED_CODES.has(this.code)
    ) {
      throw new UnknownCodeError(`Expected threshold code, got ${this.code}`);
    }
    this._weighted = normalized.weighted;
    this._num = normalized.numeric;
    this._size = normalized.size;
    this._thold = normalized.thold;
    this._sith = cloneThresholdSith(normalized.semantic);
  }

  /** True when this instance represents a weighted threshold rather than a numeric count. */
  get weighted(): boolean {
    return this._weighted;
  }

  /**
   * Number of signer slots consumed by this threshold expression.
   *
   * For nested groups this counts nested members, because those are the real
   * contiguous signer slots upper layers index into.
   */
  get size(): number {
    return this._size;
  }

  /** Internal normalized threshold semantics exposed for maintainer debugging and tests. */
  get thold(): bigint | NormalizedWeightedThreshold[] {
    return this._weighted
      ? (this._thold as NormalizedWeightedThreshold[]).map((clause) =>
        clause.map((entry) =>
          "numerator" in entry
            ? { ...entry }
            : { weight: { ...entry.weight }, members: entry.members.map((member) => ({ ...member })) }
        )
      )
      : this._thold;
  }

  /** Numeric threshold value when `weighted === false`, otherwise `null`. */
  get num(): bigint | null {
    return this._num;
  }

  /** Qualified CESR threshold representation used in event bodies and state. */
  get limen(): string {
    return this.qb64;
  }

  /** Public semantic threshold expression cloned back into SAD-facing shape. */
  get sith(): ThresholdSith {
    return cloneThresholdSith(this._sith);
  }

  /**
   * Test whether the provided signer indices satisfy this threshold.
   *
   * Maintainer model:
   * - numeric thresholds are pure cardinality checks after deduplication is
   *   handled by the caller or irrelevant to the count
   * - weighted thresholds project indices onto consecutive signer slots from
   *   left to right across clauses and nested-group members
   * - each clause must accumulate at least weight `1`
   */
  satisfy(indices: readonly number[]): boolean {
    if (!this._weighted) {
      return this._num !== null
        && this._num > 0n
        && BigInt(indices.length) >= this._num;
    }
    if (indices.length === 0) {
      return false;
    }
    const ordered = [...new Set(indices)].sort((a, b) => a - b);
    const sats = new Array<boolean>(this._size).fill(false);
    for (const index of ordered) {
      if (index >= 0 && index < sats.length) {
        sats[index] = true;
      }
    }
    let offset = 0;
    for (const clause of this._thold as NormalizedWeightedThreshold[]) {
      let clauseWeight = rationalZero();
      for (const entry of clause) {
        if ("numerator" in entry) {
          if (sats[offset]) {
            clauseWeight = addRationals(clauseWeight, entry);
          }
          offset += 1;
          continue;
        }
        let memberWeight = rationalZero();
        for (const member of entry.members) {
          if (sats[offset]) {
            memberWeight = addRationals(memberWeight, member);
          }
          offset += 1;
        }
        if (atLeastOne(memberWeight)) {
          clauseWeight = addRationals(clauseWeight, entry.weight);
        }
      }
      if (!atLeastOne(clauseWeight)) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Parse and hydrate `Tholder` from txt/qb2 bytes.
 *
 * Boundary contract: stream parsing decides whether the next token is text or
 * binary CESR, while `Tholder` owns threshold-codex validation and semantic
 * hydration after the underlying `Matter` is parsed.
 */
export function parseTholder(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Tholder {
  return new Tholder(parseMatter(input, cold));
}
