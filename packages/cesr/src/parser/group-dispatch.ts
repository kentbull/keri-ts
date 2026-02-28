import type { AttachmentGroup, ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { type Counter, parseCounter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import { parseIndexer } from "../primitives/indexer.ts";
import {
  DeserializeError,
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import { b64ToInt, intToB64 } from "../core/bytes.ts";

/**
 * Counter-group dispatcher for attachment payload parsing.
 *
 * Design notes:
 * - Dispatch is table-driven by major CESR version.
 * - Wrapper groups attempt nested parsing.
 *   - `strict` mode: fail-fast on any nested parse error.
 *   - `compat` mode: preserve unknown remainder as opaque payload
 *     (except true boundary violations).
 * - `parseAttachmentDispatchCompat` is intentionally version-tolerant for real-world
 *   mixed streams where wrappers and nested groups may differ by major version.
 */
interface ParsedGroup {
  items: GroupItem[];
  consumed: number;
}

/** Attachment parsing can only proceed in counter domains. */
type ParseDomain = Extract<ColdCode, "txt" | "bny">;
/** Primitive token families used by tuple/repetition parsers. */
type PrimitiveKind = "matter" | "indexer";

/** Minimal nested-group summary shape surfaced by wrapper parsing. */
interface NestedGroupRef {
  code: string;
  name: string;
  count: number;
}

/**
 * Internal attachment payload item model.
 *
 * Notes:
 * - primitive tuples are represented as nested arrays of strings
 * - wrapper payloads may include nested-group summaries
 * - opaque payload fallback units are string (qb64 quadlet) or Uint8Array (qb2 triplet)
 */
type GroupItem = string | Uint8Array | NestedGroupRef | GroupItem[];

/**
 * strict = do not allow version fallback to v1 when v2 parsing fails
 * compat = fall back to try v1 parse if v2 fails
 */
export type AttachmentDispatchMode = "strict" | "compat";

export interface VersionFallbackInfo {
  from: Versionage;
  to: Versionage;
  domain: ParseDomain;
  reason: string;
}

/** Public options for attachment dispatch behavior and fallback observability. */
export interface AttachmentDispatchOptions {
  mode?: AttachmentDispatchMode;
  onVersionFallback?: (info: VersionFallbackInfo) => void;
}

/** Internal execution context propagated across nested dispatch calls. */
interface DispatchContext {
  mode: AttachmentDispatchMode;
  onVersionFallback?: (info: VersionFallbackInfo) => void;
}

/** Parser contract for one attachment-group counter code. */
type GroupParser = (
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: DispatchContext,
) => ParsedGroup;

/** Siger-list counter codes by major version (for nested trans sig group parsing). */
const SIGER_LIST_CODES_BY_VERSION: Record<1 | 2, Set<string>> = {
  1: new Set([
    CtrDexV1.ControllerIdxSigs,
    CtrDexV1.WitnessIdxSigs,
  ]),
  2: new Set([
    CtrDexV2.ControllerIdxSigs,
    CtrDexV2.BigControllerIdxSigs,
    CtrDexV2.WitnessIdxSigs,
    CtrDexV2.BigWitnessIdxSigs,
  ]),
};

/** Wrapper counters in v1 whose payloads are recursively parsed as nested groups. */
const WRAPPER_GROUP_CODES_V1 = new Set([
  CtrDexV1.AttachmentGroup,
  CtrDexV1.BigAttachmentGroup,
  CtrDexV1.BodyWithAttachmentGroup,
  CtrDexV1.BigBodyWithAttachmentGroup,
]);

/** Wrapper counters in v2 whose payloads are recursively parsed as nested groups. */
const WRAPPER_GROUP_CODES_V2 = new Set([
  CtrDexV2.AttachmentGroup,
  CtrDexV2.BigAttachmentGroup,
  CtrDexV2.BodyWithAttachmentGroup,
  CtrDexV2.BigBodyWithAttachmentGroup,
]);

/** Universal genus-version counter code (v1/v2 compatible encoding semantics). */
const GENUS_VERSION_CODE = CtrDexV2.KERIACDCGenusVersion;

/** Domain-sensitive primitive size (qb64 vs qb2). */
function primitiveSize(
  primitive: { fullSize: number; fullSizeB2: number },
  domain: ParseDomain,
): number {
  return domain === "bny" ? primitive.fullSizeB2 : primitive.fullSize;
}

/** Alias for readability at counter header consumption callsites. */
function counterHeaderSize(counter: Counter, domain: ParseDomain): number {
  return primitiveSize(counter, domain);
}

/** Counter count unit size by domain: quadlets in text, triplets in binary. */
function quadletUnitSize(domain: ParseDomain): number {
  return domain === "bny" ? 3 : 4;
}

/** Decode a genus-version counter payload into major/minor `Versionage`. */
function decodeVersionCounter(counter: Counter): Versionage {
  const triplet = counter.qb64.length >= 3
    ? counter.qb64.slice(-3)
    : intToB64(counter.count, 3);
  const majorRaw = b64ToInt(triplet[0] ?? "A");
  const minorRaw = b64ToInt(triplet[1] ?? "A");
  return {
    major: majorRaw === 1 ? 1 : 2,
    minor: minorRaw,
  };
}

/** Parse a fixed primitive tuple shape and return qb64 strings in source order. */
function parseTuple(
  input: Uint8Array,
  kinds: PrimitiveKind[],
  domain: ParseDomain,
): { items: string[]; consumed: number } {
  const items: string[] = [];
  let offset = 0;
  for (const kind of kinds) {
    const part = kind === "indexer"
      ? parseIndexer(input.slice(offset), domain)
      : parseMatter(input.slice(offset), domain);
    items.push(part.qb64);
    offset += primitiveSize(part, domain);
  }
  return { items, consumed: offset };
}

/** Parse `count` tuple repetitions with stable ordering and exact byte accounting. */
function parseRepeated(
  input: Uint8Array,
  count: number,
  kinds: PrimitiveKind[],
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupItem[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const tuple = parseTuple(input.slice(offset), kinds, domain);
    items.push(tuple.items);
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

/** Split opaque counted payload into domain units (quadlets for text, triplets for binary). */
function splitOpaqueUnits(
  payload: Uint8Array,
  domain: ParseDomain,
  expectedCount?: number,
): Array<string | Uint8Array> {
  if (domain === "bny") {
    const count = expectedCount ?? Math.floor(payload.length / 3);
    return Array.from(
      { length: count },
      (_v, i) => payload.slice(i * 3, i * 3 + 3),
    );
  }

  const text = String.fromCharCode(...payload);
  if (expectedCount !== undefined) {
    return Array.from(
      { length: expectedCount },
      (_v, i) => text.slice(i * 4, i * 4 + 4),
    );
  }
  return text.match(/.{1,4}/g) ?? [];
}

/** Parse nested siger-list group headed by a version-appropriate siger counter. */
function parseSigerList(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { items: string[]; consumed: number } {
  const counter = parseCounter(input, version, domain);
  const allowed = SIGER_LIST_CODES_BY_VERSION[version.major];
  if (!allowed.has(counter.code)) {
    throw new UnknownCodeError(
      `Expected siger-list counter but got ${counter.code}`,
    );
  }

  const items: string[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const part = parseIndexer(input.slice(offset), domain);
    items.push(part.qb64);
    offset += primitiveSize(part, domain);
  }

  return { items, consumed: offset };
}

/**
 * Parse quadlet/triplet-counted groups.
 *
 * Behavior:
 * - non-wrapper groups return raw unit chunks (text quadlets or binary triplets).
 * - wrapper groups recurse into nested attachment-group dispatch.
 * - compat mode preserves unread wrapper remainder as opaque units on non-boundary
 *   nested parse errors.
 */
function parseQuadletGroup(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  wrapperCodes: Set<string>,
  domain: ParseDomain,
  context: DispatchContext,
): ParsedGroup {
  const unitSize = quadletUnitSize(domain);
  const payloadSize = counter.count * unitSize;
  const headerSize = counterHeaderSize(counter, domain);
  const total = headerSize + payloadSize;
  if (input.length < total) {
    throw new ShortageError(total, input.length);
  }

  const payload = input.slice(headerSize, total);

  if (wrapperCodes.has(counter.code)) {
    // Wrapper payload is a packed stream of nested groups (best effort).
    const items: GroupItem[] = [];
    let offset = 0;
    let nestedVersion = version;
    while (offset < payload.length) {
      try {
        const nestedCounter = parseCounter(
          payload.slice(offset),
          nestedVersion,
          domain,
        );
        if (nestedCounter.code === GENUS_VERSION_CODE) {
          // Wrapper-scoped version override for subsequent nested groups.
          offset += counterHeaderSize(nestedCounter, domain);
          nestedVersion = decodeVersionCounter(nestedCounter);
          continue;
        }
        const nested = parseAttachmentDispatchCompat(
          // Allow mixed-version nested groups inside wrapper payloads.
          // Some real-world streams wrap v2 groups inside v1 wrappers.
          payload.slice(offset),
          nestedVersion,
          domain,
          context,
        );
        items.push({
          code: nested.group.code,
          name: nested.group.name,
          count: nested.group.count,
        });
        if (nested.consumed === 0) {
          throw new GroupSizeError(
            "Nested attachment parser consumed zero bytes",
          );
        }
        offset += nested.consumed;
      } catch (error) {
        if (
          error instanceof ShortageError ||
          error instanceof GroupSizeError
        ) {
          throw error;
        }
        if (context.mode === "strict") {
          throw error;
        }
        // Intentional recovery point: keep unread wrapper tail as opaque units.
        const remainder = payload.slice(offset);
        const opaque = splitOpaqueUnits(remainder, domain);
        items.push(...opaque);
        offset = payload.length;
      }
    }
    if (offset !== payload.length) {
      throw new GroupSizeError(
        "Nested attachment parsing did not consume exact payload",
      );
    }
    return { items, consumed: total };
  }

  const items = splitOpaqueUnits(payload, domain, counter.count);

  return { items, consumed: total };
}

/** Build parser for repeated tuple-based group families. */
function repeatTupleParser(kinds: PrimitiveKind[]): GroupParser {
  return (
    input: Uint8Array,
    counter: Counter,
    _version: Versionage,
    domain: ParseDomain,
    _context: DispatchContext,
  ): ParsedGroup => {
    const headerSize = counterHeaderSize(counter, domain);
    const parsed = parseRepeated(
      input.slice(headerSize),
      counter.count,
      kinds,
      domain,
    );
    return { items: parsed.items, consumed: parsed.consumed + headerSize };
  };
}

/** Parse transferable indexed-signature groups with a 3-field header + siger list. */
function transIdxSigGroupsParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  _context: DispatchContext,
): ParsedGroup {
  const items: GroupItem[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const header = parseTuple(input.slice(offset), [
      "matter",
      "matter",
      "matter",
    ], domain);
    offset += header.consumed;
    const sigers = parseSigerList(input.slice(offset), version, domain);
    offset += sigers.consumed;
    items.push([...header.items, sigers.items]);
  }
  return { items, consumed: offset };
}

/** Parse transferable last-establishment sig groups with header + siger list. */
function transLastIdxSigGroupsParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  _context: DispatchContext,
): ParsedGroup {
  const items: GroupItem[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const header = parseTuple(input.slice(offset), ["matter"], domain);
    offset += header.consumed;
    const sigers = parseSigerList(input.slice(offset), version, domain);
    offset += sigers.consumed;
    items.push([...header.items, sigers.items]);
  }
  return { items, consumed: offset };
}

/** Parse SadPathSig groups: each path is followed by one nested signature group. */
function sadPathSigParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: DispatchContext,
): ParsedGroup {
  const items: GroupItem[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const path = parseMatter(input.slice(offset), domain);
    offset += primitiveSize(path, domain);
    const sigGroup = parseAttachmentDispatchCompat(
      input.slice(offset),
      version,
      domain,
      context,
    );
    offset += sigGroup.consumed;
    items.push([path.qb64, {
      code: sigGroup.group.code,
      name: sigGroup.group.name,
      count: sigGroup.group.count,
    }]);
  }
  return { items, consumed: offset };
}

/** Parse SadPathSigGroup: root path + repeated (path, nested signature group). */
function sadPathSigGroupParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: DispatchContext,
): ParsedGroup {
  const items: GroupItem[] = [];
  let offset = counterHeaderSize(counter, domain);

  const root = parseMatter(input.slice(offset), domain);
  offset += primitiveSize(root, domain);
  items.push(root.qb64);

  for (let i = 0; i < counter.count; i++) {
    const path = parseMatter(input.slice(offset), domain);
    offset += primitiveSize(path, domain);
    const sigGroup = parseAttachmentDispatchCompat(
      input.slice(offset),
      version,
      domain,
      context,
    );
    offset += sigGroup.consumed;
    items.push([path.qb64, {
      code: sigGroup.group.code,
      name: sigGroup.group.name,
      count: sigGroup.group.count,
    }]);
  }
  return { items, consumed: offset };
}

/** Genus-version groups carry only the counter token itself as semantic payload. */
function genusVersionParser(
  _input: Uint8Array,
  counter: Counter,
  _version: Versionage,
  domain: ParseDomain,
  _context: DispatchContext,
): ParsedGroup {
  return {
    items: [counter.qb64],
    consumed: counterHeaderSize(counter, domain),
  };
}

/** v1 quadlet/triplet parser variant with v1 wrapper-code semantics. */
const V1_QUADLET_PARSER: GroupParser = (
  input,
  counter,
  version,
  domain,
  context,
) =>
  parseQuadletGroup(
    input,
    counter,
    version,
    WRAPPER_GROUP_CODES_V1,
    domain,
    context,
  );

/** v2 quadlet/triplet parser variant with v2 wrapper-code semantics. */
const V2_QUADLET_PARSER: GroupParser = (
  input,
  counter,
  version,
  domain,
  context,
) =>
  parseQuadletGroup(
    input,
    counter,
    version,
    WRAPPER_GROUP_CODES_V2,
    domain,
    context,
  );

/**
 * v1 attachment dispatch table keyed by counter code.
 *
 * This map is the normative parser routing layer for v1 group semantics.
 */
const V1_DISPATCH: Map<string, GroupParser> = new Map([
  // Counted/wrapper payload groups
  [CtrDexV1.GenericGroup, V1_QUADLET_PARSER],
  [CtrDexV1.BigGenericGroup, V1_QUADLET_PARSER],
  [CtrDexV1.BodyWithAttachmentGroup, V1_QUADLET_PARSER],
  [CtrDexV1.BigBodyWithAttachmentGroup, V1_QUADLET_PARSER],
  [CtrDexV1.AttachmentGroup, V1_QUADLET_PARSER],
  [CtrDexV1.BigAttachmentGroup, V1_QUADLET_PARSER],
  [CtrDexV1.NonNativeBodyGroup, V1_QUADLET_PARSER],
  [CtrDexV1.BigNonNativeBodyGroup, V1_QUADLET_PARSER],
  [CtrDexV1.ESSRPayloadGroup, V1_QUADLET_PARSER],
  [CtrDexV1.BigESSRPayloadGroup, V1_QUADLET_PARSER],
  [CtrDexV1.PathedMaterialCouples, V1_QUADLET_PARSER],
  [CtrDexV1.BigPathedMaterialCouples, V1_QUADLET_PARSER],
  // Simple repeated primitive tuple groups
  [CtrDexV1.ControllerIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV1.WitnessIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV1.NonTransReceiptCouples, repeatTupleParser(["matter", "matter"])],
  [
    CtrDexV1.TransReceiptQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "indexer"]),
  ],
  [CtrDexV1.FirstSeenReplayCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV1.SealSourceCouples, repeatTupleParser(["matter", "matter"])],
  [
    CtrDexV1.SealSourceTriples,
    repeatTupleParser(["matter", "matter", "matter"]),
  ],
  // Nested signature-group families
  [CtrDexV1.TransIdxSigGroups, transIdxSigGroupsParser],
  [CtrDexV1.TransLastIdxSigGroups, transLastIdxSigGroupsParser],
  [CtrDexV1.SadPathSig, sadPathSigParser],
  [CtrDexV1.SadPathSigGroup, sadPathSigGroupParser],
  // Stream/genus version marker
  [CtrDexV1.KERIACDCGenusVersion, genusVersionParser],
]);

/**
 * v2 attachment dispatch table keyed by counter code.
 *
 * This map is the normative parser routing layer for v2 group semantics.
 */
const V2_DISPATCH: Map<string, GroupParser> = new Map([
  // Counted/wrapper payload groups
  [CtrDexV2.GenericGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigGenericGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BodyWithAttachmentGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigBodyWithAttachmentGroup, V2_QUADLET_PARSER],
  [CtrDexV2.AttachmentGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigAttachmentGroup, V2_QUADLET_PARSER],
  [CtrDexV2.NonNativeBodyGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigNonNativeBodyGroup, V2_QUADLET_PARSER],
  [CtrDexV2.ESSRPayloadGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigESSRPayloadGroup, V2_QUADLET_PARSER],
  [CtrDexV2.PathedMaterialCouples, V2_QUADLET_PARSER],
  [CtrDexV2.BigPathedMaterialCouples, V2_QUADLET_PARSER],
  [CtrDexV2.DatagramSegmentGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigDatagramSegmentGroup, V2_QUADLET_PARSER],
  [CtrDexV2.ESSRWrapperGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigESSRWrapperGroup, V2_QUADLET_PARSER],
  [CtrDexV2.FixBodyGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigFixBodyGroup, V2_QUADLET_PARSER],
  [CtrDexV2.MapBodyGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigMapBodyGroup, V2_QUADLET_PARSER],
  [CtrDexV2.GenericMapGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigGenericMapGroup, V2_QUADLET_PARSER],
  [CtrDexV2.GenericListGroup, V2_QUADLET_PARSER],
  [CtrDexV2.BigGenericListGroup, V2_QUADLET_PARSER],
  // Simple repeated primitive tuple groups
  [CtrDexV2.ControllerIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.BigControllerIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.WitnessIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.BigWitnessIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.NonTransReceiptCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigNonTransReceiptCouples, repeatTupleParser(["matter", "matter"])],
  [
    CtrDexV2.TransReceiptQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "indexer"]),
  ],
  [
    CtrDexV2.BigTransReceiptQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "indexer"]),
  ],
  [CtrDexV2.FirstSeenReplayCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigFirstSeenReplayCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.SealSourceCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigSealSourceCouples, repeatTupleParser(["matter", "matter"])],
  [
    CtrDexV2.SealSourceTriples,
    repeatTupleParser(["matter", "matter", "matter"]),
  ],
  [
    CtrDexV2.BigSealSourceTriples,
    repeatTupleParser(["matter", "matter", "matter"]),
  ],
  [CtrDexV2.SealSourceLastSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BigSealSourceLastSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.DigestSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BigDigestSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.MerkleRootSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BigMerkleRootSealSingles, repeatTupleParser(["matter"])],
  [
    CtrDexV2.BackerRegistrarSealCouples,
    repeatTupleParser(["matter", "matter"]),
  ],
  [
    CtrDexV2.BigBackerRegistrarSealCouples,
    repeatTupleParser(["matter", "matter"]),
  ],
  [CtrDexV2.TypedDigestSealCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigTypedDigestSealCouples, repeatTupleParser(["matter", "matter"])],
  // Nested signature-group families
  [CtrDexV2.TransIdxSigGroups, transIdxSigGroupsParser],
  [CtrDexV2.BigTransIdxSigGroups, transIdxSigGroupsParser],
  [CtrDexV2.TransLastIdxSigGroups, transLastIdxSigGroupsParser],
  [CtrDexV2.BigTransLastIdxSigGroups, transLastIdxSigGroupsParser],
  [
    CtrDexV2.BlindedStateQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "matter"]),
  ],
  [
    CtrDexV2.BigBlindedStateQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "matter"]),
  ],
  [
    CtrDexV2.BoundStateSextuples,
    repeatTupleParser([
      "matter",
      "matter",
      "matter",
      "matter",
      "matter",
      "matter",
    ]),
  ],
  [
    CtrDexV2.BigBoundStateSextuples,
    repeatTupleParser([
      "matter",
      "matter",
      "matter",
      "matter",
      "matter",
      "matter",
    ]),
  ],
  [
    CtrDexV2.TypedMediaQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "matter"]),
  ],
  [
    CtrDexV2.BigTypedMediaQuadruples,
    repeatTupleParser(["matter", "matter", "matter", "matter"]),
  ],
  // Stream/genus version marker
  [CtrDexV2.KERIACDCGenusVersion, genusVersionParser],
]);

/** Select major-version dispatch table (v2 for major >= 2). */
function getDispatch(version: Versionage): Map<string, GroupParser> {
  return version.major >= 2 ? V2_DISPATCH : V1_DISPATCH;
}

/** Parse one attachment group with an explicit version (no version fallback). */
function parseAttachmentDispatchWithVersion(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  context: DispatchContext,
): { group: AttachmentGroup; consumed: number } {
  const counter = parseCounter(input, version, domain);
  const parser = getDispatch(version).get(counter.code);

  if (!parser) {
    throw new UnknownCodeError(
      `Unsupported attachment group code ${counter.code} (${counter.name})`,
    );
  }

  const parsed = parser(input, counter, version, domain, context);

  if (parsed.consumed > input.length) {
    throw new GroupSizeError(
      `Parsed beyond input boundary for ${counter.code}`,
    );
  }

  return {
    group: {
      code: counter.code,
      name: counter.name,
      count: counter.count,
      raw: input.slice(0, parsed.consumed),
      items: parsed.items,
    },
    consumed: parsed.consumed,
  };
}

/**
 * Parse one attachment group using strict/compat mode semantics.
 *
 * Compat mode retries parse with alternate major version only on unknown-code or
 * deserialize failures, and reports fallback via callback or warning.
 */
function parseAttachmentDispatchByMode(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  context: DispatchContext,
): { group: AttachmentGroup; consumed: number } {
  if (context.mode === "strict") {
    return parseAttachmentDispatchWithVersion(input, version, domain, context);
  }

  // support version fallback with the alternate version, usually 1.0, and warn
  // or call the version fallback callback defined by the caller.
  try {
    return parseAttachmentDispatchWithVersion(input, version, domain, context);
  } catch (error) {
    if (
      !(error instanceof UnknownCodeError) &&
      !(error instanceof DeserializeError)
    ) {
      throw error;
    }
    const alternate: Versionage = version.major >= 2
      ? { major: 1, minor: 0 }
      : { major: 2, minor: 0 };
    const info: VersionFallbackInfo = {
      from: version,
      to: alternate,
      domain,
      reason: error.message,
    };
    if (context.onVersionFallback) {
      context.onVersionFallback(info);
    } else {
      console.warn(
        `CESR attachment dispatch fallback ${version.major}.${version.minor} -> ${alternate.major}.${alternate.minor} (${domain}): ${error.message}`,
      );
    }
    return parseAttachmentDispatchWithVersion(
      input,
      alternate,
      domain,
      context,
    );
  }
}

/**
 * Parse with primary version, then retry with the alternate major on unknown
 * code/deserialize failures. This mirrors real-world mixed-stream tolerance.
 */
export function parseAttachmentDispatchCompat(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  options: AttachmentDispatchOptions = {},
): { group: AttachmentGroup; consumed: number } {
  const context: DispatchContext = {
    mode: options.mode ?? "compat",
    onVersionFallback: options.onVersionFallback,
  };
  return parseAttachmentDispatchByMode(input, version, domain, context);
}

/** Strict versioned attachment-group dispatch (no major-version fallback). */
export function parseAttachmentDispatch(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { group: AttachmentGroup; consumed: number } {
  return parseAttachmentDispatchByMode(input, version, domain, {
    mode: "strict",
  });
}
