import { encodeB64 } from "../core/bytes.ts";
import {
  DeserializeError,
  SemanticInterpretationError,
  ShortageError,
  SyntaxParseError,
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

/** Label token artifact produced during map payload syntax parsing. */
export interface MapperLabelTokenSyntax {
  kind: "label";
  code: string;
  qb64: string;
  label: string;
  consumed: number;
}

/** Value token artifact produced during map payload syntax parsing. */
export interface MapperValueTokenSyntax {
  kind: "value";
  code: string;
  qb64: string;
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
  /**
   * Syntax probe only: attempt known major versions without committing semantic
   * meaning until dispatch selection succeeds.
   */
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
  /** Label probe only; non-label parse failures are treated as "not a label". */
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

function parseMapperValueSyntax(
  input: Uint8Array,
  version: Versionage,
  domain: ParseDomain,
): MapperValueTokenSyntax {
  /**
   * Parse a single map value token artifact.
   *
   * If the value is itself a map-group counter, recurse into
   * `parseMapperBodySyntax` and attach nested syntax in `children`.
   */
  const counter = parseCounterProbe(input, version, domain);
  if (counter) {
    const dispatch = parseAttachmentDispatch(input, version, domain);
    const raw = input.slice(0, dispatch.consumed);
    const value: MapperValueTokenSyntax = {
      kind: "value",
      code: dispatch.group.code,
      qb64: asQb64(raw, domain),
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
    code: matter.code,
    qb64: matter.qb64,
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
  /**
   * Tokenize payload bytes into an ordered syntax stream.
   *
   * This phase does not pair labels with values; pairing is deferred to
   * `interpretMapperBodySyntax`.
   */
  const entries: MapperSyntaxEntry[] = [];
  let offset = start;

  while (offset < end) {
    const at = input.slice(offset, end);
    const maybeLabel = parseLabelProbe(at, domain);
    if (maybeLabel) {
      const consumed = tokenSize(maybeLabel, domain);
      entries.push({
        kind: "label",
        code: maybeLabel.code,
        qb64: maybeLabel.token,
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
      code: entry.code,
      qb64: entry.qb64,
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

    const entries = parseMapPayloadSyntax(input, version, domain, header, total);

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
      error instanceof ShortageError ||
      error instanceof UnknownCodeError ||
      error instanceof DeserializeError
    ) {
      throw new SyntaxParseError(
        `Map-body syntax parse failed: ${error.message}`,
        error,
      );
    }
    throw error;
  }
}

/**
 * Parse map-style native bodies/counters into labeled semantic fields.
 * Compatibility wrapper over syntax parsing + semantic interpretation phases.
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
  let fields: MapperField[];
  try {
    fields = interpretMapperBodySyntax(syntax);
  } catch (error) {
    if (error instanceof SemanticInterpretationError) {
      throw new UnknownCodeError(error.message);
    }
    throw error;
  }
  return {
    code: syntax.code,
    count: syntax.count,
    fullSize: syntax.fullSize,
    fullSizeB2: syntax.fullSizeB2,
    totalSize: syntax.totalSize,
    totalSizeB2: syntax.totalSizeB2,
    fields,
  };
}

/** True for counter codes that represent map/list-native aggregate primitives. */
export function isMapperCounterCode(code: string): boolean {
  return MAP_GROUP_CODES.has(code) || LIST_GROUP_CODES.has(code);
}
