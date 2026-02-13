import type { AttachmentGroup, ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { type Counter, parseCounter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import { parseIndexer } from "../primitives/indexer.ts";
import {
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";

interface ParsedGroup {
  items: unknown[];
  consumed: number;
}

type ParseDomain = Extract<ColdCode, "txt" | "bny">;
type PrimitiveKind = "matter" | "indexer";

type GroupParser = (
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
) => ParsedGroup;

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

const WRAPPER_GROUP_CODES_V1 = new Set([
  CtrDexV1.AttachmentGroup,
  CtrDexV1.BigAttachmentGroup,
  CtrDexV1.BodyWithAttachmentGroup,
  CtrDexV1.BigBodyWithAttachmentGroup,
]);

const WRAPPER_GROUP_CODES_V2 = new Set([
  CtrDexV2.AttachmentGroup,
  CtrDexV2.BigAttachmentGroup,
  CtrDexV2.BodyWithAttachmentGroup,
  CtrDexV2.BigBodyWithAttachmentGroup,
]);

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
    offset += domain === "bny" ? part.fullSizeB2 : part.fullSize;
  }
  return { items, consumed: offset };
}

function parseRepeated(
  input: Uint8Array,
  count: number,
  kinds: PrimitiveKind[],
  domain: ParseDomain,
): ParsedGroup {
  const items: unknown[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const tuple = parseTuple(input.slice(offset), kinds, domain);
    items.push(tuple.items);
    offset += tuple.consumed;
  }
  return { items, consumed: offset };
}

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
  let offset = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
  for (let i = 0; i < counter.count; i++) {
    const part = parseIndexer(input.slice(offset), domain);
    items.push(part.qb64);
    offset += domain === "bny" ? part.fullSizeB2 : part.fullSize;
  }

  return { items, consumed: offset };
}

function parseQuadletGroup(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  wrapperCodes: Set<string>,
  domain: ParseDomain,
): ParsedGroup {
  const unitSize = domain === "bny" ? 3 : 4;
  const payloadSize = counter.count * unitSize;
  const headerSize = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
  const total = headerSize + payloadSize;
  if (input.length < total) {
    throw new ShortageError(total, input.length);
  }

  const payload = input.slice(headerSize, total);

  if (wrapperCodes.has(counter.code)) {
    const items: unknown[] = [];
    let offset = 0;
    while (offset < payload.length) {
      const nested = parseAttachmentDispatch(
        payload.slice(offset),
        version,
        domain,
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
    }
    if (offset !== payload.length) {
      throw new GroupSizeError(
        "Nested attachment parsing did not consume exact payload",
      );
    }
    return { items, consumed: total };
  }

  const items = domain === "bny"
    ? Array.from(
      { length: counter.count },
      (_v, i) => payload.slice(i * 3, i * 3 + 3),
    )
    : (String.fromCharCode(...payload).match(/.{1,4}/g) ?? []);

  return { items, consumed: total };
}

function repeatTupleParser(kinds: PrimitiveKind[]): GroupParser {
  return (
    input: Uint8Array,
    counter: Counter,
    _version: Versionage,
    domain: ParseDomain,
  ): ParsedGroup => {
    const headerSize = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
    const parsed = parseRepeated(
      input.slice(headerSize),
      counter.count,
      kinds,
      domain,
    );
    return { items: parsed.items, consumed: parsed.consumed + headerSize };
  };
}

function transIdxSigGroupsParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  const items: unknown[] = [];
  let offset = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
  for (let i = 0; i < counter.count; i++) {
    const header = parseTuple(input.slice(offset), ["matter", "matter", "matter"], domain);
    offset += header.consumed;
    const sigers = parseSigerList(input.slice(offset), version, domain);
    offset += sigers.consumed;
    items.push([...header.items, sigers.items]);
  }
  return { items, consumed: offset };
}

function transLastIdxSigGroupsParser(
  input: Uint8Array,
  counter: Counter,
  version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  const items: unknown[] = [];
  let offset = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
  for (let i = 0; i < counter.count; i++) {
    const header = parseTuple(input.slice(offset), ["matter"], domain);
    offset += header.consumed;
    const sigers = parseSigerList(input.slice(offset), version, domain);
    offset += sigers.consumed;
    items.push([...header.items, sigers.items]);
  }
  return { items, consumed: offset };
}

function genusVersionParser(
  _input: Uint8Array,
  counter: Counter,
  _version: Versionage,
  domain: ParseDomain,
): ParsedGroup {
  return {
    items: [counter.qb64],
    consumed: domain === "bny" ? counter.fullSizeB2 : counter.fullSize,
  };
}

const V1_QUADLET_PARSER: GroupParser = (input, counter, version, domain) =>
  parseQuadletGroup(input, counter, version, WRAPPER_GROUP_CODES_V1, domain);

const V2_QUADLET_PARSER: GroupParser = (input, counter, version, domain) =>
  parseQuadletGroup(input, counter, version, WRAPPER_GROUP_CODES_V2, domain);

const V1_DISPATCH: Map<string, GroupParser> = new Map([
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
  [CtrDexV1.ControllerIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV1.WitnessIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV1.NonTransReceiptCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV1.TransReceiptQuadruples, repeatTupleParser(["matter", "matter", "matter", "indexer"])],
  [CtrDexV1.FirstSeenReplayCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV1.SealSourceCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV1.SealSourceTriples, repeatTupleParser(["matter", "matter", "matter"])],
  [CtrDexV1.TransIdxSigGroups, transIdxSigGroupsParser],
  [CtrDexV1.TransLastIdxSigGroups, transLastIdxSigGroupsParser],
  [CtrDexV1.KERIACDCGenusVersion, genusVersionParser],
]);

const V2_DISPATCH: Map<string, GroupParser> = new Map([
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
  [CtrDexV2.ControllerIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.BigControllerIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.WitnessIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.BigWitnessIdxSigs, repeatTupleParser(["indexer"])],
  [CtrDexV2.NonTransReceiptCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigNonTransReceiptCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.TransReceiptQuadruples, repeatTupleParser(["matter", "matter", "matter", "indexer"])],
  [CtrDexV2.BigTransReceiptQuadruples, repeatTupleParser(["matter", "matter", "matter", "indexer"])],
  [CtrDexV2.FirstSeenReplayCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigFirstSeenReplayCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.SealSourceCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigSealSourceCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.SealSourceTriples, repeatTupleParser(["matter", "matter", "matter"])],
  [CtrDexV2.BigSealSourceTriples, repeatTupleParser(["matter", "matter", "matter"])],
  [CtrDexV2.SealSourceLastSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BigSealSourceLastSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.DigestSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BigDigestSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.MerkleRootSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BigMerkleRootSealSingles, repeatTupleParser(["matter"])],
  [CtrDexV2.BackerRegistrarSealCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigBackerRegistrarSealCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.TypedDigestSealCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.BigTypedDigestSealCouples, repeatTupleParser(["matter", "matter"])],
  [CtrDexV2.TransIdxSigGroups, transIdxSigGroupsParser],
  [CtrDexV2.BigTransIdxSigGroups, transIdxSigGroupsParser],
  [CtrDexV2.TransLastIdxSigGroups, transLastIdxSigGroupsParser],
  [CtrDexV2.BigTransLastIdxSigGroups, transLastIdxSigGroupsParser],
  [CtrDexV2.BlindedStateQuadruples, repeatTupleParser(["matter", "matter", "matter", "matter"])],
  [CtrDexV2.BigBlindedStateQuadruples, repeatTupleParser(["matter", "matter", "matter", "matter"])],
  [CtrDexV2.BoundStateSextuples, repeatTupleParser(["matter", "matter", "matter", "matter", "matter", "matter"])],
  [CtrDexV2.BigBoundStateSextuples, repeatTupleParser(["matter", "matter", "matter", "matter", "matter", "matter"])],
  [CtrDexV2.TypedMediaQuadruples, repeatTupleParser(["matter", "matter", "matter", "matter"])],
  [CtrDexV2.BigTypedMediaQuadruples, repeatTupleParser(["matter", "matter", "matter", "matter"])],
  [CtrDexV2.KERIACDCGenusVersion, genusVersionParser],
]);

function getDispatch(version: Versionage): Map<string, GroupParser> {
  return version.major >= 2 ? V2_DISPATCH : V1_DISPATCH;
}

export function parseAttachmentDispatch(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { group: AttachmentGroup; consumed: number } {
  const counter = parseCounter(input, version, domain);
  const parser = getDispatch(version).get(counter.code);

  if (!parser) {
    throw new UnknownCodeError(
      `Unsupported attachment group code ${counter.code} (${counter.name})`,
    );
  }

  const parsed = parser(input, counter, version, domain);

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
