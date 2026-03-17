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
import { Compactor } from "../primitives/compactor.ts";
import { Counter, parseCounter } from "../primitives/counter.ts";
import { Dater } from "../primitives/dater.ts";
import { parseIlker } from "../primitives/ilker.ts";
import { Labeler, parseLabeler } from "../primitives/labeler.ts";
import { parseMapperBody } from "../primitives/mapper.ts";
import { Matter } from "../primitives/matter.ts";
import { parseNoncer } from "../primitives/noncer.ts";
import { NumberPrimitive } from "../primitives/number.ts";
import { parsePather } from "../primitives/pather.ts";
import type { GroupEntry } from "../primitives/primitive.ts";
import { isCounterGroupLike, isPrimitiveTuple } from "../primitives/primitive.ts";
import { Structor } from "../primitives/structor.ts";
import { Tholder } from "../primitives/tholder.ts";
import { parseTraitor } from "../primitives/traitor.ts";
import { parseVerser } from "../primitives/verser.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds, type Protocol, Protocols, Vrsn_2_0 } from "../tables/versions.ts";
import { versify } from "./smell.ts";

type SadMap = Record<string, unknown>;
type ParsedNativeField<T = unknown> = { value: T; nextOffset: number };

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
  const pad = code === LabelDex.Tag1 || code === LabelDex.Tag5 || code === LabelDex.Tag9 ? "_" : "";
  return `${code}${pad}${text}`;
}

/** Emit base64-safe text through the StrB64/Bexter family. */
function encodeBext(text: string): string {
  const rem = text.length % 4;
  const code = rem === 0 ? LabelDex.StrB64_L0 : rem === 1 ? LabelDex.StrB64_L1 : LabelDex.StrB64_L2;
  return new Matter({ code, raw: Bexter.rawify(text) }).qb64;
}

/** Emit arbitrary UTF-8 text through the bytes label family. */
function encodeBytes(text: string): string {
  const raw = b(text);
  const rem = raw.length % 3;
  const code = rem === 0 ? LabelDex.Bytes_L0 : rem === 1 ? LabelDex.Bytes_L1 : LabelDex.Bytes_L2;
  return new Matter({ code, raw }).qb64;
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
function encodeVerser(proto: Protocol, pvrsn: Versionage, gvrsn: Versionage | null): string {
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
  return new Matter({ code: entry.code, raw: padded }).qb64;
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
  return `${MtrDex.DateTime}${
    iso8601.replaceAll(":", "c").replaceAll(".", "d").replaceAll("+", "p")
  }`;
}

/** Encode route/path values using the same pather-style StrB64 representation KERIpy uses. */
function encodePath(path: string): string {
  return encodeBext(path.replace(/^\//, "").replaceAll("/", "-"));
}

/** Enclose already-encoded members inside one native generic-list group. */
function encodeList(entries: string[], gvrsn: Versionage | null): string {
  const frame = entries.join("");
  const count = frame.length / 4;
  const code = count < 64 ** 2 ? CtrDexV2.GenericListGroup : CtrDexV2.BigGenericListGroup;
  return `${new Counter({ code, count, version: gvrsn ?? Vrsn_2_0 }).qb64}${frame}`;
}

/**
 * Enclose one semantic field map inside either a top-level body-group or a
 * nested generic map-group.
 */
function encodeMap(map: SadMap, gvrsn: Versionage | null, topLevel = false): string {
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
      const primitive = new Matter({ qb64: value });
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
function decodeEntry(entry: GroupEntry, gvrsn: Versionage): unknown {
  if (isPrimitiveTuple(entry)) {
    return entry.map((item) => decodeEntry(item, gvrsn));
  }
  if (isCounterGroupLike(entry)) {
    if (isAggorListCode(entry.code)) {
      return entry.items.map((item) => decodeEntry(item, gvrsn));
    }
    if (isAggorMapCode(entry.code)) {
      const aggor = parseAggor(b(Structor.fromGroup(entry).qb64g), gvrsn, "txt");
      const fields = aggor.mapFields ?? [];
      return Object.fromEntries(
        fields.map((field) => [field.label ?? "", decodeMapperField(field, gvrsn)]),
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
): unknown {
  if (field.children) {
    return Object.fromEntries(
      field.children.map((child) => [child.label ?? "", decodeMapperField(child as never, gvrsn)]),
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
function decodeList(raw: Uint8Array, gvrsn: Versionage): unknown[] {
  const counter = parseCounter(raw, gvrsn, "txt");
  if (
    counter.code !== CtrDexV2.GenericListGroup
    && counter.code !== CtrDexV2.BigGenericListGroup
  ) {
    throw new DeserializeError(`Expected list group, got ${counter.code}`);
  }
  const payload = t(raw.slice(counter.fullSize, counter.fullSize + counter.count * 4));
  const out: unknown[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const chunk = b(payload.slice(offset));
    try {
      const parsed = parseAttachmentDispatch(chunk, gvrsn, "txt");
      out.push(decodeEntry(parsed.group, gvrsn));
      offset += parsed.consumed;
      continue;
    } catch {
      const matter = new Matter({ qb64b: chunk });
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
  const matter = new Matter({ qb64b: raw.slice(offset) });
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
  const matter = new NumberPrimitive(new Matter({ qb64b: raw.slice(offset) }));
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
  const matter = new Tholder(new Matter({ qb64b: raw.slice(offset) }));
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
    const matter = new Matter({ qb64: payload.slice(inner) });
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
): ParsedNativeField<unknown[]> {
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
 * Decode one fixed-field KERI native value and advance the read offset.
 *
 * This keeps `parseCesrNativeKed()` focused on protocol/message shape rather
 * than the primitive-level mechanics of each individual CESR family.
 *
 * Field-family map:
 * - `d`, `i` -> already-qualified qb64 primitives
 * - `s`, `bt` -> compact numbers exposed as hex strings in the SAD
 * - `kt`, `nt` -> threshold expressions exposed as `sith`
 * - `k`, `n`, `b` -> lists of qb64 primitives
 * - `c` -> list of trait strings
 * - `a` -> list of possibly nested/grouped seal or data payloads
 */
function parseKeriFixedField(
  raw: Uint8Array,
  offset: number,
  label: string,
  gvrsn: Versionage,
): ParsedNativeField {
  if (label === "d" || label === "i") {
    return parseQb64Field(raw, offset);
  }
  if (label === "s" || label === "bt") {
    return parseNumericHexField(raw, offset);
  }
  if (label === "kt" || label === "nt") {
    return parseThresholdSithField(raw, offset);
  }
  if (label === "k" || label === "n" || label === "b") {
    return parseQb64ListField(raw, offset, gvrsn);
  }
  if (label === "c") {
    return parseTraitListField(raw, offset, gvrsn);
  }
  if (label === "a") {
    return parseNestedSealOrDataListField(raw, offset, gvrsn);
  }
  throw new DeserializeError(`Unsupported KERI native fixed-field label=${label}`);
}

type NativeFieldKind =
  | "qb64"
  | "nonce-or-empty"
  | "said-or-block"
  | "agid-or-list"
  | "text"
  | "datetime";

interface NativeFieldSpec {
  kind: NativeFieldKind;
}

interface NativeBodyLayout {
  shape: "fixed" | "map";
  labels: readonly string[];
  fields: Record<string, NativeFieldSpec>;
}

function acdcLayoutKey(version: Versionage, ilk: string | null): string {
  return `${version.major}.${version.minor}:${ilk ?? "<none>"}`;
}

const ACDC_NATIVE_LAYOUTS = new Map<string, NativeBodyLayout>([
  [
    acdcLayoutKey({ major: 1, minor: 0 }, null),
    {
      shape: "map",
      labels: ["v", "d", "u", "i", "ri", "s", "a", "A", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        ri: { kind: "qb64" },
        s: { kind: "said-or-block" },
        a: { kind: "said-or-block" },
        A: { kind: "agid-or-list" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 1, minor: 0 }, "ace"),
    {
      shape: "map",
      labels: ["v", "t", "d", "u", "i", "ri", "s", "a", "A", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        ri: { kind: "qb64" },
        s: { kind: "said-or-block" },
        a: { kind: "said-or-block" },
        A: { kind: "agid-or-list" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, null),
    {
      shape: "map",
      labels: ["v", "d", "u", "i", "rd", "s", "a", "A", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        rd: { kind: "qb64" },
        s: { kind: "said-or-block" },
        a: { kind: "said-or-block" },
        A: { kind: "agid-or-list" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "acm"),
    {
      shape: "map",
      labels: ["v", "t", "d", "u", "i", "rd", "s", "a", "A", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        rd: { kind: "qb64" },
        s: { kind: "said-or-block" },
        a: { kind: "said-or-block" },
        A: { kind: "agid-or-list" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "ace"),
    {
      shape: "map",
      labels: ["v", "t", "d", "u", "i", "ri", "s", "a", "A", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        ri: { kind: "qb64" },
        s: { kind: "said-or-block" },
        a: { kind: "said-or-block" },
        A: { kind: "agid-or-list" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "act"),
    {
      shape: "fixed",
      labels: ["d", "u", "i", "rd", "s", "a", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        rd: { kind: "qb64" },
        s: { kind: "said-or-block" },
        a: { kind: "said-or-block" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "acg"),
    {
      shape: "fixed",
      labels: ["d", "u", "i", "rd", "s", "A", "e", "r"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        rd: { kind: "qb64" },
        s: { kind: "said-or-block" },
        A: { kind: "agid-or-list" },
        e: { kind: "said-or-block" },
        r: { kind: "said-or-block" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "sch"),
    {
      shape: "fixed",
      labels: ["d", "s"],
      fields: { d: { kind: "qb64" }, s: { kind: "said-or-block" } },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "att"),
    {
      shape: "fixed",
      labels: ["d", "a"],
      fields: { d: { kind: "qb64" }, a: { kind: "said-or-block" } },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "agg"),
    {
      shape: "fixed",
      labels: ["d", "A"],
      fields: { d: { kind: "qb64" }, A: { kind: "agid-or-list" } },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "edg"),
    {
      shape: "fixed",
      labels: ["d", "e"],
      fields: { d: { kind: "qb64" }, e: { kind: "said-or-block" } },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "rul"),
    {
      shape: "fixed",
      labels: ["d", "r"],
      fields: { d: { kind: "qb64" }, r: { kind: "said-or-block" } },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "rip"),
    {
      shape: "fixed",
      labels: ["d", "u", "i", "n", "dt"],
      fields: {
        d: { kind: "qb64" },
        u: { kind: "nonce-or-empty" },
        i: { kind: "qb64" },
        n: { kind: "qb64" },
        dt: { kind: "datetime" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "bup"),
    {
      shape: "fixed",
      labels: ["d", "rd", "n", "p", "dt", "b"],
      fields: {
        d: { kind: "qb64" },
        rd: { kind: "qb64" },
        n: { kind: "qb64" },
        p: { kind: "qb64" },
        dt: { kind: "datetime" },
        b: { kind: "qb64" },
      },
    },
  ],
  [
    acdcLayoutKey({ major: 2, minor: 0 }, "upd"),
    {
      shape: "fixed",
      labels: ["d", "rd", "n", "p", "dt", "td", "ts"],
      fields: {
        d: { kind: "qb64" },
        rd: { kind: "qb64" },
        n: { kind: "qb64" },
        p: { kind: "qb64" },
        dt: { kind: "datetime" },
        td: { kind: "nonce-or-empty" },
        ts: { kind: "text" },
      },
    },
  ],
]);

/**
 * Resolve the protocol-aware native body layout for one ACDC version/ilk pair.
 *
 * This table is the native-body counterpart to the serder field registry in
 * `serder.ts`: body shape (`fixed` vs `map`) and field-family meaning live
 * together here so native inhale/exhale does not regress back into ad hoc
 * per-call branching.
 */
function getAcdcLayout(version: Versionage, ilk: string | null): NativeBodyLayout {
  const layout = ACDC_NATIVE_LAYOUTS.get(acdcLayoutKey(version, ilk));
  if (!layout) {
    throw new DeserializeError(
      `Unsupported ACDC native ilk=${String(ilk)} version=${version.major}.${version.minor}`,
    );
  }
  return layout;
}

/**
 * Decode one ACDC field according to the field-family rules KERIpy applies.
 *
 * Examples:
 * - `s`: either a compact SAID like `E...` or a nested map block encoded as a `Compactor`
 * - `A`: either an aggregate identifier `E...` or an aggregate list encoded as an `Aggor`
 * - `u`/`td`: either empty nonce `1AAP` => `""` or a qualified nonce token
 */
function parseAcdcField(
  raw: Uint8Array,
  offset: number,
  label: string,
  spec: NativeFieldSpec,
  gvrsn: Versionage,
): ParsedNativeField {
  // Each field-family branch here mirrors one conceptual CESR-native section
  // type. Keep the branches semantic, not label-specific, so future parity
  // work extends field families instead of multiplying special cases.
  if (spec.kind === "qb64") {
    return parseQb64Field(raw, offset);
  }
  if (spec.kind === "nonce-or-empty") {
    const nonce = parseNoncer(raw.slice(offset), "txt");
    return {
      value: nonce.nonce,
      nextOffset: offset + nonce.fullSize,
    };
  }
  if (spec.kind === "datetime") {
    const date = new Dater(new Matter({ qb64b: raw.slice(offset) }));
    return {
      value: date.iso8601,
      nextOffset: offset + date.fullSize,
    };
  }
  if (spec.kind === "text") {
    const text = parseLabeler(raw.slice(offset), "txt");
    return {
      value: text.text,
      nextOffset: offset + text.fullSize,
    };
  }
  if (spec.kind === "said-or-block") {
    if (raw[offset] === "-".charCodeAt(0)) {
      const compactor = new Compactor({
        raw: raw.slice(offset),
        version: gvrsn,
        kind: "CESR",
        verify: false,
      });
      return {
        value: compactor.mad,
        nextOffset: offset + compactor.raw.length,
      };
    }
    return parseQb64Field(raw, offset);
  }
  if (spec.kind === "agid-or-list") {
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
  throw new DeserializeError(`Unsupported ACDC native field label=${label}`);
}

function encodeAcdcFieldValue(
  value: unknown,
  label: string,
  spec: NativeFieldSpec,
  gvrsn: Versionage,
): string {
  // This is the exhale companion to `parseAcdcField()`. The goal is that a
  // maintainer can line the two functions up branch-for-branch and see the same
  // field-family story in both directions.
  if (spec.kind === "qb64") {
    if (typeof value !== "string" || value.length === 0) {
      throw new SerializeError(`Expected non-empty qb64 value for ACDC field ${label}`);
    }
    return value;
  }
  if (spec.kind === "nonce-or-empty") {
    if (typeof value !== "string") {
      throw new SerializeError(`Expected string nonce value for ACDC field ${label}`);
    }
    return value.length === 0 ? LabelDex.Empty : value;
  }
  if (spec.kind === "datetime") {
    if (typeof value !== "string") {
      throw new SerializeError(`Expected ISO-8601 string for ACDC field ${label}`);
    }
    return encodeDate(value);
  }
  if (spec.kind === "text") {
    if (typeof value !== "string") {
      throw new SerializeError(`Expected text string for ACDC field ${label}`);
    }
    return encodeLabel(value);
  }
  if (spec.kind === "said-or-block") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return new Compactor({
        mad: value as SadMap,
        kind: "CESR",
        verify: false,
        saidive: true,
      }).qb64;
    }
    if (typeof value !== "string") {
      throw new SerializeError(`Expected qb64 or compactable map for ACDC field ${label}`);
    }
    return value;
  }
  if (spec.kind === "agid-or-list") {
    if (Array.isArray(value)) {
      return new Aggor({
        ael: value,
        kind: "CESR",
        makify: false,
        verify: false,
      }).qb64g;
    }
    if (typeof value !== "string") {
      throw new SerializeError(`Expected agid string or aggregate list for ACDC field ${label}`);
    }
    return value;
  }
  throw new SerializeError(`Unsupported ACDC field kind for ${label}`);
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
  const fixed = counter.code === CtrDexV2.FixBodyGroup || counter.code === CtrDexV2.BigFixBodyGroup;

  if (!fixed) {
    const versionLabel = parseLabeler(textRaw.slice(offset), "txt");
    if (versionLabel.label !== "v") {
      throw new DeserializeError(`Expected native version label 'v', got ${versionLabel.label}`);
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

  if (smellage.proto === Protocols.keri) {
    if (!fixed) {
      throw new DeserializeError(
        "KERI CESR-native top-level messages must use FixBodyGroup, not MapBodyGroup",
      );
    }
    const ilk = parseIlker(textRaw.slice(offset), "txt").ilk;
    offset += 4;
    ked.t = ilk;
    const labels = ["d", "i", "s", "kt", "k", "nt", "n", "bt", "b", "c", "a"];
    for (const label of labels) {
      const parsed = parseKeriFixedField(textRaw, offset, label, gvrsn);
      ked[label] = parsed.value;
      offset = parsed.nextOffset;
    }
    return {
      ked,
      ilk,
      said: typeof ked.d === "string" ? ked.d : null,
    };
  }

  let acdcIlk = fixed
    ? parseIlker(textRaw.slice(offset), "txt").ilk
    : (typeof ked.t === "string" ? ked.t : null);
  if (fixed) {
    offset += 4;
    ked.t = acdcIlk;
  }
  let acdcLayout = getAcdcLayout(smellage.pvrsn, acdcIlk);
  if ((fixed && acdcLayout.shape !== "fixed") || (!fixed && acdcLayout.shape !== "map")) {
    throw new DeserializeError(
      `ACDC CESR-native ilk=${String(acdcIlk)} requires ${acdcLayout.shape} body shape`,
    );
  }

  if (fixed) {
    for (const label of acdcLayout.labels) {
      const parsed = parseAcdcField(textRaw, offset, label, acdcLayout.fields[label], gvrsn);
      ked[label] = parsed.value;
      offset = parsed.nextOffset;
    }
    return {
      ked,
      ilk: acdcIlk,
      said: typeof ked.d === "string" ? ked.d : null,
    };
  }

  while (offset < textRaw.length) {
    const labeler = fixed ? null : parseLabeler(textRaw.slice(offset), "txt");
    const label = fixed
      ? null
      : labeler?.label ?? null;
    if (labeler) {
      offset += labeler.fullSize;
    }
    if (fixed && !("t" in ked)) {
      const ilk = parseIlker(textRaw.slice(offset), "txt").ilk;
      ked.t = ilk;
      offset += 4;
      continue;
    }
    if (!label) {
      break;
    }
    if (label === "t") {
      const token = parseLabeler(textRaw.slice(offset), "txt");
      ked.t = token.text;
      acdcIlk = token.text;
      acdcLayout = getAcdcLayout(smellage.pvrsn, acdcIlk);
      offset += token.fullSize;
      continue;
    }
    const spec = acdcLayout.fields[label];
    if (!spec) {
      throw new DeserializeError(
        `Unsupported ACDC native label=${label} for ilk=${String(acdcIlk)}`,
      );
    }
    const parsed = parseAcdcField(textRaw, offset, label, spec, gvrsn);
    ked[label] = parsed.value;
    offset = parsed.nextOffset;
  }

  return {
    ked,
    ilk: acdcIlk,
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

  const body = smellage.proto === Protocols.keri
    ? (() => {
      const ilk = typeof sad.t === "string" ? sad.t : "";
      let frame = `${encodeVerser(smellage.proto, smellage.pvrsn, smellage.gvrsn)}${
        encodeTag(ilk)
      }`;
      for (const [label, value] of Object.entries(sad)) {
        if (label === "v" || label === "t") continue;
        if (label === "c") {
          frame += encodeList(
            (value as unknown[]).map((trait) => encodeTag(String(trait))),
            smellage.gvrsn,
          );
          continue;
        }
        if (label === "k" || label === "n" || label === "b" || label === "ba" || label === "br") {
          frame += encodeList((value as string[]).map((entry) => entry), smellage.gvrsn);
          continue;
        }
        if (label === "a") {
          frame += Array.isArray(value)
            ? encodeList(
              (value as unknown[]).map((entry) => encodeValue(entry, smellage.gvrsn)),
              smellage.gvrsn,
            )
            : encodeMap(value as SadMap, smellage.gvrsn);
          continue;
        }
        frame += label === "s" || label === "bt"
          ? encodeNumber(value as string)
          : label === "kt" || label === "nt"
          ? encodeThreshold(value as string)
          : encodeValue(value, smellage.gvrsn, label);
      }
      return `${
        new Counter({
          code: CtrDexV2.FixBodyGroup,
          count: frame.length / 4,
          version: smellage.gvrsn ?? Vrsn_2_0,
        }).qb64
      }${frame}`;
    })()
    : (() => {
      const ilk = typeof sad.t === "string" ? sad.t : null;
      const layout = getAcdcLayout(smellage.pvrsn, ilk);

      if (layout.shape === "map") {
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
          frame += encodeLabel(label);
          frame += encodeAcdcFieldValue(
            sad[label],
            label,
            layout.fields[label],
            smellage.gvrsn ?? Vrsn_2_0,
          );
        }
        const code = frame.length / 4 < 64 ** 2 ? CtrDexV2.MapBodyGroup : CtrDexV2.BigMapBodyGroup;
        return `${
          new Counter({ code, count: frame.length / 4, version: smellage.gvrsn ?? Vrsn_2_0 }).qb64
        }${frame}`;
      }

      let frame = `${encodeVerser(smellage.proto, smellage.pvrsn, smellage.gvrsn)}${
        encodeTag(String(ilk ?? ""))
      }`;
      for (const label of layout.labels) {
        frame += encodeAcdcFieldValue(
          sad[label],
          label,
          layout.fields[label],
          smellage.gvrsn ?? Vrsn_2_0,
        );
      }
      const code = frame.length / 4 < 64 ** 2 ? CtrDexV2.FixBodyGroup : CtrDexV2.BigFixBodyGroup;
      return `${
        new Counter({ code, count: frame.length / 4, version: smellage.gvrsn ?? Vrsn_2_0 }).qb64
      }${frame}`;
    })();

  return b(body);
}
