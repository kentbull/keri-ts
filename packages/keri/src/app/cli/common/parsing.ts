import type { ThresholdSith } from "../../../../../cesr/mod.ts";

/**
 * JSON file schema for `tufa incept --file` option loading.
 *
 * KLI/KERIpy correspondence:
 * - this shape models the portable subset of KLI inception configuration that
 *   is merged with CLI flags before command execution
 */
export interface InceptFileOptions {
  transferable?: boolean;
  wits?: string[];
  icount?: number;
  isith?: ThresholdSith;
  ncount?: number;
  nsith?: ThresholdSith;
  toad?: number;
  estOnly?: boolean;
  data?: unknown[];
  delpre?: string;
}

/**
 * JSON file schema for `tufa rotate --file` option loading.
 *
 * The merge semantics intentionally stay close to KLI so tests and operator
 * expectations do not depend on whether an option came from the file or the
 * command line.
 */
export interface RotateFileOptions {
  isith?: ThresholdSith;
  ncount?: number;
  nsith?: ThresholdSith;
  toad?: number;
  wits?: string[];
  witsCut?: string[];
  witsAdd?: string[];
  data?: unknown[];
}

/**
 * Normalize one threshold input from CLI/file JSON into the internal
 * `ThresholdSith` representation.
 *
 * Accepted forms intentionally match the operator-facing KLI shapes:
 * numeric, hex-string, weighted JSON-array string, or structured array data.
 */
function normalizeThresholdOption(
  value: unknown,
): ThresholdSith | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid numeric threshold ${value}`);
    }
    return value.toString(16);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    if (trimmed.startsWith("[")) {
      return JSON.parse(trimmed) as ThresholdSith;
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    return structuredClone(value) as ThresholdSith;
  }
  throw new Error(`Unsupported threshold option type ${typeof value}`);
}

/**
 * Parse one CLI/file threshold input into semantic numeric or weighted form.
 *
 * This is a thin public seam over `normalizeThresholdOption(...)` so command
 * modules do not duplicate threshold coercion rules.
 */
export function parseThresholdOption(
  value: string | undefined,
): ThresholdSith | undefined {
  return normalizeThresholdOption(value);
}

/**
 * Parse inline JSON values or `@file` references used by CLI `--data` flags.
 *
 * KLI correspondence:
 * - each `--data` value is interpreted independently
 * - `@file` values must contain JSON that is inserted as one committed item
 */
export function parseDataItems(items: string[] | undefined): unknown[] {
  if (!items || items.length === 0) return [];
  const out: unknown[] = [];
  for (const item of items) {
    if (item.startsWith("@")) {
      const file = item.slice(1);
      const text = Deno.readTextFileSync(file);
      out.push(JSON.parse(text));
      continue;
    }
    out.push(JSON.parse(item));
  }
  return out;
}

/** Load and parse one JSON document from disk without extra schema coercion. */
function loadJson(path: string): unknown {
  return JSON.parse(Deno.readTextFileSync(path));
}

/** Return true when a string can be losslessly treated as a JSON number literal. */
function isNumber(value: string): boolean {
  if (value.trim().length === 0) {
    return false;
  }
  return !Number.isNaN(Number(value));
}

/**
 * Coerce one EXN `key=value` right-hand side like KERIpy's CLI.
 *
 * Plain strings stay strings, while obvious JSON scalars/containers are parsed
 * into structured values when possible.
 */
function coerceExnDataValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (
    trimmed.startsWith("{") || trimmed.startsWith("[")
    || trimmed === "true" || trimmed === "false" || trimmed === "null"
    || isNumber(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Parse KERIpy-style repeatable EXN `--data` items into one payload object.
 *
 * Accepted item shapes:
 * - `@file.json` containing one JSON object
 * - one inline JSON object string
 * - repeatable `key=value` items whose values coerce like KERIpy
 */
export function parseExnDataItems(
  items: string[] | undefined,
): Record<string, unknown> {
  if (!items || items.length === 0) {
    return {};
  }

  const data: Record<string, unknown> = {};
  for (const item of items) {
    if (item === undefined || item === null) {
      continue;
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith("@")) {
      const loaded = loadJson(trimmed.slice(1));
      if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
        throw new Error("@file must contain a JSON object");
      }
      Object.assign(data, loaded);
      continue;
    }

    if (trimmed.startsWith("{")) {
      const loaded = JSON.parse(trimmed);
      if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
        throw new Error("JSON must be an object");
      }
      Object.assign(data, loaded);
      continue;
    }

    if (!trimmed.includes("=")) {
      throw new Error(
        `invalid item '${trimmed}', expected key=value, JSON object, or @file.json`,
      );
    }

    const [rawKey, ...rest] = trimmed.split("=");
    const key = rawKey?.trim() ?? "";
    if (key.length === 0) {
      throw new Error(`invalid item '${trimmed}', empty key`);
    }
    data[key] = coerceExnDataValue(rest.join("="));
  }

  return data;
}

/**
 * Load one JSON file of inception options using the CLI file-input contract.
 *
 * Threshold fields are normalized during load so later merge code can operate
 * on one representation regardless of whether the value came from a file or a
 * direct CLI flag.
 */
export function loadInceptFileOptions(path: string): InceptFileOptions {
  const text = Deno.readTextFileSync(path);
  const loaded = JSON.parse(text) as InceptFileOptions;
  return {
    ...loaded,
    isith: normalizeThresholdOption(loaded.isith),
    nsith: normalizeThresholdOption(loaded.nsith),
  };
}

/**
 * Load one JSON file of rotation options using the CLI file-input contract.
 *
 * KLI compatibility notes:
 * - threshold fields are normalized immediately
 * - witness collections are filtered down to strings so malformed JSON does
 *   not propagate surprising non-string values into witness math
 */
export function loadRotateFileOptions(path: string): RotateFileOptions {
  const text = Deno.readTextFileSync(path);
  const loaded = JSON.parse(text) as RotateFileOptions;
  return {
    ...loaded,
    isith: normalizeThresholdOption(loaded.isith),
    nsith: normalizeThresholdOption(loaded.nsith),
    wits: Array.isArray(loaded.wits)
      ? loaded.wits.filter((value): value is string => typeof value === "string")
      : loaded.wits,
    witsCut: Array.isArray(loaded.witsCut)
      ? loaded.witsCut.filter((value): value is string => typeof value === "string")
      : loaded.witsCut,
    witsAdd: Array.isArray(loaded.witsAdd)
      ? loaded.witsAdd.filter((value): value is string => typeof value === "string")
      : loaded.witsAdd,
  };
}

/**
 * Load one required CLI text argument or `@file` reference as UTF-8 bytes.
 *
 * This preserves the KLI convention used by `sign` and `verify`: operator
 * input is always interpreted as text, never raw binary.
 */
export function loadTextArgument(text: string): Uint8Array {
  const source = text.startsWith("@")
    ? Deno.readTextFileSync(text.slice(1))
    : text;
  return new TextEncoder().encode(source);
}
