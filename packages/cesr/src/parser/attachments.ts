import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import { ColdStartError, DeserializeError, GroupSizeError, ShortageError, UnknownCodeError } from "../core/errors.ts";
import type { AttachmentGroup, CesrDomain } from "../core/types.ts";
import { parseCigar } from "../primitives/cigar.ts";
import { type Counter, CounterGroup, decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import { parseDater } from "../primitives/dater.ts";
import { parseDiger } from "../primitives/diger.ts";
import { parseLabeler } from "../primitives/labeler.ts";
import { parseNoncer } from "../primitives/noncer.ts";
import { parseNumber } from "../primitives/number.ts";
import { OpaqueSpan } from "../primitives/opaque.ts";
import { parsePather } from "../primitives/pather.ts";
import { parsePrefixer } from "../primitives/prefixer.ts";
import type { GroupEntry, Primitive } from "../primitives/primitive.ts";
import { parseSeqner } from "../primitives/seqner.ts";
import { parseSiger } from "../primitives/siger.ts";
import { parseTexter } from "../primitives/texter.ts";
import { parseVerfer } from "../primitives/verfer.ts";
import { parseVerser } from "../primitives/verser.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import { resolveCtrDex } from "../tables/counter-version-registry.ts";
import type { Versionage } from "../tables/table-types.ts";
import { sniff } from "./cold-start.ts";
import { FRAME_STARTS, GENUS_VERSION_CODE } from "./common.ts";

/**
 * Counter-group dispatcher for attachment payload parsing.
 *
 * Design notes:
 * - Dispatch is table-driven by major CESR version.
 * - Wrapper groups attempt nested parsing.
 *   Malformed nested content is rejected; opaque wire families preserve bytes.
 * - Every group is decoded under the selected version; failures never trigger
 *   a retry under another major version.
 */
interface ParsedGroup {
  items: GroupEntry[];
  consumed: number;
}

/** Decode one primitive whose role is fixed by the enclosing group. */
type PrimitiveParser = (input: Uint8Array, domain: CesrDomain) => Primitive;

/** Parser contract for one attachment-group counter code. */
type GroupParser = (
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
) => ParsedGroup;

/** Universal genus-version counter code (v1/v2 compatible encoding semantics). */

/** Decode a tuple with the primitive readers required by its wire roles. */
function parseTuple(
  input: Uint8Array,
  parsers: readonly PrimitiveParser[],
  domain: CesrDomain,
): { items: GroupEntry[]; consumed: number } {
  const items: GroupEntry[] = [];
  let offset = 0;
  for (const parse of parsers) {
    const part = parse(input.slice(offset), domain);
    items.push(part);
    offset += tokenSize(part, domain);
  }
  return { items, consumed: offset };
}

/** Parse the declared number of v1 tuples after the counter header. */
function parseTuplesV1(
  input: Uint8Array,
  counter: Counter,
  parsers: readonly PrimitiveParser[],
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const tuple = parseTuple(input.slice(offset), parsers, domain);
    items.push(tuple.items);
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

/** Exhaust a v2 tuple group already bounded to its declared payload by dispatch. */
function parseTuplesV2(
  input: Uint8Array,
  counter: Counter,
  parsers: readonly PrimitiveParser[],
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  while (offset < input.length) {
    const tuple = parseTuple(input.slice(offset), parsers, domain);
    items.push(tuple.items);
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

/** Read v1 ESSR Texters using the declared item count. */
function parseEssrV1(input: Uint8Array, counter: Counter, _gvrsn: Versionage, domain: CesrDomain): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const texter = parseTexter(input.slice(offset), domain);
    items.push(texter);
    offset += tokenSize(texter, domain);
  }
  return { items, consumed: offset };
}

/** Read v2 ESSR Texters until the dispatch-bounded payload is exhausted. */
function parseEssrV2(input: Uint8Array, counter: Counter, _gvrsn: Versionage, domain: CesrDomain): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  while (offset < input.length) {
    const texter = parseTexter(input.slice(offset), domain);
    items.push(texter);
    offset += tokenSize(texter, domain);
  }
  return { items, consumed: offset };
}

/** Parse the controller signature group required inside a transferable signature group. */
function parseControllerSigs(
  input: Uint8Array,
  gvrsn: Versionage,
  domain: CesrDomain,
): { items: GroupEntry[]; consumed: number } {
  const counter = parseCounter(input, gvrsn, domain);
  if (counter.code !== resolveCtrDex(gvrsn).ControllerIdxSigs) {
    throw new UnknownCodeError(
      `Expected controller signature counter but got ${counter.code}`,
    );
  }

  const parsed = parseAttachmentGroup(input, gvrsn, domain);
  return { items: parsed.group.items.flat(), consumed: parsed.consumed };
}

/**
 * Parse quadlet/triplet-counted groups.
 *
 * Behavior:
 * - non-wrapper groups preserve their payload as one opaque byte span.
 * - wrapper groups recurse into nested attachment-group dispatch.
 * - malformed wrapper contents propagate their parse error.
 */
function parseSizedGroup(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const unitSize = unitBytes(domain);
  const payloadSize = counter.count * unitSize;
  const headerSize = tokenSize(counter, domain);
  const total = headerSize + payloadSize;
  if (input.length < total) {
    throw new ShortageError(total, input.length);
  }

  const payload = input.slice(headerSize, total);

  if (
    ["AttachmentGroup", "BigAttachmentGroup", "BodyWithAttachmentGroup", "BigBodyWithAttachmentGroup"].includes(
      counter.name,
    )
  ) {
    // A wrapper payload must be an exact stream of nested groups.
    const items: GroupEntry[] = [];
    let offset = 0;
    let nestedGvrsn = gvrsn;
    while (offset < payload.length) {
      const nestedCounter = parseCounter(
        payload.slice(offset),
        nestedGvrsn,
        domain,
      );
      if (nestedCounter.code === GENUS_VERSION_CODE) {
        // Wrapper-scoped version override for subsequent nested groups.
        offset += tokenSize(nestedCounter, domain);
        nestedGvrsn = decodeGenusVersion(nestedCounter);
        continue;
      }
      const nested = parseAttachmentGroup(
        payload.slice(offset),
        nestedGvrsn,
        domain,
      );
      items.push(nested.group);
      if (nested.consumed === 0) {
        throw new GroupSizeError(
          "Nested attachment parser consumed zero bytes",
        );
      }
      offset += nested.consumed;
    }
    if (offset !== payload.length) {
      throw new GroupSizeError(
        "Nested attachment parsing did not consume exact payload",
      );
    }
    return { items, consumed: total };
  }

  const items = payload.length ? [new OpaqueSpan(payload, domain)] : [];

  return { items, consumed: total };
}

/** Parse one transferable signature entry: prefix, sequence, digest, and signature list. */
function parseTransSig(input: Uint8Array, gvrsn: Versionage, domain: CesrDomain): ParsedGroup {
  const header = parseTuple(input, [parsePrefixer, parseSeqner, parseDiger], domain);
  const sigers = parseControllerSigs(input.slice(header.consumed), gvrsn, domain);
  return {
    items: [...header.items, sigers.items],
    consumed: header.consumed + sigers.consumed,
  };
}

/** Parse one last-establishment signature entry: prefix and signature list. */
function parseLastSig(input: Uint8Array, gvrsn: Versionage, domain: CesrDomain): ParsedGroup {
  const header = parseTuple(input, [parsePrefixer], domain);
  const sigers = parseControllerSigs(input.slice(header.consumed), gvrsn, domain);
  return {
    items: [...header.items, sigers.items],
    consumed: header.consumed + sigers.consumed,
  };
}

/** Parse the declared number of v1 signature entries. */
function parseTransSigsV1(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const entry = parseTransSig(input.slice(offset), gvrsn, domain);
    items.push(entry.items);
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Exhaust a v2 signature group already bounded to its declared payload by dispatch. */
function parseTransSigsV2(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  while (offset < input.length) {
    const entry = parseTransSig(input.slice(offset), gvrsn, domain);
    items.push(entry.items);
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Parse the declared number of v1 signature entries. */
function parseLastSigsV1(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const entry = parseLastSig(input.slice(offset), gvrsn, domain);
    items.push(entry.items);
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Exhaust a v2 signature group already bounded to its declared payload by dispatch. */
function parseLastSigsV2(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  while (offset < input.length) {
    const entry = parseLastSig(input.slice(offset), gvrsn, domain);
    items.push(entry.items);
    offset += entry.consumed;
  }
  return { items, consumed: offset };
}

/** Parse SadPathSig groups: each path is followed by one nested signature group. */
function parsePathSigs(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);
  for (let i = 0; i < counter.count; i++) {
    const path = parsePather(input.slice(offset), domain);
    offset += tokenSize(path, domain);
    const sigGroup = parseAttachmentGroup(
      input.slice(offset),
      gvrsn,
      domain,
    );
    offset += sigGroup.consumed;
    items.push(
      [
        path,
        sigGroup.group,
      ],
    );
  }
  return { items, consumed: offset };
}

/** Parse SadPathSigGroup: root path + repeated (path, nested signature group). */
function parsePathSigGroup(
  input: Uint8Array,
  counter: Counter,
  gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  const items: GroupEntry[] = [];
  let offset = tokenSize(counter, domain);

  const root = parsePather(input.slice(offset), domain);
  offset += tokenSize(root, domain);
  items.push(root);

  for (let i = 0; i < counter.count; i++) {
    const path = parsePather(input.slice(offset), domain);
    offset += tokenSize(path, domain);
    const sigGroup = parseAttachmentGroup(
      input.slice(offset),
      gvrsn,
      domain,
    );
    offset += sigGroup.consumed;
    items.push(
      [
        path,
        sigGroup.group,
      ],
    );
  }
  return { items, consumed: offset };
}

/** Genus-version groups carry only the counter token itself as semantic payload. */
function parseGenus(
  _input: Uint8Array,
  counter: Counter,
  _gvrsn: Versionage,
  domain: CesrDomain,
): ParsedGroup {
  decodeGenusVersion(counter);
  return {
    items: [counter],
    consumed: tokenSize(counter, domain),
  };
}

/** Bind a tuple shape to v1 item-count parsing. */
function tuplesV1(...parsers: PrimitiveParser[]): GroupParser {
  return (input, counter, _gvrsn, domain) => parseTuplesV1(input, counter, parsers, domain);
}

/** Bind a tuple shape to v2 bounded-payload parsing. */
function tuplesV2(...parsers: PrimitiveParser[]): GroupParser {
  return (input, counter, _gvrsn, domain) => parseTuplesV2(input, counter, parsers, domain);
}

/** Direct routes for CESR v1; counter parsing validates the requested minor. */
const HANDLERS_V1: Readonly<Record<string, GroupParser>> = {
  [CtrDexV1.KERIACDCGenusVersion]: parseGenus,
  [CtrDexV1.GenericGroup]: parseSizedGroup,
  [CtrDexV1.BigGenericGroup]: parseSizedGroup,
  [CtrDexV1.NonNativeBodyGroup]: parseSizedGroup,
  [CtrDexV1.BigNonNativeBodyGroup]: parseSizedGroup,
  [CtrDexV1.PathedMaterialCouples]: parseSizedGroup,
  [CtrDexV1.BigPathedMaterialCouples]: parseSizedGroup,
  [CtrDexV1.AttachmentGroup]: parseSizedGroup,
  [CtrDexV1.BigAttachmentGroup]: parseSizedGroup,
  [CtrDexV1.BodyWithAttachmentGroup]: parseSizedGroup,
  [CtrDexV1.BigBodyWithAttachmentGroup]: parseSizedGroup,
  [CtrDexV1.ESSRPayloadGroup]: parseEssrV1,
  [CtrDexV1.BigESSRPayloadGroup]: parseEssrV1,
  [CtrDexV1.ControllerIdxSigs]: tuplesV1(parseSiger),
  [CtrDexV1.WitnessIdxSigs]: tuplesV1(parseSiger),
  [CtrDexV1.NonTransReceiptCouples]: tuplesV1(parseVerfer, parseCigar),
  [CtrDexV1.FirstSeenReplayCouples]: tuplesV1(parseSeqner, parseDater),
  [CtrDexV1.SealSourceCouples]: tuplesV1(parseSeqner, parseDiger),
  [CtrDexV1.TransReceiptQuadruples]: tuplesV1(parsePrefixer, parseSeqner, parseDiger, parseSiger),
  [CtrDexV1.SealSourceTriples]: tuplesV1(parsePrefixer, parseSeqner, parseDiger),
  [CtrDexV1.TransIdxSigGroups]: parseTransSigsV1,
  [CtrDexV1.TransLastIdxSigGroups]: parseLastSigsV1,
  [CtrDexV1.SadPathSig]: parsePathSigs,
  [CtrDexV1.SadPathSigGroup]: parsePathSigGroup,
};

/** Direct routes for CESR v2; counter parsing validates the requested minor. */
const HANDLERS_V2: Readonly<Record<string, GroupParser>> = {
  [CtrDexV2.KERIACDCGenusVersion]: parseGenus,
  [CtrDexV2.GenericGroup]: parseSizedGroup,
  [CtrDexV2.BigGenericGroup]: parseSizedGroup,
  [CtrDexV2.NonNativeBodyGroup]: parseSizedGroup,
  [CtrDexV2.BigNonNativeBodyGroup]: parseSizedGroup,
  [CtrDexV2.PathedMaterialCouples]: parseSizedGroup,
  [CtrDexV2.BigPathedMaterialCouples]: parseSizedGroup,
  [CtrDexV2.DatagramSegmentGroup]: parseSizedGroup,
  [CtrDexV2.BigDatagramSegmentGroup]: parseSizedGroup,
  [CtrDexV2.ESSRWrapperGroup]: parseSizedGroup,
  [CtrDexV2.BigESSRWrapperGroup]: parseSizedGroup,
  [CtrDexV2.FixBodyGroup]: parseSizedGroup,
  [CtrDexV2.BigFixBodyGroup]: parseSizedGroup,
  [CtrDexV2.MapBodyGroup]: parseSizedGroup,
  [CtrDexV2.BigMapBodyGroup]: parseSizedGroup,
  [CtrDexV2.GenericMapGroup]: parseSizedGroup,
  [CtrDexV2.BigGenericMapGroup]: parseSizedGroup,
  [CtrDexV2.GenericListGroup]: parseSizedGroup,
  [CtrDexV2.BigGenericListGroup]: parseSizedGroup,
  [CtrDexV2.AttachmentGroup]: parseSizedGroup,
  [CtrDexV2.BigAttachmentGroup]: parseSizedGroup,
  [CtrDexV2.BodyWithAttachmentGroup]: parseSizedGroup,
  [CtrDexV2.BigBodyWithAttachmentGroup]: parseSizedGroup,
  [CtrDexV2.ESSRPayloadGroup]: parseEssrV2,
  [CtrDexV2.BigESSRPayloadGroup]: parseEssrV2,
  [CtrDexV2.ControllerIdxSigs]: tuplesV2(parseSiger),
  [CtrDexV2.BigControllerIdxSigs]: tuplesV2(parseSiger),
  [CtrDexV2.WitnessIdxSigs]: tuplesV2(parseSiger),
  [CtrDexV2.BigWitnessIdxSigs]: tuplesV2(parseSiger),
  [CtrDexV2.NonTransReceiptCouples]: tuplesV2(parseVerfer, parseCigar),
  [CtrDexV2.BigNonTransReceiptCouples]: tuplesV2(parseVerfer, parseCigar),
  [CtrDexV2.FirstSeenReplayCouples]: tuplesV2(parseSeqner, parseDater),
  [CtrDexV2.BigFirstSeenReplayCouples]: tuplesV2(parseSeqner, parseDater),
  [CtrDexV2.SealSourceCouples]: tuplesV2(parseSeqner, parseDiger),
  [CtrDexV2.BigSealSourceCouples]: tuplesV2(parseSeqner, parseDiger),
  [CtrDexV2.BackerRegistrarSealCouples]: tuplesV2(parsePrefixer, parseDiger),
  [CtrDexV2.BigBackerRegistrarSealCouples]: tuplesV2(parsePrefixer, parseDiger),
  [CtrDexV2.TypedDigestSealCouples]: tuplesV2(parseVerser, parseDiger),
  [CtrDexV2.BigTypedDigestSealCouples]: tuplesV2(parseVerser, parseDiger),
  [CtrDexV2.TransReceiptQuadruples]: tuplesV2(parsePrefixer, parseSeqner, parseDiger, parseSiger),
  [CtrDexV2.BigTransReceiptQuadruples]: tuplesV2(parsePrefixer, parseSeqner, parseDiger, parseSiger),
  [CtrDexV2.SealSourceTriples]: tuplesV2(parsePrefixer, parseSeqner, parseDiger),
  [CtrDexV2.BigSealSourceTriples]: tuplesV2(parsePrefixer, parseSeqner, parseDiger),
  [CtrDexV2.SealSourceLastSingles]: tuplesV2(parsePrefixer),
  [CtrDexV2.BigSealSourceLastSingles]: tuplesV2(parsePrefixer),
  [CtrDexV2.DigestSealSingles]: tuplesV2(parseDiger),
  [CtrDexV2.BigDigestSealSingles]: tuplesV2(parseDiger),
  [CtrDexV2.MerkleRootSealSingles]: tuplesV2(parseDiger),
  [CtrDexV2.BigMerkleRootSealSingles]: tuplesV2(parseDiger),
  [CtrDexV2.TransIdxSigGroups]: parseTransSigsV2,
  [CtrDexV2.BigTransIdxSigGroups]: parseTransSigsV2,
  [CtrDexV2.TransLastIdxSigGroups]: parseLastSigsV2,
  [CtrDexV2.BigTransLastIdxSigGroups]: parseLastSigsV2,
  [CtrDexV2.BlindedStateQuadruples]: tuplesV2(parseDiger, parseNoncer, parseNoncer, parseLabeler),
  [CtrDexV2.BigBlindedStateQuadruples]: tuplesV2(parseDiger, parseNoncer, parseNoncer, parseLabeler),
  [CtrDexV2.TypedMediaQuadruples]: tuplesV2(parseDiger, parseNoncer, parseLabeler, parseTexter),
  [CtrDexV2.BigTypedMediaQuadruples]: tuplesV2(parseDiger, parseNoncer, parseLabeler, parseTexter),
  [CtrDexV2.BoundStateSextuples]: tuplesV2(
    parseDiger,
    parseNoncer,
    parseNoncer,
    parseLabeler,
    parseNumber,
    parseNoncer,
  ),
  [CtrDexV2.BigBoundStateSextuples]: tuplesV2(
    parseDiger,
    parseNoncer,
    parseNoncer,
    parseLabeler,
    parseNumber,
    parseNoncer,
  ),
};

/** Parse one attachment group with an explicit version (no version fallback). */
export function parseAttachmentGroup(
  input: Uint8Array,
  gvrsn: Versionage,
  domain: CesrDomain,
): { group: AttachmentGroup; consumed: number } {
  const counter = parseCounter(input, gvrsn, domain);
  const parser = (gvrsn.major === 1 ? HANDLERS_V1 : HANDLERS_V2)[counter.code];

  if (!parser) {
    throw new UnknownCodeError(
      `Unsupported attachment group code ${counter.code} (${counter.name})`,
    );
  }

  // V2 groups and v1 sized groups count payload units. The genus selector
  // carries a version instead. Bound here so peers cannot fill incomplete items.
  const bounded = parser === parseSizedGroup
    || (gvrsn.major === 2 && counter.code !== CtrDexV2.KERIACDCGenusVersion);
  if (bounded) {
    const end = tokenSize(counter, domain) + counter.count * unitBytes(domain);
    if (input.length < end) {
      throw new ShortageError(end, input.length);
    }
    input = input.slice(0, end);
  }

  let parsed: ParsedGroup;
  try {
    parsed = parser(input, counter, gvrsn, domain);
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

/** Probe only the selected genus; a shortage must remain a shortage. */
function startsFrame(input: Uint8Array, gvrsn: Versionage, domain: CesrDomain): boolean {
  try {
    const counter = parseCounter(input, gvrsn, domain);
    return FRAME_STARTS.has(counter.name) || counter.code === GENUS_VERSION_CODE;
  } catch (error) {
    if (error instanceof UnknownCodeError || error instanceof DeserializeError) return false;
    throw error;
  }
}

/**
 * Read attachments until a following body, a closed attachment enclosure, or exhaustion.
 * Exhaustion completes only terminal/bounded input. Partial groups remain unconsumed;
 * terminal shortages propagate so bounded callers can report enclosure errors.
 */
export function parseAttachments(
  input: Uint8Array,
  gvrsn: Versionage,
  seed: AttachmentGroup[] = [],
  terminal = false,
): { attachments: AttachmentGroup[]; consumed: number; complete: boolean } {
  const attachments = [...seed];
  let offset = 0;
  while (offset < input.length) {
    const rest = input.slice(offset);
    const domain = sniff(rest);
    if (domain === "msg") return { attachments, consumed: offset, complete: true };
    if (domain === "ano") {
      offset++;
      continue;
    }
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported attachment cold code ${domain}`);
    try {
      if (startsFrame(rest, gvrsn, domain)) return { attachments, consumed: offset, complete: true };
      const { group, consumed } = parseAttachmentGroup(rest, gvrsn, domain);
      attachments.push(group);
      offset += consumed;
      if (group.name === "AttachmentGroup" || group.name === "BigAttachmentGroup") {
        return { attachments, consumed: offset, complete: true };
      }
    } catch (error) {
      if (error instanceof ShortageError && !terminal) {
        return { attachments, consumed: offset, complete: false };
      }
      throw error;
    }
  }
  return { attachments, consumed: offset, complete: terminal };
}
