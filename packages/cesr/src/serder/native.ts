import { b, codeB2ToB64, intToB64, t } from "../core/bytes.ts";
import { DeserializeError, SerializeError } from "../core/errors.ts";
import { type Smellage } from "../core/types.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";
import { Aggor, isAggorListCode, isAggorMapCode, parseAggor } from "../primitives/aggor.ts";
import { Bexter } from "../primitives/bexter.ts";
import {
  BEXTER_CODES,
  DATER_CODES,
  DIGEST_CODES,
  LabelDex,
  MtrDex,
  NON_DIGEST_PREFIX_CODES,
  NONCE_CODES,
  NUMBER_CODES,
  PREFIX_CODES,
  TAG_CODES,
} from "../primitives/codex.ts";
import { Counter, parseCounter } from "../primitives/counter.ts";
import { Dater } from "../primitives/dater.ts";
import { parseIlker } from "../primitives/ilker.ts";
import { Labeler, parseLabeler } from "../primitives/labeler.ts";
import { Mapper, type MapperMap, type MapperValue } from "../primitives/mapper.ts";
import { parseMatter } from "../primitives/matter.ts";
import { parseNoncer } from "../primitives/noncer.ts";
import { NumberPrimitive } from "../primitives/number.ts";
import { makePather, parsePather } from "../primitives/pather.ts";
import type { GroupEntry } from "../primitives/primitive.ts";
import { isCounterGroupLike, isPrimitiveTuple } from "../primitives/primitive.ts";
import { Structor } from "../primitives/structor.ts";
import { Texter } from "../primitives/texter.ts";
import { Tholder } from "../primitives/tholder.ts";
import { parseTraitor } from "../primitives/traitor.ts";
import { parseVerser } from "../primitives/verser.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds, type Protocol, Protocols, Vrsn_2_0 } from "../tables/versions.ts";
import { versify } from "./smell.ts";

type SadMap = Record<string, MapperValue>;
type ParsedNativeField<T = unknown> = { value: T; nextOffset: number };
type NativeBodyShape = "fixed" | "map";

/**
 * CESR-native serder helper layer.
 *
 * This module exists to keep native inhale/exhale logic in one shared place so
 * `Serder`, `Serdery`, and parser hydration all agree on the same rules. The
 * current implementation is intentionally a staged parity port: it handles the
 * real KERI native flows needed by runtime integration first, while broader
 * KERI/ACDC native parity and compactification continue to expand here.
 *
 * Mental model:
 * - non-native KERI/ACDC bodies are self-describing field maps (`JSON`,
 *   `CBOR`, `MGPK`) that `smell()` can recognize directly from the embedded
 *   version string
 * - CESR-native bodies are instead "counter + compact CESR fields", so the
 *   parser must first identify the body-group frame before the serder layer can
 *   reconstruct a SAD
 * - this module bridges that gap by converting native bodies into the same
 *   semantic `ked` shape that non-native serders use
 *
 * Text-domain native example, segmented for humans:
 *
 * ```text
 * -FA5 | 0OKERICAACA | Xicp | EFaYE2... | DNG2ar... | MAAA | MAAB | -JAL...
 * ^      ^             ^      ^           ^           ^      ^      ^
 * body   verser        ilk    said `d`    prefix `i`  `s`    `kt`   list/group payloads
 * ctr
 * ```
 *
 * The same message may also arrive in qb2/binary form. In that case the bytes
 * are not human-readable, so this module canonicalizes them back to the qb64
 * text form above before decoding semantics. That is why many helpers talk
 * about "text-domain canonical form" even when their input may have started as
 * raw qb2 bytes.
 */

const TAG_CODES_BY_LENGTH = new Map<number, string>([
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

const NUMBER_CAPACITIES = [
  { code: "M", rawSize: 2 },
  { code: "0H", rawSize: 4 },
  { code: "R", rawSize: 5 },
  { code: "N", rawSize: 8 },
  { code: "S", rawSize: 11 },
  { code: "T", rawSize: 14 },
  { code: "0A", rawSize: 16 },
  { code: "U", rawSize: 17 },
];

/** Native text bodies always begin with a counter hard code `-`. */
function isTextDomain(raw: Uint8Array): boolean {
  return raw.length > 0 && raw[0] === "-".charCodeAt(0);
}

/**
 * Resolve the canonical qb64 span of one native body-group token.
 *
 * Even when the input is qb2, the body counter still declares the payload in
 * qb64 quadlets, so this helper always returns the text-domain width.
 */
function nativeQb64Size(raw: Uint8Array, version: Versionage): number {
  const cold = isTextDomain(raw) ? "txt" : "bny";
  const counter = parseCounter(raw, version, cold);
  return counter.fullSize + counter.count * 4;
}

/**
 * Convert native input into the canonical qb64 text-domain form used by the
 * rest of this module.
 *
 * If `raw` is already text-domain, it is returned unchanged. If `raw` is qb2,
 * the function converts exactly one native body-group span back into its qb64
 * ASCII form.
 *
 * Example:
 *
 * ```ts
 * const txt = canonicalizeCesrNativeRaw(qb2Bytes, { major: 2, minor: 0 });
 * // new TextDecoder().decode(txt) starts with "-F..." or "-G..."
 * ```
 */
export function canonicalizeCesrNativeRaw(
  raw: Uint8Array,
  version: Versionage,
): Uint8Array {
  if (isTextDomain(raw)) {
    return raw;
  }
  return b(codeB2ToB64(raw, nativeQb64Size(raw, version)));
}

/** Emit the narrowest fixed-width tag family that can carry `text`. */
function encodeTag(text: string): string {
  const code = TAG_CODES_BY_LENGTH.get(text.length);
  if (!code) {
    throw new SerializeError(`Unsupported tag length=${text.length}`);
  }
  const pad = code === LabelDex.Tag1 || code === LabelDex.Tag5 || code === LabelDex.Tag9
    ? "_"
    : "";
  return `${code}${pad}${text}`;
}

/** Emit base64-safe text through the StrB64/Bexter family. */
function encodeBext(text: string): string {
  const rem = text.length % 4;
  const code = rem === 0
    ? LabelDex.StrB64_L0
    : rem === 1
    ? LabelDex.StrB64_L1
    : LabelDex.StrB64_L2;
  return new Bexter({ code, raw: Bexter.rawify(text) }).qb64;
}

/** Emit arbitrary UTF-8 text through the bytes label family. */
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

/**
 * Choose the most compact supported native label/text encoding for `text`.
 *
 * Decision order mirrors the intended CESR-native compactness ladder:
 * tag first, then StrB64, then generic bytes.
 */
function encodeLabel(text: string): string {
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

/** Encode protocol + version metadata into one native verser token. */
function encodeVerser(
  proto: Protocol,
  pvrsn: Versionage,
  gvrsn: Versionage | null,
): string {
  const payload = `${proto}${intToB64(pvrsn.major, 1)}${intToB64(pvrsn.minor, 2)}${
    gvrsn ? `${intToB64(gvrsn.major, 1)}${intToB64(gvrsn.minor, 2)}` : ""
  }`;
  return encodeTag(payload);
}

/** Big-endian integer helper used by native numeric families. */
function bigintToBytes(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new SerializeError(`Negative CESR number=${value}`);
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

/**
 * Emit one CESR numeric primitive from a semantic integer/hex-string value.
 *
 * Maintainer rule: when native number-family parity broadens, extend
 * `NUMBER_CAPACITIES` instead of growing special cases in callers.
 */
function encodeNumber(value: string | number | bigint): string {
  const bigint = typeof value === "bigint"
    ? value
    : typeof value === "number"
    ? BigInt(value)
    : BigInt(`0x${value || "0"}`);
  const raw = bigintToBytes(bigint);
  const entry = NUMBER_CAPACITIES.find(({ rawSize }) => raw.length <= rawSize);
  if (!entry) {
    throw new SerializeError(`Unsupported number width=${raw.length}`);
  }
  const padded = new Uint8Array(entry.rawSize);
  padded.set(raw, entry.rawSize - raw.length);
  return new NumberPrimitive({ code: entry.code, raw: padded }).qb64;
}

/** KERI thresholds are either numeric hex strings or weighted Bexter expressions. */
function encodeThreshold(value: string | number): string {
  const text = String(value);
  if (/^[0-9a-f]+$/i.test(text)) {
    return encodeNumber(text);
  }
  if (/^[A-Za-z0-9_-]+$/.test(text)) {
    return encodeBext(text);
  }
  throw new SerializeError(`Unsupported CESR threshold=${text}`);
}

/** CESR-native datetimes substitute base64-safe glyphs for RFC3339 punctuation. */
function encodeDate(iso8601: string): string {
  return `${MtrDex.DateTime}${iso8601.replaceAll(":", "c").replaceAll(".", "d").replaceAll("+", "p")}`;
}

/**
 * Encode semantic route/path strings using the same Pather rules as KERIpy.
 *
 * Important nuance:
 * KERI route fields are not generic labels. Even when the semantic value is a
 * simple string like `ksn`, KERIpy encodes it through `Pather(..., relative=True,
 * pathive=False)` so the result may be a compact StrB64 path token such as
 * `4AABAksn` instead of a labeler/text token.
 */
function encodePath(path: string): string {
  return makePather(path, { relative: true, pathive: false }).qb64;
}

/** Enclose already-encoded members inside one native generic-list group. */
function encodeList(entries: string[], gvrsn: Versionage | null): string {
  const frame = entries.join("");
  const count = frame.length / 4;
  const code = count < 64 ** 2
    ? CtrDexV2.GenericListGroup
    : CtrDexV2.BigGenericListGroup;
  return `${new Counter({ code, count, version: gvrsn ?? Vrsn_2_0 }).qb64}${frame}`;
}

/**
 * Enclose one semantic field map inside either a top-level body-group or a
 * nested generic map-group.
 */
function encodeMap(
  map: SadMap,
  gvrsn: Versionage | null,
  topLevel = false,
): string {
  let frame = "";
  for (const [label, value] of Object.entries(map)) {
    frame += encodeLabel(label);
    frame += encodeValue(value, gvrsn, label);
  }
  const count = frame.length / 4;
  const code = topLevel
    ? count < 64 ** 2 ? CtrDexV2.MapBodyGroup : CtrDexV2.BigMapBodyGroup
    : count < 64 ** 2
    ? CtrDexV2.GenericMapGroup
    : CtrDexV2.BigGenericMapGroup;
  return `${new Counter({ code, count, version: gvrsn ?? Vrsn_2_0 }).qb64}${frame}`;
}

/**
 * Best-effort native emit for one semantic field value.
 *
 * Decision order matters:
 * 1. preserve already-qualified CESR primitives when present
 * 2. apply field-specific semantic encoders
 * 3. fall back to generic scalar/list/map encoders
 */
function encodeValue(
  value: unknown,
  gvrsn: Versionage | null,
  label?: string,
): string {
  if (typeof value === "string") {
    if (value.length === 0 && label && ["u", "rd", "td"].includes(label)) {
      return LabelDex.Empty;
    }
    try {
      const primitive = parseMatter(b(value), "txt");
      if (
        DIGEST_CODES.has(primitive.code)
        || PREFIX_CODES.has(primitive.code)
        || NON_DIGEST_PREFIX_CODES.has(primitive.code)
        || NONCE_CODES.has(primitive.code)
        || BEXTER_CODES.has(primitive.code)
        || TAG_CODES.has(primitive.code)
        || DATER_CODES.has(primitive.code)
      ) {
        return primitive.qb64;
      }
    } catch {
      // fall through to semantic encoding
    }

    if (label === "dt") {
      return encodeDate(value);
    }
    if (label === "r" || label === "rr") {
      return encodePath(value);
    }
    if (label === "ts") {
      return encodeLabel(value);
    }
    if (/^[A-Za-z0-9_-]{1,11}$/.test(value)) {
      return encodeTag(value);
    }
    if (/^[A-Za-z0-9_-]+$/.test(value)) {
      return encodeBext(value);
    }
    return encodeBytes(value);
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return encodeNumber(value);
  }

  if (Array.isArray(value)) {
    const entries = value.map((entry) => encodeValue(entry, gvrsn));
    return encodeList(entries, gvrsn);
  }

  if (value && typeof value === "object") {
    return encodeMap(value as SadMap, gvrsn);
  }

  throw new SerializeError(`Unsupported native value=${String(value)}`);
}

/**
 * Decode one parser graph entry back into a semantic SAD value.
 *
 * This stays parser-graph aware on purpose so native deserialization reuses the
 * existing group dispatch machinery instead of maintaining a separate
 * attachment/group decoder.
 */
function decodeEntry(entry: GroupEntry, gvrsn: Versionage): MapperValue {
  if (isPrimitiveTuple(entry)) {
    return entry.map((item) => decodeEntry(item, gvrsn));
  }
  if (isCounterGroupLike(entry)) {
    if (isAggorListCode(entry.code)) {
      return entry.items.map((item) => decodeEntry(item, gvrsn));
    }
    if (isAggorMapCode(entry.code)) {
      const aggor = parseAggor(
        b(Structor.fromGroup(entry).qb64g),
        gvrsn,
        "txt",
      );
      const fields = aggor.mapFields ?? [];
      return Object.fromEntries(
        fields.map((
          field,
        ) => [field.label ?? "", decodeMapperField(field, gvrsn)]),
      );
    }
    return Structor.fromGroup(entry).qb64g;
  }

  const matter = entry;
  if (
    DIGEST_CODES.has(matter.code)
    || PREFIX_CODES.has(matter.code)
    || NON_DIGEST_PREFIX_CODES.has(matter.code)
  ) {
    return matter.qb64;
  }
  if (NONCE_CODES.has(matter.code)) {
    return parseNoncer(b(matter.qb64), "txt").nonce;
  }
  if (NUMBER_CODES.has(matter.code)) {
    return new NumberPrimitive(matter).numh;
  }
  if (DATER_CODES.has(matter.code)) {
    return new Dater(matter).iso8601;
  }
  if (matter.code === MtrDex.DateTime) {
    return new Dater(matter).iso8601;
  }
  if (TAG_CODES.has(matter.code)) {
    if (matter.code === MtrDex.Tag3) {
      return parseIlker(b(matter.qb64), "txt").ilk;
    }
    return new Labeler(matter).text;
  }
  if (BEXTER_CODES.has(matter.code)) {
    return parsePather(b(matter.qb64), "txt").path;
  }
  return matter.qb64;
}

/** Recursively convert parsed mapper fields into nested JS map/list/scalar values. */
function decodeMapperField(
  field: {
    label: string | null;
    primitive: GroupEntry;
    children?: readonly {
      label: string | null;
      primitive: GroupEntry;
      children?: readonly unknown[];
    }[];
  },
  gvrsn: Versionage,
): MapperValue {
  if (field.children) {
    return Object.fromEntries(
      field.children.map((
        child,
      ) => [child.label ?? "", decodeMapperField(child as never, gvrsn)]),
    );
  }
  return decodeEntry(field.primitive, gvrsn);
}

/**
 * Decode one native generic-list group.
 *
 * Items may be plain primitives or nested counted groups, so we probe group
 * dispatch first and fall back to `Matter` only when no valid group starts at
 * the current offset.
 */
function decodeList(raw: Uint8Array, gvrsn: Versionage): MapperValue[] {
  const counter = parseCounter(raw, gvrsn, "txt");
  if (
    counter.code !== CtrDexV2.GenericListGroup
    && counter.code !== CtrDexV2.BigGenericListGroup
  ) {
    throw new DeserializeError(`Expected list group, got ${counter.code}`);
  }
  const payload = t(
    raw.slice(counter.fullSize, counter.fullSize + counter.count * 4),
  );
  const out: MapperValue[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const chunk = b(payload.slice(offset));
    try {
      const parsed = parseAttachmentDispatch(chunk, gvrsn, "txt");
      out.push(decodeEntry(parsed.group, gvrsn));
      offset += parsed.consumed;
      continue;
    } catch {
      const matter = parseMatter(chunk, "txt");
      out.push(decodeEntry(matter, gvrsn));
      offset += matter.fullSize;
    }
  }
  return out;
}

/**
 * Decode one native field that is already carried as a complete qb64 CESR
 * primitive.
 *
 * Typical KERI fixed-body examples:
 * - `d`: top-level SAID such as `EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN`
 * - `i`: identifier prefix such as `DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx`
 *
 * In these cases the semantic value is the qb64 text itself, so the helper
 * simply parses one `Matter` and returns its canonical qb64 string.
 */
function parseQb64Field(
  raw: Uint8Array,
  offset: number,
): ParsedNativeField<string> {
  const matter = parseMatter(raw.slice(offset), "txt");
  return {
    value: matter.qb64,
    nextOffset: offset + matter.fullSize,
  };
}

/**
 * Decode one native numeric field that KERI exposes as a hex string in the SAD.
 *
 * Typical KERI fixed-body examples:
 * - `s`: sequence number, where native `MAAA` becomes semantic `"0"`
 * - `bt`: witness threshold/count field, where native `MAAA` also becomes `"0"`
 *
 * Native CESR uses compact numeric primitives, but KERI SADs conventionally
 * expose these values as lowercase hex strings, so this helper performs that
 * projection.
 */
function parseNumericHexField(
  raw: Uint8Array,
  offset: number,
): ParsedNativeField<string> {
  const matter = new NumberPrimitive({ qb64b: raw.slice(offset) });
  return {
    value: matter.numh,
    nextOffset: offset + matter.fullSize,
  };
}

/**
 * Decode one native signing-threshold field into its SAD `sith` representation.
 *
 * Typical KERI fixed-body examples:
 * - `kt`: current signing threshold, e.g. native `MAAB` -> semantic `"1"`
 * - `nt`: next signing threshold, also commonly `MAAB` -> semantic `"1"`
 *
 * The native bytes are parsed through `Tholder`, which understands both simple
 * numeric thresholds and the more complex weighted threshold encodings.
 */
function parseThresholdSithField(
  raw: Uint8Array,
  offset: number,
): ParsedNativeField<string> {
  const matter = new Tholder({ qb64b: raw.slice(offset) });
  return {
    value: matter.sith,
    nextOffset: offset + matter.fullSize,
  };
}

/**
 * Decode one native list field whose members are ordinary qb64 CESR primitives.
 *
 * Typical KERI fixed-body examples:
 * - `k`: current key list
 * - `n`: next-digest list
 * - `b`: backer/witness prefix list
 *
 * Wire shape:
 * `GenericListGroup counter` + `member1 qb64` + `member2 qb64` + ...
 */
function parseQb64ListField(
  raw: Uint8Array,
  offset: number,
  gvrsn: Versionage,
): ParsedNativeField<string[]> {
  const listCounter = parseCounter(raw.slice(offset), gvrsn, "txt");
  const total = listCounter.fullSize + listCounter.count * 4;
  const payload = t(raw.slice(offset + listCounter.fullSize, offset + total));
  const items: string[] = [];
  let inner = 0;
  while (inner < payload.length) {
    const matter = parseMatter(b(payload.slice(inner)), "txt");
    items.push(matter.qb64);
    inner += matter.fullSize;
  }
  return {
    value: items,
    nextOffset: offset + total,
  };
}

/**
 * Decode one native trait/config list.
 *
 * Typical KERI fixed-body example:
 * - `c`: configuration trait list such as `EO`, `NB`, etc.
 *
 * This looks list-shaped like `k`/`n`/`b`, but each element is a `Traitor`
 * token whose semantic value is the compact trait string, not a generic qb64
 * primitive string.
 */
function parseTraitListField(
  raw: Uint8Array,
  offset: number,
  gvrsn: Versionage,
): ParsedNativeField<string[]> {
  const listCounter = parseCounter(raw.slice(offset), gvrsn, "txt");
  const total = listCounter.fullSize + listCounter.count * 4;
  const payload = t(raw.slice(offset + listCounter.fullSize, offset + total));
  const items: string[] = [];
  let inner = 0;
  while (inner < payload.length) {
    const trait = parseTraitor(b(payload.slice(inner)), "txt");
    items.push(trait.trait);
    inner += trait.fullSize;
  }
  return {
    value: items,
    nextOffset: offset + total,
  };
}

/**
 * Decode one native list field whose members may themselves be nested groups.
 *
 * Typical KERI fixed-body example:
 * - `a`: seal/data list in inception/rotation/interact-style messages
 *
 * Unlike `k`/`n`/`b`, the `a` field may contain grouped or structured payloads,
 * so we reuse `decodeList()` instead of assuming each member is one plain
 * `Matter`.
 */
function parseNestedSealOrDataListField(
  raw: Uint8Array,
  offset: number,
  gvrsn: Versionage,
): ParsedNativeField<MapperValue[]> {
  const listCounter = parseCounter(raw.slice(offset), gvrsn, "txt");
  const total = listCounter.fullSize + listCounter.count * 4;
  return {
    value: listCounter.count === 0
      ? []
      : decodeList(raw.slice(offset, offset + total), gvrsn),
    nextOffset: offset + total,
  };
}

/**
 * Decode one native field-map block into semantic JS map form.
 *
 * `strict=false` is mainly for ACDC schema sections, which may carry `$id`
 * instead of the usual `d` saidive label.
 */
function parseMapperField(
  raw: Uint8Array,
  offset: number,
  gvrsn: Versionage,
  strict = true,
): ParsedNativeField<MapperMap> {
  const mapper = new Mapper({
    raw: raw.slice(offset),
    version: gvrsn,
    kind: "CESR",
    verify: false,
    strict,
  });
  return {
    value: mapper.mad,
    nextOffset: offset + mapper.raw.length,
  };
}

type NativeFieldKind =
  | "said"
  | "aid"
  | "noncer"
  | "nonce-or-empty"
  | "number"
  | "threshold"
  | "primitive-list"
  | "trait-list"
  | "datetime"
  | "route"
  | "mapper"
  | "seal-list-or-mapper"
  | "said-or-mapper"
  | "agid-or-aggor"
  | "label-text";

interface NativeFieldSpec {
  kind: NativeFieldKind;
  strict?: boolean;
}

interface NativeBodyLayout {
  proto: Protocol;
  shape: NativeBodyShape;
  labels: readonly string[];
  fields: Record<string, NativeFieldSpec>;
}

function nativeLayoutKey(
  proto: Protocol,
  version: Versionage,
  ilk: string | null,
): string {
  return `${proto}:${version.major}.${version.minor}:${ilk ?? "<none>"}`;
}

function withKinds(
  proto: Protocol,
  shape: NativeBodyShape,
  labels: readonly string[],
  families: Record<string, NativeFieldKind>,
  options: Partial<Record<string, Omit<NativeFieldSpec, "kind">>> = {},
): NativeBodyLayout {
  return {
    proto,
    shape,
    labels,
    fields: Object.fromEntries(
      labels.map((label) => [
        label,
        {
          kind: families[label],
          ...(options[label] ?? {}),
        },
      ]),
    ),
  };
}

const KERI_NATIVE_FAMILIES: Record<string, NativeFieldKind> = {
  d: "said",
  p: "said",
  x: "said",
  u: "noncer",
  i: "aid",
  di: "aid",
  ri: "aid",
  s: "number",
  bt: "number",
  kt: "threshold",
  nt: "threshold",
  k: "primitive-list",
  n: "primitive-list",
  b: "primitive-list",
  ba: "primitive-list",
  br: "primitive-list",
  dt: "datetime",
  r: "route",
  rr: "route",
  rp: "route",
  c: "trait-list",
  a: "seal-list-or-mapper",
  e: "mapper",
  q: "mapper",
};

const ACDC_NATIVE_FAMILIES: Record<string, NativeFieldKind> = {
  d: "said",
  p: "said",
  b: "said",
  u: "nonce-or-empty",
  i: "aid",
  ri: "said",
  rd: "nonce-or-empty",
  n: "number",
  dt: "datetime",
  td: "nonce-or-empty",
  ts: "label-text",
  s: "said-or-mapper",
  a: "said-or-mapper",
  e: "said-or-mapper",
  r: "said-or-mapper",
  A: "agid-or-aggor",
};

const NATIVE_LAYOUTS = new Map<string, NativeBodyLayout>([
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "icp"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "s", "kt", "k", "nt", "n", "bt", "b", "c", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "rot"),
    withKinds(Protocols.keri, "fixed", [
      "d",
      "i",
      "s",
      "p",
      "kt",
      "k",
      "nt",
      "n",
      "bt",
      "br",
      "ba",
      "a",
    ], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "ixn"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "s", "p", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "dip"),
    withKinds(Protocols.keri, "fixed", [
      "d",
      "i",
      "s",
      "kt",
      "k",
      "nt",
      "n",
      "bt",
      "b",
      "c",
      "a",
      "di",
    ], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "drt"),
    withKinds(Protocols.keri, "fixed", [
      "d",
      "i",
      "s",
      "p",
      "kt",
      "k",
      "nt",
      "n",
      "bt",
      "br",
      "ba",
      "a",
    ], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "rct"),
    withKinds(Protocols.keri, "fixed", ["d", "i", "s"], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "qry"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "dt", "r", "rr", "q"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "rpy"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "dt", "r", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "pro"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "dt", "r", "rr", "q"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "bar"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "dt", "r", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 1, minor: 0 }, "exn"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "rp", "p", "dt", "r", "q", "a", "e"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "icp"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "s", "kt", "k", "nt", "n", "bt", "b", "c", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "rot"),
    withKinds(Protocols.keri, "fixed", [
      "d",
      "i",
      "s",
      "p",
      "kt",
      "k",
      "nt",
      "n",
      "bt",
      "br",
      "ba",
      "c",
      "a",
    ], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "ixn"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "s", "p", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "dip"),
    withKinds(Protocols.keri, "fixed", [
      "d",
      "i",
      "s",
      "kt",
      "k",
      "nt",
      "n",
      "bt",
      "b",
      "c",
      "a",
      "di",
    ], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "drt"),
    withKinds(Protocols.keri, "fixed", [
      "d",
      "i",
      "s",
      "p",
      "kt",
      "k",
      "nt",
      "n",
      "bt",
      "br",
      "ba",
      "c",
      "a",
    ], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "rct"),
    withKinds(Protocols.keri, "fixed", ["d", "i", "s"], KERI_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "qry"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "dt", "r", "rr", "q"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "rpy"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "dt", "r", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "pro"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "dt", "r", "rr", "q"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "bar"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "dt", "r", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "xip"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "u", "i", "ri", "dt", "r", "q", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.keri, { major: 2, minor: 0 }, "exn"),
    withKinds(
      Protocols.keri,
      "fixed",
      ["d", "i", "ri", "x", "p", "dt", "r", "q", "a"],
      KERI_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 1, minor: 0 }, null),
    withKinds(
      Protocols.acdc,
      "map",
      ["v", "d", "u", "i", "ri", "s", "a", "A", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 1, minor: 0 }, "ace"),
    withKinds(
      Protocols.acdc,
      "map",
      ["v", "t", "d", "u", "i", "ri", "s", "a", "A", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, null),
    withKinds(
      Protocols.acdc,
      "map",
      ["v", "d", "u", "i", "rd", "s", "a", "A", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "acm"),
    withKinds(
      Protocols.acdc,
      "map",
      ["v", "t", "d", "u", "i", "rd", "s", "a", "A", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "ace"),
    withKinds(
      Protocols.acdc,
      "map",
      ["v", "t", "d", "u", "i", "ri", "s", "a", "A", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "act"),
    withKinds(
      Protocols.acdc,
      "fixed",
      ["d", "u", "i", "rd", "s", "a", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "acg"),
    withKinds(
      Protocols.acdc,
      "fixed",
      ["d", "u", "i", "rd", "s", "A", "e", "r"],
      ACDC_NATIVE_FAMILIES,
      {
        s: { strict: false },
      },
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "sch"),
    withKinds(Protocols.acdc, "fixed", ["d", "s"], ACDC_NATIVE_FAMILIES, {
      s: { strict: false },
    }),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "att"),
    withKinds(Protocols.acdc, "fixed", ["d", "a"], ACDC_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "agg"),
    withKinds(Protocols.acdc, "fixed", ["d", "A"], ACDC_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "edg"),
    withKinds(Protocols.acdc, "fixed", ["d", "e"], ACDC_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "rul"),
    withKinds(Protocols.acdc, "fixed", ["d", "r"], ACDC_NATIVE_FAMILIES),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "rip"),
    withKinds(
      Protocols.acdc,
      "fixed",
      ["d", "u", "i", "n", "dt"],
      ACDC_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "bup"),
    withKinds(
      Protocols.acdc,
      "fixed",
      ["d", "rd", "n", "p", "dt", "b"],
      ACDC_NATIVE_FAMILIES,
    ),
  ],
  [
    nativeLayoutKey(Protocols.acdc, { major: 2, minor: 0 }, "upd"),
    withKinds(
      Protocols.acdc,
      "fixed",
      ["d", "rd", "n", "p", "dt", "td", "ts"],
      ACDC_NATIVE_FAMILIES,
    ),
  ],
]);

/** Resolve the protocol/version/ilk entry from the shared CESR-native support matrix. */
function getNativeLayout(
  proto: Protocol,
  version: Versionage,
  ilk: string | null,
): NativeBodyLayout {
  const layout = NATIVE_LAYOUTS.get(nativeLayoutKey(proto, version, ilk));
  if (!layout) {
    throw new DeserializeError(
      `Unsupported ${proto} native ilk=${String(ilk)} version=${version.major}.${version.minor}`,
    );
  }
  return layout;
}

/**
 * Decode one native field according to the field-family declared in the
 * support matrix.
 */
function parseNativeField(
  raw: Uint8Array,
  offset: number,
  label: string,
  spec: NativeFieldSpec,
  gvrsn: Versionage,
): ParsedNativeField<MapperValue> {
  if (spec.kind === "said" || spec.kind === "aid") {
    return parseQb64Field(raw, offset);
  }
  if (spec.kind === "noncer") {
    const nonce = parseNoncer(raw.slice(offset), "txt");
    return {
      value: nonce.qb64,
      nextOffset: offset + nonce.fullSize,
    };
  }
  if (spec.kind === "nonce-or-empty") {
    const nonce = parseNoncer(raw.slice(offset), "txt");
    return {
      value: nonce.nonce,
      nextOffset: offset + nonce.fullSize,
    };
  }
  if (spec.kind === "number") {
    return parseNumericHexField(raw, offset);
  }
  if (spec.kind === "threshold") {
    return parseThresholdSithField(raw, offset);
  }
  if (spec.kind === "primitive-list") {
    return parseQb64ListField(raw, offset, gvrsn);
  }
  if (spec.kind === "trait-list") {
    return parseTraitListField(raw, offset, gvrsn);
  }
  if (spec.kind === "datetime") {
    const date = new Dater({ qb64b: raw.slice(offset) });
    return {
      value: date.iso8601,
      nextOffset: offset + date.fullSize,
    };
  }
  if (spec.kind === "route") {
    // Route fields use Pather semantics, not generic labels. That means a
    // native token like `4AAEcredential-issue` must round-trip back to the
    // slash-delimited semantic route `credential/issue`.
    const pather = parsePather(raw.slice(offset), "txt");
    return {
      value: pather.path,
      nextOffset: offset + pather.fullSize,
    };
  }
  if (spec.kind === "mapper") {
    return parseMapperField(raw, offset, gvrsn, spec.strict ?? true);
  }
  if (spec.kind === "seal-list-or-mapper") {
    const counter = parseCounter(raw.slice(offset), gvrsn, "txt");
    if (
      counter.code === CtrDexV2.GenericMapGroup
      || counter.code === CtrDexV2.BigGenericMapGroup
    ) {
      return parseMapperField(raw, offset, gvrsn, spec.strict ?? true);
    }
    if (
      counter.code === CtrDexV2.GenericListGroup
      || counter.code === CtrDexV2.BigGenericListGroup
    ) {
      return parseNestedSealOrDataListField(raw, offset, gvrsn);
    }
    throw new DeserializeError(
      `Expected native list/map group for field ${label}, got ${counter.code}`,
    );
  }
  if (spec.kind === "said-or-mapper") {
    if (raw[offset] === "-".charCodeAt(0)) {
      return parseMapperField(raw, offset, gvrsn, spec.strict ?? true);
    }
    return parseQb64Field(raw, offset);
  }
  if (spec.kind === "agid-or-aggor") {
    if (raw[offset] === "-".charCodeAt(0)) {
      const aggor = new Aggor({
        raw: raw.slice(offset),
        version: gvrsn,
        kind: "CESR",
        verify: false,
      });
      return {
        value: aggor.ael,
        nextOffset: offset + aggor.serialized.length,
      };
    }
    return parseQb64Field(raw, offset);
  }
  if (spec.kind === "label-text") {
    const text = parseLabeler(raw.slice(offset), "txt");
    return {
      value: text.text,
      nextOffset: offset + text.fullSize,
    };
  }
  throw new DeserializeError(`Unsupported native field label=${label}`);
}

/**
 * Encode one semantic SAD field back into the native field-family form
 * declared in the support matrix.
 */
function encodeNativeFieldValue(
  value: unknown,
  label: string,
  spec: NativeFieldSpec,
  gvrsn: Versionage,
): string {
  if (spec.kind === "said" || spec.kind === "aid" || spec.kind === "noncer") {
    if (typeof value !== "string" || value.length === 0) {
      throw new SerializeError(
        `Expected non-empty qb64 value for native field ${label}`,
      );
    }
    return value;
  }
  if (spec.kind === "nonce-or-empty") {
    if (typeof value !== "string") {
      throw new SerializeError(
        `Expected string nonce value for native field ${label}`,
      );
    }
    return value.length === 0 ? LabelDex.Empty : value;
  }
  if (spec.kind === "number") {
    if (
      typeof value !== "string"
      && typeof value !== "number"
      && typeof value !== "bigint"
    ) {
      throw new SerializeError(
        `Expected numeric value for native field ${label}`,
      );
    }
    return encodeNumber(value);
  }
  if (spec.kind === "threshold") {
    if (typeof value !== "string" && typeof value !== "number") {
      throw new SerializeError(
        `Expected threshold value for native field ${label}`,
      );
    }
    return encodeThreshold(value);
  }
  if (spec.kind === "primitive-list") {
    if (!Array.isArray(value)) {
      throw new SerializeError(
        `Expected primitive list for native field ${label}`,
      );
    }
    return encodeList(
      value.map((entry) => {
        if (typeof entry !== "string" || entry.length === 0) {
          throw new SerializeError(
            `Expected qb64 list member for native field ${label}`,
          );
        }
        return entry;
      }),
      gvrsn,
    );
  }
  if (spec.kind === "trait-list") {
    if (!Array.isArray(value)) {
      throw new SerializeError(`Expected trait list for native field ${label}`);
    }
    return encodeList(value.map((entry) => encodeTag(String(entry))), gvrsn);
  }
  if (spec.kind === "datetime") {
    if (typeof value !== "string") {
      throw new SerializeError(
        `Expected ISO-8601 string for native field ${label}`,
      );
    }
    return encodeDate(value);
  }
  if (spec.kind === "route") {
    if (typeof value !== "string") {
      throw new SerializeError(
        `Expected route/path string for native field ${label}`,
      );
    }
    return encodePath(value);
  }
  if (spec.kind === "mapper") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Mapper.fromSad(value as SadMap, {
        strict: spec.strict ?? true,
        kind: "CESR",
        verify: false,
        saidive: false,
      }).qb64;
    }
    throw new SerializeError(`Expected map value for native field ${label}`);
  }
  if (spec.kind === "seal-list-or-mapper") {
    if (Array.isArray(value)) {
      return encodeList(value.map((entry) => encodeValue(entry, gvrsn)), gvrsn);
    }
    if (value && typeof value === "object") {
      return Mapper.fromSad(value as SadMap, {
        strict: spec.strict ?? true,
        kind: "CESR",
        verify: false,
        saidive: false,
      }).qb64;
    }
    throw new SerializeError(`Expected list or map for native field ${label}`);
  }
  if (spec.kind === "said-or-mapper") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Mapper.fromSad(value as SadMap, {
        strict: spec.strict ?? true,
        kind: "CESR",
        verify: false,
        saidive: false,
      }).qb64;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new SerializeError(
        `Expected qb64 or map for native field ${label}`,
      );
    }
    return value;
  }
  if (spec.kind === "agid-or-aggor") {
    if (Array.isArray(value)) {
      return new Aggor({
        ael: value,
        kind: "CESR",
        makify: false,
        verify: false,
      }).qb64g;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new SerializeError(
        `Expected agid string or aggregate list for native field ${label}`,
      );
    }
    return value;
  }
  if (spec.kind === "label-text") {
    if (typeof value !== "string") {
      throw new SerializeError(
        `Expected text string for native field ${label}`,
      );
    }
    return encodeLabel(value);
  }
  throw new SerializeError(`Unsupported native field kind for ${label}`);
}

/**
 * Decode one CESR-native body into a semantic SAD plus core serder projections.
 *
 * Current intent is narrow but real: hydrate actual native message bodies into
 * something `Serder` can verify and expose through its normal accessor surface.
 * Broader KERI/ACDC ilk parity should continue extending this function rather
 * than introducing sidecar native decoders elsewhere in the stack.
 *
 * Inputs:
 * - `raw`: full native body-group bytes, either qb64 text or qb2 binary
 * - `smellage`: protocol/version metadata already derived by `Serdery` or a
 *   parser-side native pre-read
 *
 * Output:
 * - `ked`: semantic SAD reconstructed from compact CESR fields
 * - `ilk`: top-level message type when present
 * - `said`: top-level `d` SAID when present
 *
 * High-level flow:
 * 1. canonicalize qb2 to qb64 text if needed
 * 2. parse the body-group counter (`-F...` or `-G...`)
 * 3. consume version metadata (`Verser`) and then protocol-specific fields
 * 4. rebuild normal SAD strings/lists/maps so `Serder` verification can run on
 *    the same shape used by JSON/CBOR/MGPK bodies
 *
 * Maintainer rule:
 * top-level KERI native messages are fixed-field bodies. A top-level
 * `MapBodyGroup` may still be meaningful for lower-level CESR-native mapping
 * surfaces or ACDC, but it is not a valid KERI native message body and should
 * be rejected here.
 *
 * Example:
 *
 * ```ts
 * const { ked } = parseCesrNativeKed(
 *   new TextEncoder().encode("-FA50OKERICAACAXicp..."),
 *   { proto: "KERI", pvrsn: { major: 2, minor: 0 }, gvrsn: { major: 2, minor: 0 }, kind: "CESR", size: 188 },
 * );
 * // ked.t === "icp"
 * // ked.d === "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN"
 * ```
 */
export function parseCesrNativeKed(
  raw: Uint8Array,
  smellage: Smellage,
): { ked: SadMap; ilk: string | null; said: string | null } {
  const gvrsn = smellage.gvrsn ?? smellage.pvrsn;
  const textRaw = canonicalizeCesrNativeRaw(raw, gvrsn);
  const counter = parseCounter(textRaw, gvrsn, "txt");
  let offset = counter.fullSize;
  const fixed = counter.code === CtrDexV2.FixBodyGroup
    || counter.code === CtrDexV2.BigFixBodyGroup;

  if (!fixed) {
    const versionLabel = parseLabeler(textRaw.slice(offset), "txt");
    if (versionLabel.label !== "v") {
      throw new DeserializeError(
        `Expected native version label 'v', got ${versionLabel.label}`,
      );
    }
    offset += versionLabel.fullSize;
  }

  const verser = parseVerser(textRaw.slice(offset), "txt");
  offset += verser.fullSize;
  const ked: SadMap = {
    v: versify({
      proto: verser.proto,
      pvrsn: verser.pvrsn,
      gvrsn: verser.gvrsn,
      kind: Kinds.cesr,
      size: textRaw.length,
    }),
  };

  if (smellage.proto === Protocols.keri && !fixed) {
    throw new DeserializeError(
      "KERI CESR-native top-level messages must use FixBodyGroup, not MapBodyGroup",
    );
  }

  let ilk = fixed ? parseIlker(textRaw.slice(offset), "txt").ilk : null;
  if (fixed && ilk !== null) {
    const ilker = parseIlker(textRaw.slice(offset), "txt");
    offset += ilker.fullSize;
    ked.t = ilker.ilk;
    ilk = ilker.ilk;
  }

  let layout = getNativeLayout(smellage.proto, smellage.pvrsn, ilk);
  if (
    (fixed && layout.shape !== "fixed") || (!fixed && layout.shape !== "map")
  ) {
    throw new DeserializeError(
      `${smellage.proto} CESR-native ilk=${String(ilk)} requires ${layout.shape} body shape`,
    );
  }

  if (fixed) {
    for (const label of layout.labels) {
      const parsed = parseNativeField(
        textRaw,
        offset,
        label,
        layout.fields[label],
        gvrsn,
      );
      ked[label] = parsed.value;
      offset = parsed.nextOffset;
    }
    return {
      ked,
      ilk,
      said: typeof ked.d === "string" ? ked.d : null,
    };
  }

  while (offset < textRaw.length) {
    const labeler = parseLabeler(textRaw.slice(offset), "txt");
    const label = labeler.label;
    offset += labeler.fullSize;
    if (!label) {
      break;
    }
    if (label === "t") {
      const ilker = parseIlker(textRaw.slice(offset), "txt");
      ked.t = ilker.ilk;
      ilk = ilker.ilk;
      layout = getNativeLayout(smellage.proto, smellage.pvrsn, ilk);
      offset += ilker.fullSize;
      continue;
    }
    const spec = layout.fields[label];
    if (!spec) {
      throw new DeserializeError(
        `Unsupported ${smellage.proto} native label=${label} for ilk=${String(ilk)}`,
      );
    }
    const parsed = parseNativeField(textRaw, offset, label, spec, gvrsn);
    ked[label] = parsed.value;
    offset = parsed.nextOffset;
  }

  return {
    ked,
    ilk,
    said: typeof ked.d === "string" ? ked.d : null,
  };
}

/**
 * Serialize one semantic SAD into CESR-native qb64 text-domain bytes.
 *
 * Callers that start from qb2 should still route through this text-domain emit
 * path; qb2 is derived from qb64 later, matching the canonicalization path used
 * during native inhale.
 *
 * Inputs:
 * - one semantic SAD in the same shape used by non-native serders
 *
 * Output:
 * - qb64 text-domain bytes for a CESR-native body group
 *
 * High-level flow:
 * 1. derive protocol/version context from the SAD's `v`
 * 2. emit compact CESR primitives for each field (`Verser`, `Ilker`, `Matter`,
 *    grouped lists/maps, etc.)
 * 3. wrap the payload in `FixBodyGroup` or `MapBodyGroup`
 *
 * ASCII shape of the result for a KERI fixed-body message:
 *
 * ```text
 * -F... <verser> <ilk> <d> <i> <s> <kt> <k-list> <nt> <n-list> ...
 * ```
 *
 * Example:
 *
 * ```ts
 * const raw = dumpCesrNativeSad({
 *   v: "KERICAACAACESRAAC8.",
 *   t: "icp",
 *   d: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
 *   i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
 *   s: "0",
 *   kt: "1",
 *   k: ["DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx"],
 *   nt: "1",
 *   n: ["EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2"],
 *   bt: "0",
 *   b: [],
 *   c: [],
 *   a: [],
 * });
 * ```
 */
export function dumpCesrNativeSad(sad: SadMap): Uint8Array {
  if (typeof sad.v !== "string") {
    throw new SerializeError("Missing version string for CESR native dump");
  }
  const pvrsn: Versionage = sad.v[4] === "1"
    ? { major: 1, minor: Number.parseInt(sad.v[5], 16) }
    : { major: 2, minor: 0 };
  const gvrsn: Versionage | null = sad.v.includes("CESR") && sad.v.length >= 19
    ? { major: 2, minor: 0 }
    : null;
  const smellage = {
    proto: sad.v.slice(0, 4) as Protocol,
    pvrsn,
    gvrsn,
  };

  const ilk = typeof sad.t === "string" ? sad.t : null;
  const layout = getNativeLayout(smellage.proto, smellage.pvrsn, ilk);
  const version = smellage.gvrsn ?? Vrsn_2_0;

  const body = layout.shape === "map"
    ? (() => {
      let frame = "";
      for (const label of layout.labels) {
        if (!(label in sad)) {
          continue;
        }
        if (label === "v") {
          frame += encodeLabel("v");
          frame += encodeVerser(smellage.proto, smellage.pvrsn, smellage.gvrsn);
          continue;
        }
        if (label === "t") {
          frame += encodeLabel("t");
          frame += encodeTag(String(sad.t));
          continue;
        }
        const spec = layout.fields[label];
        if (!spec) {
          throw new SerializeError(
            `Unsupported native field ${label} for ilk=${String(ilk)}`,
          );
        }
        frame += encodeLabel(label);
        frame += encodeNativeFieldValue(sad[label], label, spec, version);
      }
      const code = frame.length / 4 < 64 ** 2
        ? CtrDexV2.MapBodyGroup
        : CtrDexV2.BigMapBodyGroup;
      return `${new Counter({ code, count: frame.length / 4, version }).qb64}${frame}`;
    })()
    : (() => {
      if (!ilk) {
        throw new SerializeError(
          `Missing ilk for fixed-body native ${smellage.proto} message`,
        );
      }
      let frame = `${encodeVerser(smellage.proto, smellage.pvrsn, smellage.gvrsn)}${encodeTag(ilk)}`;
      for (const label of layout.labels) {
        const spec = layout.fields[label];
        if (!spec) {
          throw new SerializeError(
            `Unsupported native field ${label} for ilk=${String(ilk)}`,
          );
        }
        frame += encodeNativeFieldValue(sad[label], label, spec, version);
      }
      const code = frame.length / 4 < 64 ** 2
        ? CtrDexV2.FixBodyGroup
        : CtrDexV2.BigFixBodyGroup;
      return `${new Counter({ code, count: frame.length / 4, version }).qb64}${frame}`;
    })();

  return b(body);
}
