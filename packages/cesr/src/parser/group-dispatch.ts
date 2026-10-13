import { b } from "../core/bytes.ts";
import { GroupSizeError, ShortageError, UnknownCodeError, VersionError } from "../core/errors.ts";
import type { AttachmentGroup } from "../core/types.ts";
import { type Counter, CounterGroup, decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import { parseIndexer } from "../primitives/indexer.ts";
import { parseMatter } from "../primitives/matter.ts";
import type { GroupEntry } from "../primitives/primitive.ts";
import { parseTexter } from "../primitives/texter.ts";
import { UnknownPrimitive } from "../primitives/unknown.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import {
  resolveCtrDex,
  resolveVersionedRegistryValue,
  type VersionedRegistry,
} from "../tables/counter-version-registry.ts";
import type { Versionage } from "../tables/table-types.ts";

/**
 * Counter-group dispatcher for attachment payload parsing.
 *
 * Design notes:
 * - Dispatch is table-driven by major CESR version.
 * - Wrapper groups attempt nested parsing.
 *   - `strict` mode: fail-fast on any nested parse error.
 *   - `compat` mode: preserve unknown remainder as opaque payload
 *     (except true boundary violations).
 * - Every group is decoded under the selected version; failures never trigger
 *   a retry under another major version.
 */
interface ParsedGroup {
  items: GroupEntry[];
  consumed: number;
}

/** Attachment parsing can only proceed in counter domains. */
type ParseDomain = "txt" | "bny";
/** Wrapper-tail handling; both modes decode only the selected version. */
export type AttachmentDispatchMode = "strict" | "compat";
/** Primitive token families used by tuple/repetition parsers. */
type PrimitiveKind = "matter" | "indexer";

function tupleItem(items: GroupEntry[]): GroupEntry {
  return items;
}

/** Normalize unknown throwables for wrapper error handling. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Wrapper recovery options; attachment dispatch never retries another version. */
export interface AttachmentDispatchOptions {
  /** Compat preserves opaque wrapper tails; strict propagates nested errors. */
  mode?: AttachmentDispatchMode;
}

/** Parser contract for one attachment-group counter code. */
type GroupParser = (
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchOptions,
) => ParsedGroup;

/**
 * Dispatch table major-version discriminator.
 *
 * Invariant:
 * all dispatch artifacts in this module are built for exactly these two major
 * versions; the selected version determines the only table used for dispatch.
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
  | "essr"
  | "transIdxSigGroups"
  | "transLastIdxSigGroups"
  | "sadPathSig"
  | "sadPathSigGroup";

/**
 * Semantic classification for descriptor entries.
 *
 * This metadata is intentionally domain-facing (review/debug/docs) and does not
 * alter parser behavior by itself. Behavioral switches are driven only by
 * `parserKind`, `tupleKinds`, and `wrapperGroup`.
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
}

/**
 * Canonical attachment dispatch specification (authoring form).
 *
 * This is the single source of truth for:
 * - code -> parser routing
 * - semantic shape classification
 * - wrapper-group recursion eligibility
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
        CtrDexV1.PathedMaterialCouples,
        CtrDexV1.BigPathedMaterialCouples,
      ],
      2: [
        CtrDexV2.GenericGroup,
        CtrDexV2.BigGenericGroup,
        CtrDexV2.NonNativeBodyGroup,
        CtrDexV2.BigNonNativeBodyGroup,
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
    parserKind: "essr",
    semanticShape: "countedGroupPayload",
    codesByVersion: {
      1: [CtrDexV1.ESSRPayloadGroup, CtrDexV1.BigESSRPayloadGroup],
      2: [CtrDexV2.ESSRPayloadGroup, CtrDexV2.BigESSRPayloadGroup],
    },
  },
  {
    parserKind: "repeatTuple",
    semanticShape: "primitiveTuples",
    tupleKinds: ["indexer"],
    codesByVersion: {
      1: [CtrDexV1.ControllerIdxSigs, CtrDexV1.WitnessIdxSigs],
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
        });
      }
    }
  }
  return descriptors;
}

/**
 * Build a version-indexed code-set projection from descriptors.
 *
 * Used for secondary routing metadata (wrapper recursion)
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

/** Parse the declared number of v1 tuples after the counter header. */
function parseTuplesV1(
  input: Uint8Array,
  counter: Counter,
  kinds: readonly PrimitiveKind[],
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const tuple = parseTuple(input.slice(offset), kinds, domain);
    items.push(tupleItem(tuple.items));
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

/** Exhaust a v2 tuple group already bounded to its declared payload by dispatch. */
function parseTuplesV2(
  input: Uint8Array,
  counter: Counter,
  kinds: readonly PrimitiveKind[],
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  while (offset < input.length) {
    const tuple = parseTuple(input.slice(offset), kinds, domain);
    items.push(tupleItem(tuple.items));
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

/** Read v1 ESSR Texters using the declared item count. */
function parseEssrV1(input: Uint8Array, counter: Counter, _version: Versionage, domain: ParseDomain): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const texter = parseTexter(input.slice(offset), domain);
    items.push(texter);
    offset += primitiveSize(texter, domain);
  }
  return { items, consumed: offset };
}

/** Read v2 ESSR Texters until the dispatch-bounded payload is exhausted. */
function parseEssrV2(input: Uint8Array, counter: Counter, _version: Versionage, domain: ParseDomain): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  while (offset < input.length) {
    const texter = parseTexter(input.slice(offset), domain);
    items.push(texter);
    offset += primitiveSize(texter, domain);
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

/** Parse the controller signature group required inside a transferable signature group. */
function parseControllerSigs(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { items: GroupEntry[]; consumed: number } {
  const counter = parseCounter(input, version, domain);
  if (counter.code !== resolveCtrDex(version).ControllerIdxSigs) {
    throw new UnknownCodeError(
      `Expected controller signature counter but got ${counter.code}`,
    );
  }

  const parsed = parseAttachmentDispatch(input, version, domain);
  return { items: parsed.group.items.flat(), consumed: parsed.consumed };
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
  context: AttachmentDispatchOptions,
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
          nestedVersion = decodeGenusVersion(nestedCounter);
          continue;
        }
        const nested = parseAttachmentDispatchCompat(
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
          || normalized instanceof VersionError
        ) {
          throw normalized;
        }
        if (context.mode === "strict") {
          throw normalized;
        }
        // Intentional recovery point: keep unread wrapper tail as opaque units.
        const remainder = payload.slice(offset);
        items.push(...splitOpaqueUnits(remainder, domain));
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

/** Parse one transferable signature entry: prefix, sequence, digest, and signature list. */
function parseTransSig(input: Uint8Array, version: Versionage, domain: ParseDomain): ParsedGroup {
  const header = parseTuple(input, ["matter", "matter", "matter"], domain);
  const sigers = parseControllerSigs(input.slice(header.consumed), version, domain);
  return {
    items: [...header.items, tupleItem(sigers.items)],
    consumed: header.consumed + sigers.consumed,
  };
}

/** Parse one last-establishment signature entry: prefix and signature list. */
function parseLastSig(input: Uint8Array, version: Versionage, domain: ParseDomain): ParsedGroup {
  const header = parseTuple(input, ["matter"], domain);
  const sigers = parseControllerSigs(input.slice(header.consumed), version, domain);
  return {
    items: [...header.items, tupleItem(sigers.items)],
    consumed: header.consumed + sigers.consumed,
  };
}

/** Parse the declared number of v1 signature entries. */
function parseTransSigsV1(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const entry = parseTransSig(input.slice(offset), version, domain);
    items.push(tupleItem(entry.items));
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Exhaust a v2 signature group already bounded to its declared payload by dispatch. */
function parseTransSigsV2(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  while (offset < input.length) {
    const entry = parseTransSig(input.slice(offset), version, domain);
    items.push(tupleItem(entry.items));
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Parse the declared number of v1 signature entries. */
function parseLastSigsV1(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const entry = parseLastSig(input.slice(offset), version, domain);
    items.push(tupleItem(entry.items));
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Exhaust a v2 signature group already bounded to its declared payload by dispatch. */
function parseLastSigsV2(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = counterHeaderSize(counter, domain);
  while (offset < input.length) {
    const entry = parseLastSig(input.slice(offset), version, domain);
    items.push(tupleItem(entry.items));
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Parse SadPathSig groups: each path is followed by one nested signature group. */
function sadPathSigParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
  context: AttachmentDispatchOptions,
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
  context: AttachmentDispatchOptions,
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
  _context: AttachmentDispatchOptions,
): ParsedGroup {
  decodeGenusVersion(counter);
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
      const kinds = descriptor.tupleKinds;
      const parse = descriptor.version === 1 ? parseTuplesV1 : parseTuplesV2;
      return (input, counter, _version, domain) => parse(input, counter, kinds, domain);
    }
    case "essr":
      return descriptor.version === 1 ? parseEssrV1 : parseEssrV2;
    case "transIdxSigGroups":
      return descriptor.version === 1 ? parseTransSigsV1 : parseTransSigsV2;
    case "transLastIdxSigGroups":
      return descriptor.version === 1 ? parseLastSigsV1 : parseLastSigsV2;
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
  context: AttachmentDispatchOptions,
): { group: AttachmentGroup; consumed: number } {
  const counter = parseCounter(input, version, domain);
  const parser = getDispatch(version).get(counter.code);

  if (!parser) {
    throw new UnknownCodeError(
      `Unsupported attachment group code ${counter.code} (${counter.name})`,
    );
  }

  // V2 counts payload quadlets/triplets; the genus selector carries a version,
  // not a payload length. Bound before parsing so siblings cannot fill a group.
  const bounded = version.major === 2 && counter.code !== CtrDexV2.KERIACDCGenusVersion;
  if (bounded) {
    const end = counterHeaderSize(counter, domain) + counter.count * quadletUnitSize(domain);
    if (input.length < end) {
      throw new ShortageError(end, input.length);
    }
    input = input.slice(0, end);
  }

  let parsed: ParsedGroup;
  try {
    parsed = parser(input, counter, version, domain, context);
  } catch (error) {
    if (bounded && error instanceof ShortageError) {
      throw new GroupSizeError(`Incomplete item inside ${counter.code} payload`);
    }
    throw error;
  }
  if (bounded && parsed.consumed !== input.length) {
    throw new GroupSizeError(`Unconsumed payload in ${counter.code}`);
  }

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
 * Parse one attachment group under the selected version.
 * Compat mode only preserves opaque wrapper tails; it never retries dispatch.
 */
export function parseAttachmentDispatchCompat(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  options: AttachmentDispatchOptions = {},
): { group: AttachmentGroup; consumed: number } {
  return parseAttachmentDispatchWithVersion(input, version, domain, options);
}

/** Parse one attachment group, propagating nested wrapper errors. */
export function parseAttachmentDispatch(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { group: AttachmentGroup; consumed: number } {
  return parseAttachmentDispatchWithVersion(input, version, domain, {
    mode: "strict",
  });
}
