import { b, b64ToInt, intToB64 } from "../core/bytes.ts";
import { GroupSizeError, ShortageError, UnknownCodeError } from "../core/errors.ts";
import { composeRecoveryDiagnosticObserver, type RecoveryDiagnosticObserver } from "../core/recovery-diagnostics.ts";
import type { AttachmentGroup } from "../core/types.ts";
import { Counter, CounterGroup, parseCounter } from "../primitives/counter.ts";
import { parseIndexer } from "../primitives/indexer.ts";
import { parseMatter } from "../primitives/matter.ts";
import type { GroupEntry } from "../primitives/primitive.ts";
import { UnknownPrimitive } from "../primitives/unknown.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import { resolveVersionedRegistryValue, type VersionedRegistry } from "../tables/counter-version-registry.ts";
import type { Versionage } from "../tables/table-types.ts";
import {
  type AttachmentDispatchDomain,
  type AttachmentVersionFallbackPolicy,
  type AttachmentVersionFallbackPolicyOptions,
  createAttachmentVersionFallbackPolicy,
} from "./attachment-fallback-policy.ts";
export { createAttachmentVersionFallbackPolicy } from "./attachment-fallback-policy.ts";
export type {
  AttachmentDispatchMode,
  AttachmentVersionFallbackPolicy,
  VersionDispatchDecision,
  VersionFallbackInfo,
} from "./attachment-fallback-policy.ts";

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
  items: GroupEntry[];
  consumed: number;
}

/** Attachment parsing can only proceed in counter domains. */
type ParseDomain = AttachmentDispatchDomain;
/** Primitive token families used by tuple/repetition parsers. */
type PrimitiveKind = "matter" | "indexer";

function tupleItem(items: GroupEntry[]): GroupEntry {
  return items;
}

/** Normalize unknown throwables to an `Error` for diagnostic emission. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Public options for attachment dispatch behavior and fallback observability.
 *
 * Precedence:
 * 1) `versionFallbackPolicy` when provided (fully explicit strategy injection)
 * 2) otherwise build default strategy from `mode` and adapt
 *    `onVersionFallback` into structured diagnostics.
 */
export interface AttachmentDispatchOptions extends AttachmentVersionFallbackPolicyOptions {
  /** Explicit strategy override for fallback + wrapper remainder decisions. */
  versionFallbackPolicy?: AttachmentVersionFallbackPolicy;
  /** Structured recovery diagnostics observer. */
  onRecoveryDiagnostic?: RecoveryDiagnosticObserver;
}

/**
 * Policy context propagated through nested attachment-group dispatch recursion.
 *
 * This currently carries only fallback/recovery policy, but remains a named
 * object so additional policy knobs can be threaded without widening every
 * parser signature again.
 */
interface AttachmentDispatchPolicyContext {
  versionFallbackPolicy: AttachmentVersionFallbackPolicy;
  recoveryDiagnosticObserver?: RecoveryDiagnosticObserver;
}

/** Parser contract for one attachment-group counter code. */
type GroupParser = (
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchPolicyContext,
) => ParsedGroup;

/**
 * Dispatch table major-version discriminator.
 *
 * Invariant:
 * all dispatch artifacts in this module are built for exactly these two major
 * versions; runtime fallback policy decides when/if cross-version retry occurs.
 */
type DispatchVersion = 1 | 2;

/**
 * Parser family keys used to map descriptor entries to concrete parser functions.
 *
 * Maintainer rule:
 * adding a new parser family requires touching this union and
 * `parserForDescriptor(...)` together so routing remains exhaustive.
 */
type DispatchParserKind =
  | "genusVersion"
  | "quadlet"
  | "repeatTuple"
  | "transIdxSigGroups"
  | "transLastIdxSigGroups"
  | "sadPathSig"
  | "sadPathSigGroup";

/**
 * Semantic classification for descriptor entries.
 *
 * This metadata is intentionally domain-facing (review/debug/docs) and does not
 * alter parser behavior by itself. Behavioral switches are driven only by
 * `parserKind`, `tupleKinds`, `wrapperGroup`, and `allowsSigerList`.
 */
type DispatchSemanticShape =
  | "genusVersionMarker"
  | "countedGroupPayload"
  | "wrapperGroupPayload"
  | "primitiveTuples"
  | "signatureGroupTuples"
  | "lastSignatureGroupTuples"
  | "sadPathSignatures"
  | "sadPathSignatureGroup";

/**
 * Authoring-time dispatch spec row.
 *
 * This form groups equivalent parser semantics across major versions to reduce
 * duplicate declarations in the canonical spec constant.
 */
interface DispatchFamilySpec {
  parserKind: DispatchParserKind;
  semanticShape: DispatchSemanticShape;
  codesByVersion: Partial<Record<DispatchVersion, readonly string[]>>;
  tupleKinds?: readonly PrimitiveKind[];
  wrapperGroup?: boolean;
  allowsSigerList?: boolean;
}

/**
 * Fully expanded dispatch descriptor for a single `(major, code)` pair.
 *
 * Invariant:
 * every descriptor entry must resolve to exactly one `GroupParser`.
 */
interface DispatchDescriptor {
  version: DispatchVersion;
  code: string;
  parserKind: DispatchParserKind;
  semanticShape: DispatchSemanticShape;
  tupleKinds?: readonly PrimitiveKind[];
  wrapperGroup: boolean;
  allowsSigerList: boolean;
}

/**
 * Canonical attachment dispatch specification (authoring form).
 *
 * This is the single source of truth for:
 * - code -> parser routing
 * - semantic shape classification
 * - wrapper-group recursion eligibility
 * - nested siger-list allowance
 *
 * Maintainer workflow:
 * when adding/removing a counter route, edit this constant only, then rely on
 * descriptor expansion + generated dispatch maps below.
 */
export const ATTACHMENT_DISPATCH_SPEC: readonly DispatchFamilySpec[] = [
  {
    parserKind: "genusVersion",
    semanticShape: "genusVersionMarker",
    codesByVersion: {
      1: [CtrDexV1.KERIACDCGenusVersion],
      2: [CtrDexV2.KERIACDCGenusVersion],
    },
  },
  {
    parserKind: "quadlet",
    semanticShape: "countedGroupPayload",
    codesByVersion: {
      1: [
        CtrDexV1.GenericGroup,
        CtrDexV1.BigGenericGroup,
        CtrDexV1.NonNativeBodyGroup,
        CtrDexV1.BigNonNativeBodyGroup,
        CtrDexV1.ESSRPayloadGroup,
        CtrDexV1.BigESSRPayloadGroup,
        CtrDexV1.PathedMaterialCouples,
        CtrDexV1.BigPathedMaterialCouples,
      ],
      2: [
        CtrDexV2.GenericGroup,
        CtrDexV2.BigGenericGroup,
        CtrDexV2.NonNativeBodyGroup,
        CtrDexV2.BigNonNativeBodyGroup,
        CtrDexV2.ESSRPayloadGroup,
        CtrDexV2.BigESSRPayloadGroup,
        CtrDexV2.PathedMaterialCouples,
        CtrDexV2.BigPathedMaterialCouples,
        CtrDexV2.DatagramSegmentGroup,
        CtrDexV2.BigDatagramSegmentGroup,
        CtrDexV2.ESSRWrapperGroup,
        CtrDexV2.BigESSRWrapperGroup,
        CtrDexV2.FixBodyGroup,
        CtrDexV2.BigFixBodyGroup,
        CtrDexV2.MapBodyGroup,
        CtrDexV2.BigMapBodyGroup,
        CtrDexV2.GenericMapGroup,
        CtrDexV2.BigGenericMapGroup,
        CtrDexV2.GenericListGroup,
        CtrDexV2.BigGenericListGroup,
      ],
    },
  },
  {
    parserKind: "quadlet",
    semanticShape: "wrapperGroupPayload",
    wrapperGroup: true,
    codesByVersion: {
      1: [
        CtrDexV1.AttachmentGroup,
        CtrDexV1.BigAttachmentGroup,
        CtrDexV1.BodyWithAttachmentGroup,
        CtrDexV1.BigBodyWithAttachmentGroup,
      ],
      2: [
        CtrDexV2.AttachmentGroup,
        CtrDexV2.BigAttachmentGroup,
        CtrDexV2.BodyWithAttachmentGroup,
        CtrDexV2.BigBodyWithAttachmentGroup,
      ],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["indexer"],
    allowsSigerList: true,
    codesByVersion: {
      1: [
        CtrDexV1.ControllerIdxSigs,
        CtrDexV1.WitnessIdxSigs,
      ],
      2: [
        CtrDexV2.ControllerIdxSigs,
        CtrDexV2.BigControllerIdxSigs,
        CtrDexV2.WitnessIdxSigs,
        CtrDexV2.BigWitnessIdxSigs,
      ],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["matter", "matter"],
    codesByVersion: {
      1: [
        CtrDexV1.NonTransReceiptCouples,
        CtrDexV1.FirstSeenReplayCouples,
        CtrDexV1.SealSourceCouples,
      ],
      2: [
        CtrDexV2.NonTransReceiptCouples,
        CtrDexV2.BigNonTransReceiptCouples,
        CtrDexV2.FirstSeenReplayCouples,
        CtrDexV2.BigFirstSeenReplayCouples,
        CtrDexV2.SealSourceCouples,
        CtrDexV2.BigSealSourceCouples,
        CtrDexV2.BackerRegistrarSealCouples,
        CtrDexV2.BigBackerRegistrarSealCouples,
        CtrDexV2.TypedDigestSealCouples,
        CtrDexV2.BigTypedDigestSealCouples,
      ],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["matter", "matter", "matter", "indexer"],
    codesByVersion: {
      1: [
        CtrDexV1.TransReceiptQuadruples,
      ],
      2: [
        CtrDexV2.TransReceiptQuadruples,
        CtrDexV2.BigTransReceiptQuadruples,
      ],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["matter", "matter", "matter"],
    codesByVersion: {
      1: [
        CtrDexV1.SealSourceTriples,
      ],
      2: [
        CtrDexV2.SealSourceTriples,
        CtrDexV2.BigSealSourceTriples,
      ],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["matter"],
    codesByVersion: {
      2: [
        CtrDexV2.SealSourceLastSingles,
        CtrDexV2.BigSealSourceLastSingles,
        CtrDexV2.DigestSealSingles,
        CtrDexV2.BigDigestSealSingles,
        CtrDexV2.MerkleRootSealSingles,
        CtrDexV2.BigMerkleRootSealSingles,
      ],
    },
  },
  {
    parserKind: "transIdxSigGroups",
    semanticShape: "signatureGroupTuples",
    codesByVersion: {
      1: [
        CtrDexV1.TransIdxSigGroups,
      ],
      2: [
        CtrDexV2.TransIdxSigGroups,
        CtrDexV2.BigTransIdxSigGroups,
      ],
    },
  },
  {
    parserKind: "transLastIdxSigGroups",
    semanticShape: "lastSignatureGroupTuples",
    codesByVersion: {
      1: [
        CtrDexV1.TransLastIdxSigGroups,
      ],
      2: [
        CtrDexV2.TransLastIdxSigGroups,
        CtrDexV2.BigTransLastIdxSigGroups,
      ],
    },
  },
  {
    parserKind: "sadPathSig",
    semanticShape: "sadPathSignatures",
    codesByVersion: {
      1: [CtrDexV1.SadPathSig],
    },
  },
  {
    parserKind: "sadPathSigGroup",
    semanticShape: "sadPathSignatureGroup",
    codesByVersion: {
      1: [CtrDexV1.SadPathSigGroup],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["matter", "matter", "matter", "matter"],
    codesByVersion: {
      2: [
        CtrDexV2.BlindedStateQuadruples,
        CtrDexV2.BigBlindedStateQuadruples,
        CtrDexV2.TypedMediaQuadruples,
        CtrDexV2.BigTypedMediaQuadruples,
      ],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: [
      "matter",
      "matter",
      "matter",
      "matter",
      "matter",
      "matter",
    ],
    codesByVersion: {
      2: [
        CtrDexV2.BoundStateSextuples,
        CtrDexV2.BigBoundStateSextuples,
      ],
    },
  },
];

/**
 * Expand grouped spec rows into per-version descriptors.
 *
 * Why:
 * downstream builders operate on `(version, code)` units, while spec authoring
 * stays concise by grouping shared semantics across major versions.
 */
function expandDispatchSpec(
  spec: readonly DispatchFamilySpec[],
): DispatchDescriptor[] {
  const descriptors: DispatchDescriptor[] = [];
  for (const family of spec) {
    for (const version of [1, 2] as const) {
      for (const code of family.codesByVersion[version] ?? []) {
        descriptors.push({
          version,
          code,
          parserKind: family.parserKind,
          semanticShape: family.semanticShape,
          tupleKinds: family.tupleKinds,
          wrapperGroup: family.wrapperGroup === true,
          allowsSigerList: family.allowsSigerList === true,
        });
      }
    }
  }
  return descriptors;
}

/**
 * Build a version-indexed code-set projection from descriptors.
 *
 * Used for secondary routing metadata (wrapper recursion/siger-list allowance)
 * so those sets cannot drift from the canonical dispatch spec.
 */
function buildCodeSetByVersion(
  descriptors: readonly DispatchDescriptor[],
  predicate: (descriptor: DispatchDescriptor) => boolean,
): Record<DispatchVersion, Set<string>> {
  const byVersion: Record<DispatchVersion, Set<string>> = {
    1: new Set<string>(),
    2: new Set<string>(),
  };
  for (const descriptor of descriptors) {
    if (predicate(descriptor)) {
      byVersion[descriptor.version].add(descriptor.code);
    }
  }
  return byVersion;
}

/**
 * Normalized per-code dispatch descriptors used by all derived routing tables.
 *
 * Invariant:
 * this array is generated once at module load from `ATTACHMENT_DISPATCH_SPEC`
 * and should not be hand-edited.
 */
const ATTACHMENT_DISPATCH_DESCRIPTORS = expandDispatchSpec(
  ATTACHMENT_DISPATCH_SPEC,
);

/** Siger-list counter codes by major version (for nested trans sig group parsing). */
const SIGER_LIST_CODES_BY_MAJOR = buildCodeSetByVersion(
  ATTACHMENT_DISPATCH_DESCRIPTORS,
  (descriptor) => descriptor.allowsSigerList,
);

/** Wrapper counters by major version whose payloads recurse as nested groups. */
const WRAPPER_GROUP_CODES_BY_MAJOR = buildCodeSetByVersion(
  ATTACHMENT_DISPATCH_DESCRIPTORS,
  (descriptor) => descriptor.wrapperGroup,
);
const WRAPPER_GROUP_CODES_V1 = WRAPPER_GROUP_CODES_BY_MAJOR[1];
const WRAPPER_GROUP_CODES_V2 = WRAPPER_GROUP_CODES_BY_MAJOR[2];

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
  kinds: readonly PrimitiveKind[],
  domain: ParseDomain,
): { items: GroupEntry[]; consumed: number } {
  const items: GroupEntry[] = [];
  let offset = 0;
  for (const kind of kinds) {
    const part = kind === "indexer"
      ? parseIndexer(input.slice(offset), domain)
      : parseMatter(input.slice(offset), domain);
    items.push(part);
    offset += primitiveSize(part, domain);
  }
  return { items, consumed: offset };
}

/** Parse `count` tuple repetitions with stable ordering and exact byte accounting. */
function parseRepeated(
  input: Uint8Array,
  count: number,
  kinds: readonly PrimitiveKind[],
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const tuple = parseTuple(input.slice(offset), kinds, domain);
    items.push(tupleItem(tuple.items));
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

/** Split opaque counted payload into domain units (quadlets for text, triplets for binary). */
function splitOpaqueUnits(
  payload: Uint8Array,
  domain: ParseDomain,
  expectedCount?: number,
): GroupEntry[] {
  if (domain === "bny") {
    const count = expectedCount ?? Math.floor(payload.length / 3);
    return Array.from(
      { length: count },
      (_v, i) =>
        UnknownPrimitive.fromPayload(
          payload.slice(i * 3, i * 3 + 3),
          domain,
        ),
    );
  }

  const text = String.fromCharCode(...payload);
  if (expectedCount !== undefined) {
    return Array.from(
      { length: expectedCount },
      (_v, i) =>
        UnknownPrimitive.fromPayload(
          b(text.slice(i * 4, i * 4 + 4)),
          domain,
        ),
    );
  }
  return (text.match(/.{1,4}/g) ?? []).map((token) => UnknownPrimitive.fromPayload(b(token), domain));
}

/** Parse nested siger-list group headed by a version-appropriate siger counter. */
function parseSigerList(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { items: GroupEntry[]; consumed: number } {
  const counter = parseCounter(input, version, domain);
  const allowed = resolveVersionedRegistryValue(
    SIGER_LIST_CODES_BY_VERSION,
    version,
    "siger-list code set",
  ).value;
  if (!allowed.has(counter.code)) {
    throw new UnknownCodeError(
      `Expected siger-list counter but got ${counter.code}`,
    );
  }

  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const part = parseIndexer(input.slice(offset), domain);
    items.push(part);
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
  context: AttachmentDispatchPolicyContext,
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
    const items: GroupEntry[] = [];
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
        items.push(nested.group);
        if (nested.consumed === 0) {
          throw new GroupSizeError(
            "Nested attachment parser consumed zero bytes",
          );
        }
        offset += nested.consumed;
      } catch (error) {
        const normalized = asError(error);
        if (
          normalized instanceof ShortageError
          || normalized instanceof GroupSizeError
        ) {
          throw normalized;
        }
        if (
          !context.versionFallbackPolicy.shouldPreserveWrapperRemainder(
            normalized,
          )
        ) {
          throw normalized;
        }
        // Intentional recovery point: keep unread wrapper tail as opaque units.
        const remainder = payload.slice(offset);
        const opaque = splitOpaqueUnits(remainder, domain);
        context.recoveryDiagnosticObserver?.({
          type: "wrapper-opaque-tail-preserved",
          version: nestedVersion,
          domain,
          wrapperCode: counter.code,
          opaqueItemCount: opaque.length,
          errorName: normalized.name,
          reason: normalized.message,
        });
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
function repeatTupleParser(kinds: readonly PrimitiveKind[]): GroupParser {
  return (
    input: Uint8Array,
    counter: Counter,
    _version: Versionage,
    domain: ParseDomain,
    _context: AttachmentDispatchPolicyContext,
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
  _context: AttachmentDispatchPolicyContext,
): ParsedGroup {
  const items: GroupEntry[] = [];
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
    items.push(tupleItem([...header.items, tupleItem(sigers.items)]));
  }
  return { items, consumed: offset };
}

/** Parse transferable last-establishment sig groups with header + siger list. */
function transLastIdxSigGroupsParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  _context: AttachmentDispatchPolicyContext,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const header = parseTuple(input.slice(offset), ["matter"], domain);
    offset += header.consumed;
    const sigers = parseSigerList(input.slice(offset), version, domain);
    offset += sigers.consumed;
    items.push(tupleItem([...header.items, tupleItem(sigers.items)]));
  }
  return { items, consumed: offset };
}

/** Parse SadPathSig groups: each path is followed by one nested signature group. */
function sadPathSigParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchPolicyContext,
): ParsedGroup {
  const items: GroupEntry[] = [];
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
    items.push(
      tupleItem([
        path,
        sigGroup.group,
      ]),
    );
  }
  return { items, consumed: offset };
}

/** Parse SadPathSigGroup: root path + repeated (path, nested signature group). */
function sadPathSigGroupParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchPolicyContext,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);

  const root = parseMatter(input.slice(offset), domain);
  offset += primitiveSize(root, domain);
  items.push(root);

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
    items.push(
      tupleItem([
        path,
        sigGroup.group,
      ]),
    );
  }
  return { items, consumed: offset };
}

/** Genus-version groups carry only the counter token itself as semantic payload. */
function genusVersionParser(
  _input: Uint8Array,
  counter: Counter,
  _version: Versionage,
  domain: ParseDomain,
  _context: AttachmentDispatchPolicyContext,
): ParsedGroup {
  return {
    items: [counter],
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
 * Parser instance cache keyed by tuple shape (`matter|indexer|...`).
 *
 * Why:
 * many codes share identical repeated-tuple semantics; caching preserves one
 * parser closure per tuple shape and keeps dispatch-map construction stable.
 */
const REPEAT_TUPLE_PARSER_CACHE = new Map<string, GroupParser>();

/**
 * Resolve one expanded descriptor into its executable parser function.
 *
 * Invariant:
 * this switch must remain exhaustive over `DispatchParserKind`.
 */
function parserForDescriptor(descriptor: DispatchDescriptor): GroupParser {
  switch (descriptor.parserKind) {
    case "quadlet":
      return descriptor.version === 2 ? V2_QUADLET_PARSER : V1_QUADLET_PARSER;
    case "repeatTuple": {
      if (!descriptor.tupleKinds || descriptor.tupleKinds.length === 0) {
        throw new Error(
          `Dispatch descriptor ${descriptor.code} is missing tupleKinds`,
        );
      }
      const key = descriptor.tupleKinds.join("|");
      let parser = REPEAT_TUPLE_PARSER_CACHE.get(key);
      if (!parser) {
        parser = repeatTupleParser(descriptor.tupleKinds);
        REPEAT_TUPLE_PARSER_CACHE.set(key, parser);
      }
      return parser;
    }
    case "transIdxSigGroups":
      return transIdxSigGroupsParser;
    case "transLastIdxSigGroups":
      return transLastIdxSigGroupsParser;
    case "sadPathSig":
      return sadPathSigParser;
    case "sadPathSigGroup":
      return sadPathSigGroupParser;
    case "genusVersion":
      return genusVersionParser;
  }
}

/**
 * Build major-version dispatch maps from normalized descriptors.
 *
 * Invariant:
 * each code appears at most once per major version in the final maps; if a code
 * were duplicated in descriptors, later entries would overwrite earlier ones.
 */
function buildDispatchByVersion(
  descriptors: readonly DispatchDescriptor[],
): Record<DispatchVersion, Map<string, GroupParser>> {
  const dispatch: Record<DispatchVersion, Map<string, GroupParser>> = {
    1: new Map<string, GroupParser>(),
    2: new Map<string, GroupParser>(),
  };
  for (const descriptor of descriptors) {
    dispatch[descriptor.version].set(
      descriptor.code,
      parserForDescriptor(descriptor),
    );
  }
  return dispatch;
}

/** Generated dispatch maps keyed by major version. */
const DISPATCH_BY_MAJOR = buildDispatchByVersion(
  ATTACHMENT_DISPATCH_DESCRIPTORS,
);

/**
 * Lift major-indexed artifacts into a major+minor registry.
 *
 * Current parser supports one minor (`0`) per major, but this keeps lookup
 * contracts explicit and ready for minor-version progression.
 */
function asMinorZeroRegistry<T>(
  byMajor: Record<DispatchVersion, T>,
): VersionedRegistry<T> {
  return Object.freeze({
    1: Object.freeze({ 0: byMajor[1] }),
    2: Object.freeze({ 0: byMajor[2] }),
  });
}

/** Siger-list counter code sets resolved by major+minor stream version. */
const SIGER_LIST_CODES_BY_VERSION = asMinorZeroRegistry(
  SIGER_LIST_CODES_BY_MAJOR,
);
/** Attachment-group dispatch registry resolved by major+minor stream version. */
const DISPATCH_BY_VERSION = asMinorZeroRegistry(DISPATCH_BY_MAJOR);

/** Resolve attachment dispatch table for the requested stream version. */
function getDispatch(version: Versionage): Map<string, GroupParser> {
  return resolveVersionedRegistryValue(
    DISPATCH_BY_VERSION,
    version,
    "attachment dispatch registry",
  ).value;
}

/** Parse one attachment group with an explicit version (no version fallback). */
function parseAttachmentDispatchWithVersion(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchPolicyContext,
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
    group: new CounterGroup(
      counter,
      input.slice(0, parsed.consumed),
      parsed.items,
    ),
    consumed: parsed.consumed,
  };
}

/**
 * Parse one attachment group using an injected fallback strategy.
 *
 * Flow:
 * 1) attempt parse with provided version
 * 2) ask policy whether failure is terminal or retryable
 * 3) on retry, emit fallback observation and parse with policy-selected version
 */
function parseAttachmentDispatchWithPolicy(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchPolicyContext,
): { group: AttachmentGroup; consumed: number } {
  try {
    return parseAttachmentDispatchWithVersion(input, version, domain, context);
  } catch (error) {
    const normalized = asError(error);
    const decision = context.versionFallbackPolicy.onVersionDispatchFailure(
      normalized,
      version,
      domain,
    );
    if (decision.action === "throw") {
      context.recoveryDiagnosticObserver?.({
        type: "version-fallback-rejected",
        version,
        domain,
        errorName: normalized.name,
        reason: normalized.message,
      });
      throw normalized;
    }
    context.recoveryDiagnosticObserver?.({
      type: "version-fallback-accepted",
      from: decision.info.from,
      to: decision.info.to,
      domain: decision.info.domain,
      reason: decision.info.reason,
    });
    context.versionFallbackPolicy.onVersionFallback(decision.info);
    return parseAttachmentDispatchWithVersion(
      input,
      decision.retryVersion,
      domain,
      context,
    );
  }
}

/**
 * Parse one attachment group with policy-aware fallback behavior.
 *
 * By default this uses compat policy semantics to mirror historical
 * `parseAttachmentDispatchCompat` behavior unless overridden via
 * `options.versionFallbackPolicy`.
 */
export function parseAttachmentDispatchCompat(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  options: AttachmentDispatchOptions = {},
): { group: AttachmentGroup; consumed: number } {
  const versionFallbackPolicy = options.versionFallbackPolicy
    ?? createAttachmentVersionFallbackPolicy({
      mode: options.mode,
    });
  const recoveryDiagnosticObserver = composeRecoveryDiagnosticObserver({
    onRecoveryDiagnostic: options.onRecoveryDiagnostic,
    onAttachmentVersionFallback: options.versionFallbackPolicy
      ? undefined
      : options.onVersionFallback,
  });
  const context: AttachmentDispatchPolicyContext = {
    versionFallbackPolicy,
    recoveryDiagnosticObserver,
  };
  return parseAttachmentDispatchWithPolicy(input, version, domain, context);
}

/**
 * Parse one attachment group with strict fail-fast semantics.
 *
 * Why:
 * this API guarantees no major-version fallback and no wrapper opaque-tail
 * preservation, matching parity/validation use cases.
 */
export function parseAttachmentDispatch(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { group: AttachmentGroup; consumed: number } {
  return parseAttachmentDispatchWithPolicy(input, version, domain, {
    versionFallbackPolicy: createAttachmentVersionFallbackPolicy({
      mode: "strict",
    }),
  });
}
