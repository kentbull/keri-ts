import { encodeB64 } from "../core/bytes.ts";
import {
  DeserializeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseCounter } from "./counter.ts";
import { parseLabeler } from "./labeler.ts";
import { parseMatter } from "./matter.ts";

type ParseDomain = Extract<ColdCode, "txt" | "bny">;

const MAP_GROUP_CODES = new Set([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
  CtrDexV2.GenericMapGroup,
  CtrDexV2.BigGenericMapGroup,
]);

const LIST_GROUP_CODES = new Set([
  CtrDexV2.GenericGroup,
  CtrDexV2.BigGenericGroup,
  CtrDexV2.GenericListGroup,
  CtrDexV2.BigGenericListGroup,
]);

export interface MapperField {
  label: string | null;
  code: string;
  qb64: string;
  isCounter: boolean;
  children?: MapperField[];
}

export interface Mapper {
  code: string;
  count: number;
  fullSize: number;
  fullSizeB2: number;
  totalSize: number;
  totalSizeB2: number;
  fields: MapperField[];
}

function tokenSize(
  token: { fullSize: number; fullSizeB2: number },
  domain: ParseDomain,
): number {
  return domain === "bny" ? token.fullSizeB2 : token.fullSize;
}

function isMapGroupCode(code: string): boolean {
  return MAP_GROUP_CODES.has(code);
}

function asQb64(raw: Uint8Array, domain: ParseDomain): string {
  return domain === "txt" ? String.fromCharCode(...raw) : encodeB64(raw);
}

function parseCounterProbe(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): ReturnType<typeof parseCounter> | null {
  // Probe both active and known majors so map parsing remains robust when
  // streams mix legacy and current counters in nested structures.
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
        error instanceof UnknownCodeError ||
        error instanceof DeserializeError
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
  try {
    return parseLabeler(input, domain);
  } catch (error) {
    if (error instanceof ShortageError) {
      throw error;
    }
    if (
      error instanceof UnknownCodeError ||
      error instanceof DeserializeError
    ) {
      return null;
    }
    throw error;
  }
}

function parseMapperValue(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): { field: Omit<MapperField, "label">; consumed: number } {
  const counter = parseCounterProbe(input, version, domain);
  if (counter) {
    const dispatch = parseAttachmentDispatch(input, version, domain);
    const raw = input.slice(0, dispatch.consumed);
    const field: Omit<MapperField, "label"> = {
      code: dispatch.group.code,
      qb64: asQb64(raw, domain),
      isCounter: true,
    };

    if (isMapGroupCode(dispatch.group.code)) {
      const nested = parseMapperBody(input, version, domain);
      field.children = nested.fields;
    }

    return { field, consumed: dispatch.consumed };
  }

  const matter = parseMatter(input, domain);
  return {
    field: {
      code: matter.code,
      qb64: matter.qb64,
      isCounter: false,
    },
    consumed: tokenSize(matter, domain),
  };
}

function parseMapPayload(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
  start: number,
  end: number,
): MapperField[] {
  const fields: MapperField[] = [];
  let offset = start;
  let pendingLabel: string | null = null;

  while (offset < end) {
    const at = input.slice(offset, end);
    const maybeLabel = parseLabelProbe(at, domain);
    if (maybeLabel) {
      pendingLabel = maybeLabel.label;
      offset += tokenSize(maybeLabel, domain);
      continue;
    }

    const { field, consumed } = parseMapperValue(at, version, domain);
    fields.push({
      label: pendingLabel,
      code: field.code,
      qb64: field.qb64,
      isCounter: field.isCounter,
      children: field.children,
    });
    pendingLabel = null;
    offset += consumed;
  }

  if (offset !== end) {
    throw new ShortageError(end, offset);
  }
  if (pendingLabel !== null) {
    throw new UnknownCodeError("Dangling map label without value");
  }

  return fields;
}

/**
 * Parse map-style native bodies/counters into labeled semantic fields.
 * Parsing is strict: payload boundaries and label/value pairing must be exact.
 */
export function parseMapperBody(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): Mapper {
  // Mapper is intentionally strict: payload boundaries must be exact and
  // labels cannot be left dangling without a value.
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

  const fields = parseMapPayload(input, version, domain, header, total);

  return {
    code: counter.code,
    count: counter.count,
    fullSize: counter.fullSize,
    fullSizeB2: counter.fullSizeB2,
    totalSize: domain === "txt" ? total : Math.ceil(total * 4 / 3),
    totalSizeB2: domain === "bny" ? total : Math.ceil(total * 3 / 4),
    fields,
  };
}

/** True for counter codes that represent map/list-native aggregate primitives. */
export function isMapperCounterCode(code: string): boolean {
  return MAP_GROUP_CODES.has(code) || LIST_GROUP_CODES.has(code);
}
