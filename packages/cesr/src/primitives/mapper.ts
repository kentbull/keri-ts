import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { b, codeB2ToB64, codeB64ToB2, t } from "../core/bytes.ts";
import { decodeKeriCbor, encodeKeriCbor } from "../core/cbor.ts";
import {
  DeserializeError,
  SemanticInterpretationError,
  SerializeError,
  ShortageError,
  SyntaxParseError,
  UnknownCodeError,
} from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import { AGGOR_LIST_CODES, AGGOR_MAP_CODES } from "../tables/counter-groups.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { Kind } from "../tables/versions.ts";
import { Bexter } from "./bexter.ts";
import {
  BEXTER_CODES,
  DECIMAL_CODES,
  ESCAPE_CODES,
  LabelDex,
  LABELER_CODES,
  MtrDex,
} from "./codex.ts";
import { Counter, parseCounter } from "./counter.ts";
import { Decimer } from "./decimer.ts";
import { Diger } from "./diger.ts";
import { parseLabeler } from "./labeler.ts";
import { Matter, parseMatter } from "./matter.ts";
import type { Primitive } from "./primitive.ts";

type ParseDomain = Extract<ColdCode, "txt" | "bny">;
type SadMap = Record<string, unknown>;

/**
 * `Mapper` is the base semantic primitive for CESR-native field maps.
 *
 * Read this file as three stacked layers:
 * 1. syntax probing/tokenization helpers (`parse*Syntax`)
 * 2. semantic value encode/decode helpers (`serializeValue`/`deserializeValue`)
 * 3. the `Mapper` class that owns end-to-end map lifecycle
 */

/**
 * Semantic projection of one field in a native map body.
 *
 * Maintainer model:
 * - `label` is the decoded field name from the map key token
 * - `primitive` is the first token that represents the field value on the wire
 * - `isCounter` distinguishes scalar primitives from grouped list/map values
 * - `children` is only populated when the field value is itself a nested map
 *
 * This type intentionally sits between two worlds:
 * syntax-oriented parser artifacts (`MapperBodySyntax`) and fully semantic
 * `mad` values on `Mapper`. It is the readable middle layer used by tests,
 * annotators, and maintainers inspecting native structure.
 */
export interface MapperField {
  label: string | null;
  primitive: Primitive;
  isCounter: boolean;
  children?: MapperField[];
}

/** Label token artifact produced during map payload syntax parsing. */
export interface MapperLabelTokenSyntax {
  kind: "label";
  primitive: Primitive;
  label: string;
  consumed: number;
}

/** Value token artifact produced during map payload syntax parsing. */
export interface MapperValueTokenSyntax {
  kind: "value";
  primitive: Primitive;
  isCounter: boolean;
  consumed: number;
  children?: MapperBodySyntax;
}

/** Ordered syntax token stream for one map payload. */
export type MapperSyntaxEntry = MapperLabelTokenSyntax | MapperValueTokenSyntax;

/** Syntax artifact for a parsed map-body/group token sequence. */
export interface MapperBodySyntax {
  /** Map/group counter code parsed at the payload head. */
  code: string;
  /** Counter count from map/group header. */
  count: number;
  /** Counter token size in qb64 bytes. */
  fullSize: number;
  /** Counter token size in qb2 bytes. */
  fullSizeB2: number;
  /** Total group span in qb64 bytes (header + payload). */
  totalSize: number;
  /** Total group span in qb2 bytes (header + payload). */
  totalSizeB2: number;
  /** Ordered token artifacts from payload tokenization. */
  entries: MapperSyntaxEntry[];
}

/**
 * Supported constructor inputs for `Mapper`.
 *
 * The important split is semantic-vs-wire:
 * - provide `mad` when you already have a semantic map and want mapper-owned
 *   serialization / optional top-level saidification
 * - provide `raw`/`qb64`/`qb64b`/`qb2` when you want mapper-owned inhale from
 *   an existing wire representation
 */
export interface MapperInit {
  mad?: SadMap;
  raw?: Uint8Array;
  qb64?: string;
  qb64b?: Uint8Array;
  qb2?: Uint8Array;
  version?: Versionage;
  strict?: boolean;
  saids?: Record<string, string>;
  saidive?: boolean;
  makify?: boolean;
  verify?: boolean;
  kind?: Kind;
}

/** Deep-clone helper so semantic constructors never mutate caller-provided SAD input. */
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneValue(v)]),
    ) as T;
  }
  return value;
}

function tokenSize(
  token: { fullSize: number; fullSizeB2: number },
  domain: ParseDomain,
): number {
  return domain === "bny" ? token.fullSizeB2 : token.fullSize;
}

function isMapGroupCode(code: string): boolean {
  return AGGOR_MAP_CODES.has(code);
}

/**
 * Normalize qb2 map bytes into the canonical qb64 text form used internally.
 *
 * This follows the broader native-serder rule that qb64 text is the maintainer
 * source of truth even when the original transport was qb2.
 */
function canonicalizeNativeRaw(
  input: Uint8Array,
  version: Versionage,
): Uint8Array {
  if (input.length > 0 && input[0] === "-".charCodeAt(0)) {
    return input;
  }
  const counter = parseCounter(input, version, "bny");
  return b(codeB2ToB64(input, counter.fullSize + counter.count * 4));
}

function parseCounterProbe(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): ReturnType<typeof parseCounter> | null {
  const attempts: Versionage[] = [
    version,
    { major: 2, minor: 0 },
    { major: 1, minor: 0 },
  ];
  for (const attempt of attempts) {
    try {
      return parseCounter(input, attempt, domain);
    } catch (error) {
      if (error instanceof ShortageError) {
        throw error;
      }
      if (
        error instanceof UnknownCodeError
        || error instanceof DeserializeError
      ) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

function parseLabelProbe(
  input: Uint8Array,
  domain: ParseDomain,
): ReturnType<typeof parseLabeler> | null {
  // A failed label parse is not automatically an error. In a native map
  // payload, it may simply mean the next token is a value rather than a key.
  try {
    return parseLabeler(input, domain);
  } catch (error) {
    if (error instanceof ShortageError) {
      throw error;
    }
    if (
      error instanceof UnknownCodeError
      || error instanceof DeserializeError
    ) {
      return null;
    }
    throw error;
  }
}

function parseMapperValueSyntax(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): MapperValueTokenSyntax {
  // Grouped list/map values always start with a counter token, so probe that
  // shape before falling back to plain Matter parsing.
  const counter = parseCounterProbe(input, version, domain);
  if (counter) {
    const dispatch = parseAttachmentDispatch(input, version, domain);
    const value: MapperValueTokenSyntax = {
      kind: "value",
      primitive: dispatch.group,
      isCounter: true,
      consumed: dispatch.consumed,
    };

    if (isMapGroupCode(dispatch.group.code)) {
      value.children = parseMapperBodySyntax(input, version, domain);
    }

    return value;
  }

  const matter = parseMatter(input, domain);
  return {
    kind: "value",
    primitive: matter,
    isCounter: false,
    consumed: tokenSize(matter, domain),
  };
}

function parseMapPayloadSyntax(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  start: number,
  end: number,
): MapperSyntaxEntry[] {
  // This phase is syntax-only: it tokenizes "label" and "value" artifacts
  // without yet enforcing that every label is paired with a value.
  const entries: MapperSyntaxEntry[] = [];
  let offset = start;

  while (offset < end) {
    const at = input.slice(offset, end);
    const maybeLabel = parseLabelProbe(at, domain);
    if (maybeLabel) {
      const consumed = tokenSize(maybeLabel, domain);
      entries.push({
        kind: "label",
        primitive: parseMatter(at, domain),
        label: maybeLabel.label,
        consumed,
      });
      offset += consumed;
      continue;
    }

    const value = parseMapperValueSyntax(at, version, domain);
    entries.push(value);
    offset += value.consumed;
  }

  if (offset !== end) {
    throw new ShortageError(end, offset);
  }
  return entries;
}

/** Convert syntax entries into labeled semantic map fields. */
export function interpretMapperBodySyntax(
  syntax: MapperBodySyntax,
): MapperField[] {
  const fields: MapperField[] = [];
  let pendingLabel: string | null = null;

  for (const entry of syntax.entries) {
    if (entry.kind === "label") {
      pendingLabel = entry.label;
      continue;
    }

    fields.push({
      label: pendingLabel,
      primitive: entry.primitive,
      isCounter: entry.isCounter,
      children: entry.children
        ? interpretMapperBodySyntax(entry.children)
        : undefined,
    });
    pendingLabel = null;
  }

  if (pendingLabel !== null) {
    throw new SemanticInterpretationError("Dangling map label without value");
  }

  return fields;
}

/**
 * Parse map-style native bodies/counters into syntax artifacts.
 * Parsing is strict: payload boundaries must be exact.
 */
export function parseMapperBodySyntax(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): MapperBodySyntax {
  try {
    const counter = parseCounter(input, version, domain);
    if (!isMapGroupCode(counter.code)) {
      throw new UnknownCodeError(
        `Expected map-body/group counter, got ${counter.code}`,
      );
    }

    const unit = domain === "bny" ? 3 : 4;
    const header = tokenSize(counter, domain);
    const payload = counter.count * unit;
    const total = header + payload;
    if (input.length < total) {
      throw new ShortageError(total, input.length);
    }

    const entries = parseMapPayloadSyntax(
      input,
      version,
      domain,
      header,
      total,
    );

    return {
      code: counter.code,
      count: counter.count,
      fullSize: counter.fullSize,
      fullSizeB2: counter.fullSizeB2,
      totalSize: domain === "txt" ? total : Math.ceil(total * 4 / 3),
      totalSizeB2: domain === "bny" ? total : Math.ceil(total * 3 / 4),
      entries,
    };
  } catch (error) {
    if (
      error instanceof ShortageError
      || error instanceof UnknownCodeError
      || error instanceof DeserializeError
    ) {
      throw new SyntaxParseError(
        `Map-body syntax parse failed: ${error.message}`,
        error,
      );
    }
    throw error;
  }
}

function encodeTag(text: string): string {
  const tags = new Map<number, string>([
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
  ]);
  const code = tags.get(text.length);
  if (!code) {
    throw new SerializeError(`Unsupported mapper tag length=${text.length}`);
  }
  const pad = code === LabelDex.Tag1 || code === LabelDex.Tag5 || code === LabelDex.Tag9 ? "_" : "";
  return `${code}${pad}${text}`;
}

/** Encode base64-safe text through the compact StrB64/Bexter families. */
function encodeBext(text: string): string {
  const rem = text.length % 4;
  const code = rem === 0 ? LabelDex.StrB64_L0 : rem === 1 ? LabelDex.StrB64_L1 : LabelDex.StrB64_L2;
  const raw = Bexter.rawify(text);
  return new Matter({ code, raw }).qb64;
}

/** Encode arbitrary UTF-8 text through CESR bytes-label families. */
function encodeBytes(text: string): string {
  const raw = b(text);
  const rem = raw.length % 3;
  const code = rem === 0 ? LabelDex.Bytes_L0 : rem === 1 ? LabelDex.Bytes_L1 : LabelDex.Bytes_L2;
  return new Matter({ code, raw }).qb64;
}

/**
 * Choose the narrowest native text encoding that can round-trip `text`.
 *
 * Read this as the mapper-side "smallest truthful token" rule:
 * tag first for tiny safe labels/text, then StrB64, then raw bytes.
 */
function encodeText(text: string): string {
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

function serializeValue(
  value: unknown,
  strict: boolean,
): string {
  // This is the recursive mapper exhale ladder. Ordering matters because a
  // string might be either already-qualified CESR text or ordinary text that
  // needs label-style encoding.
  if (value === null) {
    return new Matter({ code: MtrDex.Null, raw: new Uint8Array() }).qb64;
  }
  if (typeof value === "boolean") {
    return new Matter({ code: value ? MtrDex.Yes : MtrDex.No, raw: new Uint8Array() }).qb64;
  }
  if (typeof value === "number") {
    return new Decimer({ decimal: value }).qb64;
  }
  if (typeof value === "bigint") {
    return new Decimer({ dns: value.toString() }).qb64;
  }
  if (typeof value === "string") {
    try {
      const primitive = new Matter({ qb64: value });
      if (primitive.qb64.length === value.length) {
        const escape = ESCAPE_CODES.has(primitive.code)
          ? new Matter({ code: MtrDex.Escape, raw: new Uint8Array() }).qb64
          : "";
        return `${escape}${primitive.qb64}`;
      }
    } catch {
      // fall through to text encoding
    }
    return encodeText(value);
  }
  if (value instanceof Uint8Array) {
    return new Matter({
      code: value.length % 3 === 0
        ? LabelDex.Bytes_L0
        : value.length % 3 === 1
        ? LabelDex.Bytes_L1
        : LabelDex.Bytes_L2,
      raw: value,
    }).qb64;
  }
  if (Array.isArray(value)) {
    const payload = value.map((entry) => serializeValue(entry, strict)).join("");
    const code = payload.length / 4 < 64 ** 2
      ? CtrDexV2.GenericListGroup
      : CtrDexV2.BigGenericListGroup;
    return `${new Counter({ code, count: payload.length / 4 }).qb64}${payload}`;
  }
  if (value && typeof value === "object") {
    const payload = Object.entries(value as SadMap).map(([label, entry]) =>
      `${strict ? encodeText(label) : encodeText(label)}${serializeValue(entry, strict)}`
    ).join("");
    const code = payload.length / 4 < 64 ** 2
      ? CtrDexV2.GenericMapGroup
      : CtrDexV2.BigGenericMapGroup;
    return `${new Counter({ code, count: payload.length / 4 }).qb64}${payload}`;
  }
  throw new SerializeError(`Nonserializable mapper value=${String(value)}`);
}

function deserializeValue(
  raw: Uint8Array,
  strict: boolean,
): { value: unknown; nextOffset: number } {
  // This is the inverse of `serializeValue()`: grouped containers first, then
  // leaf primitives. `nextOffset` tells the caller exactly how much wire space
  // was consumed by this one semantic value.
  const counter = parseCounterProbe(raw, { major: 2, minor: 0 }, "txt");
  if (counter) {
    if (AGGOR_LIST_CODES.has(counter.code)) {
      const total = counter.fullSize + counter.count * 4;
      const payload = raw.slice(counter.fullSize, total);
      const list: unknown[] = [];
      let offset = 0;
      while (offset < payload.length) {
        const parsed = deserializeValue(payload.slice(offset), strict);
        list.push(parsed.value);
        offset += parsed.nextOffset;
      }
      return { value: list, nextOffset: total };
    }

    if (AGGOR_MAP_CODES.has(counter.code)) {
      const total = counter.fullSize + counter.count * 4;
      const payload = raw.slice(counter.fullSize, total);
      const map: SadMap = {};
      let offset = 0;
      while (offset < payload.length) {
        const labeler = parseLabeler(payload.slice(offset), "txt");
        const label = strict ? labeler.label : labeler.text;
        offset += labeler.fullSize;
        const parsed = deserializeValue(payload.slice(offset), strict);
        map[label] = parsed.value;
        offset += parsed.nextOffset;
      }
      return { value: map, nextOffset: total };
    }
  }

  const matter = new Matter({ qb64b: raw });
  let offset = matter.fullSize;
  if (matter.code === MtrDex.Escape) {
    const escaped = new Matter({ qb64b: raw.slice(offset) });
    return { value: escaped.qb64, nextOffset: offset + escaped.fullSize };
  }
  if (matter.code === MtrDex.Null) {
    return { value: null, nextOffset: offset };
  }
  if (matter.code === MtrDex.Yes) {
    return { value: true, nextOffset: offset };
  }
  if (matter.code === MtrDex.No) {
    return { value: false, nextOffset: offset };
  }
  if (DECIMAL_CODES.has(matter.code)) {
    return { value: new Decimer(matter).decimal, nextOffset: offset };
  }
  if (LABELER_CODES.has(matter.code) || BEXTER_CODES.has(matter.code)) {
    return { value: parseLabeler(b(matter.qb64), "txt").text, nextOffset: offset };
  }
  return { value: matter.qb64, nextOffset: offset };
}

function buildFieldProjection(
  value: SadMap,
  strict: boolean,
): MapperField[] {
  // `fields` is rebuilt from semantic data so the projection stays coherent
  // even when the mapper originated from `Mapper.fromSad(...)` rather than a
  // syntax-parse path.
  return Object.entries(value).map(([label, entry]) => {
    const serialized = serializeValue(entry, strict);
    const primitive = serialized.startsWith("-")
      ? parseCounter(b(serialized), { major: 2, minor: 0 }, "txt")
      : parseMatter(b(serialized), "txt");
    const children = entry && typeof entry === "object" && !Array.isArray(entry)
      ? buildFieldProjection(entry as SadMap, strict)
      : undefined;
    return {
      label,
      primitive,
      isCounter: AGGOR_LIST_CODES.has(primitive.code) || AGGOR_MAP_CODES.has(primitive.code),
      children,
    };
  });
}

function verifyMapRoundTrip(
  mapper: Mapper,
): void {
  // Verification is explicit on purpose: rebuild a mapper from the semantic
  // view and require byte-for-byte raw equality. If this fails, our semantic
  // projection lost information or our serializer is dishonest.
  const actual = mapper.kind === "CESR"
    ? Mapper.fromSad(mapper.mad, {
      strict: mapper.strict,
      saidive: mapper.saidive,
      saids: mapper.saids,
      kind: mapper.kind,
      makify: false,
      verify: false,
    })
    : Mapper.fromSad(mapper.mad, {
      strict: mapper.strict,
      saidive: mapper.saidive,
      saids: mapper.saids,
      kind: mapper.kind,
      makify: false,
      verify: false,
    });

  if (t(actual.raw) !== t(mapper.raw)) {
    throw new DeserializeError("Invalid mapper round trip against raw.");
  }
}

/**
 * Semantic CESR-native map primitive.
 *
 * KERIpy substance: `Mapper` is the reusable native field-map engine beneath
 * compactable ACDC sections. It owns both the semantic map view (`mad`) and the
 * exact enclosed native group serialization (`raw`, `qb64`, `qb2`).
 *
 * Cohesive mental model:
 * 1. `parseMapperBodySyntax()` tokenizes raw native bytes into syntax artifacts.
 * 2. `interpretMapperBodySyntax()` pairs those artifacts into readable fields.
 * 3. `Mapper` owns the full semantic lifecycle: build from `mad`, or inhale
 *    from raw, then expose both semantic (`mad`) and wire (`raw`, `qb64`,
 *    `qb2`) views.
 *
 * Put differently:
 * syntax helpers are for inspection and parser diagnostics;
 * `Mapper` is for truth.
 */
export class Mapper {
  code: string;
  count: number;
  fullSize: number;
  fullSizeB2: number;
  totalSize: number;
  totalSizeB2: number;
  fields: MapperField[];
  raw: Uint8Array;
  strict: boolean;
  saids: Record<string, string>;
  saidive: boolean;
  kind: Kind;
  _mad: SadMap;

  /**
   * Create one semantic mapper from either a field map (`mad`) or raw bytes.
   *
   * Constructor modes:
   * - semantic mode: caller provides `mad`, optional `makify`, optional
   *   `saidive`, and the constructor serializes deterministically
   * - native inhale mode: caller provides `raw`/`qb64`/`qb64b`/`qb2` with
   *   `kind="CESR"` and the constructor decodes grouped native content
   * - non-native inhale mode: caller provides raw JSON/CBOR/MGPK with
   *   `kind!="CESR"` and the constructor decodes via the corresponding codec
   */
  constructor(init: MapperInit = {}) {
    this.strict = init.strict ?? true;
    this.saids = { ...(init.saids ?? { d: "E" }) };
    this.saidive = init.saidive ?? false;
    this.kind = init.kind ?? "CESR";

    if (init.mad || (!init.raw && !init.qb64 && !init.qb64b && !init.qb2)) {
      const mad = cloneValue(init.mad ?? {});
      if (init.makify && this.saidive) {
        // Mapper saidification is intentionally top-level only. Recursive leaf
        // discovery belongs to `Compactor`; `Mapper` just makes one map
        // self-addressing when asked.
        const dummy = cloneValue(mad);
        for (const [label, code] of Object.entries(this.saids)) {
          if (!(label in dummy)) continue;
          try {
            const valueCode = new Matter({ qb64: String(dummy[label]) }).code;
            if (valueCode) {
              this.saids[label] = valueCode;
            }
          } catch {
            // keep configured default
          }
          const sizage = MATTER_SIZES.get(this.saids[label]);
          if (!sizage?.fs) {
            throw new SerializeError(`Unsupported mapper SAID code=${this.saids[label]}`);
          }
          dummy[label] = "#".repeat(sizage.fs);
        }
        const dummiedRaw = this.kind === "CESR"
          ? Mapper.serializeCesrMap(dummy, this.strict, true, this.saids)
          : Mapper.serializeNonNativeMap(dummy, this.kind as Exclude<Kind, "CESR">);
        for (const [label, code] of Object.entries(this.saids)) {
          if (!(label in mad)) continue;
          mad[label] = new Matter({ code, raw: Diger.digest(dummiedRaw, code) }).qb64;
        }
      }

      if (this.kind === "CESR") {
        // In semantic->native mode we already trust `mad`, so we derive the
        // readable `fields` projection directly from semantic data instead of
        // re-parsing the raw bytes we just emitted.
        this.raw = Mapper.serializeCesrMap(mad, this.strict);
        const counter = parseCounter(this.raw, init.version ?? { major: 2, minor: 0 }, "txt");
        this.code = counter.code;
        this.count = counter.count;
        this.fullSize = counter.fullSize;
        this.fullSizeB2 = counter.fullSizeB2;
        this.totalSize = counter.fullSize + counter.count * 4;
        this.totalSizeB2 = Math.ceil(this.totalSize * 3 / 4);
        this.fields = buildFieldProjection(mad, this.strict);
      } else {
        this.raw = Mapper.serializeNonNativeMap(mad, this.kind);
        this.code = CtrDexV2.GenericMapGroup;
        this.count = 0;
        this.fullSize = 0;
        this.fullSizeB2 = 0;
        this.totalSize = this.raw.length;
        this.totalSizeB2 = this.raw.length;
        this.fields = buildFieldProjection(mad, this.strict);
      }
      this._mad = mad;
      if (init.verify ?? true) {
        verifyMapRoundTrip(this);
      }
      return;
    }

    if (this.kind !== "CESR") {
      // Non-native support matters because compact/disclose logic for ACDC has
      // to reason about JSON/CBOR/MGPK section forms too, not just native wire
      // forms.
      this.raw = init.raw ?? init.qb64b ?? b(init.qb64 ?? "");
      this._mad = Mapper.deserializeNonNativeMap(this.raw, this.kind);
      this.code = CtrDexV2.GenericMapGroup;
      this.count = 0;
      this.fullSize = 0;
      this.fullSizeB2 = 0;
      this.totalSize = this.raw.length;
      this.totalSizeB2 = this.raw.length;
      this.fields = buildFieldProjection(this._mad, this.strict);
      if (init.verify ?? true) {
        verifyMapRoundTrip(this);
      }
      return;
    }

    const version = init.version ?? { major: 2, minor: 0 };
    const raw = init.qb2
      ? canonicalizeNativeRaw(init.qb2, version)
      : init.qb64
      ? b(init.qb64)
      : init.qb64b
      ? init.qb64b
      : init.raw!;
    // In native inhale mode we *do* walk the wire payload because the whole
    // point is to reconstruct semantic values from the compact map encoding.
    const counter = parseCounter(raw, version, "txt");
    if (!isMapGroupCode(counter.code)) {
      throw new UnknownCodeError(`Expected map-body/group counter, got ${counter.code}`);
    }
    const totalSize = counter.fullSize + counter.count * 4;
    const payload = raw.slice(counter.fullSize, totalSize);
    const mad: SadMap = {};
    let offset = 0;
    while (offset < payload.length) {
      const labeler = parseLabeler(payload.slice(offset), "txt");
      const label = this.strict ? labeler.label : labeler.text;
      offset += labeler.fullSize;
      const parsed = deserializeValue(payload.slice(offset), this.strict);
      mad[label] = parsed.value;
      offset += parsed.nextOffset;
    }

    this.raw = raw.slice(0, totalSize);
    this.code = counter.code;
    this.count = counter.count;
    this.fullSize = counter.fullSize;
    this.fullSizeB2 = counter.fullSizeB2;
    this.totalSize = totalSize;
    this.totalSizeB2 = Math.ceil(totalSize * 3 / 4);
    this.fields = buildFieldProjection(mad, this.strict);
    this._mad = mad;
    if (init.verify ?? true) {
      verifyMapRoundTrip(this);
    }
  }

  static fromSad(
    mad: SadMap,
    options: Omit<MapperInit, "mad"> = {},
  ): Mapper {
    return new Mapper({ ...options, mad });
  }

  /**
   * Serialize one semantic map into an enclosed CESR native map-group.
   *
   * The result includes the leading group counter. Nested maps/lists are
   * recursively enclosed in their own grouped payloads.
   */
  static serializeCesrMap(
    mad: SadMap,
    strict = true,
    dummy = false,
    saids: Record<string, string> = {},
  ): Uint8Array {
    const payload = Object.entries(mad).map(([label, value]) => {
      const rendered = dummy && label in saids
        ? (() => {
          const sizage = MATTER_SIZES.get(saids[label]);
          if (!sizage?.fs) {
            throw new SerializeError(`Unsupported mapper SAID code=${saids[label]}`);
          }
          return "#".repeat(sizage.fs);
        })()
        : serializeValue(value, strict);
      return `${encodeText(label)}${rendered}`;
    }).join("");
    const code = payload.length / 4 < 64 ** 2
      ? CtrDexV2.GenericMapGroup
      : CtrDexV2.BigGenericMapGroup;
    return b(`${new Counter({ code, count: payload.length / 4 }).qb64}${payload}`);
  }

  static serializeNonNativeMap(
    mad: SadMap,
    kind: Exclude<Kind, "CESR">,
  ): Uint8Array {
    if (kind === "JSON") {
      return b(JSON.stringify(mad));
    }
    if (kind === "CBOR") {
      return encodeKeriCbor(mad);
    }
    if (kind === "MGPK") {
      return encodeMsgpack(mad);
    }
    throw new SerializeError(`Unsupported mapper serialization kind=${kind}`);
  }

  static deserializeNonNativeMap(
    raw: Uint8Array,
    kind: Exclude<Kind, "CESR">,
  ): SadMap {
    if (kind === "JSON") {
      return JSON.parse(t(raw)) as SadMap;
    }
    if (kind === "CBOR") {
      return decodeKeriCbor(raw) as SadMap;
    }
    if (kind === "MGPK") {
      return decodeMsgpack(raw) as SadMap;
    }
    throw new DeserializeError(`Unsupported mapper deserialization kind=${kind}`);
  }

  get mad(): SadMap {
    // Clone on read so callers can inspect or tweak the returned object
    // without mutating mapper internals behind the class's back.
    return cloneValue(this._mad);
  }

  get qb64b(): Uint8Array {
    return this.raw.slice();
  }

  get qb64(): string {
    return t(this.raw);
  }

  get qb2(): Uint8Array {
    if (this.kind !== "CESR") {
      throw new SerializeError(`Binary domain undefined for non-native kind=${this.kind}`);
    }
    return codeB64ToB2(this.qb64);
  }

  get said(): string | null {
    const label = Object.keys(this.saids)[0];
    const value = this._mad[label];
    return typeof value === "string" ? value : null;
  }

  get size(): number {
    return this.raw.length;
  }
}

/**
 * Parse map-style native bodies/counters into a semantic `Mapper`.
 *
 * Compatibility wrapper: existing parser-oriented tests can keep calling this
 * helper, while newer code can instantiate `Mapper` directly from `mad` or
 * raw. This wrapper preserves the older parser-friendly feel while the class
 * itself is the new semantic authority.
 */
export function parseMapperBody(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): Mapper {
  let syntax: MapperBodySyntax;
  try {
    syntax = parseMapperBodySyntax(input, version, domain);
  } catch (error) {
    if (error instanceof SyntaxParseError && error.cause) {
      throw error.cause;
    }
    throw error;
  }

  try {
    interpretMapperBodySyntax(syntax);
  } catch (error) {
    if (error instanceof SemanticInterpretationError) {
      throw new UnknownCodeError(error.message);
    }
    throw error;
  }

  const mapper = new Mapper({
    mad: {},
    strict: true,
    kind: "CESR",
    verify: false,
  });
  mapper.code = syntax.code;
  mapper.count = syntax.count;
  mapper.fullSize = syntax.fullSize;
  mapper.fullSizeB2 = syntax.fullSizeB2;
  mapper.totalSize = syntax.totalSize;
  mapper.totalSizeB2 = syntax.totalSizeB2;
  mapper.fields = interpretMapperBodySyntax(syntax);
  mapper.raw = domain === "txt"
    ? input.slice(0, syntax.totalSize)
    : canonicalizeNativeRaw(input, version).slice(0, syntax.totalSize);
  mapper._mad = {};
  return mapper;
}

/** True for counter codes that represent map/list-native aggregate primitives. */
export function isMapperCounterCode(code: string): boolean {
  return AGGOR_MAP_CODES.has(code) || AGGOR_LIST_CODES.has(code);
}
