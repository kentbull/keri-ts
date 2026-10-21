import { Tholder, type ThresholdSith } from "cesr-ts";
import { ValidationError } from "../../core/errors.ts";

/** Keep omission and explicit empty strings distinct; command policy handles emptiness. */
export function parseStringOption(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ValidationError(`${flag} must be a string`);
  return value;
}

/** Preserve an omitted flag until command/file precedence and defaults are applied. */
export function parseBooleanOption(value: unknown, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ValidationError(`${flag} must be a boolean`);
  return value;
}

/** Preserve optional decimal quantities while rejecting coercion of booleans, blanks or nonfinite values. */
export function parseNumberOption(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      throw new ValidationError(`${flag} must be a decimal number`);
    }
    value = Number(value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${flag} must be finite`);
  }
  return value;
}

/** Validate a whole decimal count without collapsing omission or zero. */
export function parseIntegerOption(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) throw new ValidationError(`${flag} must be a decimal integer`);
    value = Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ValidationError(`${flag} must be a safe integer`);
  }
  return value;
}

/** Validate every list member; an explicit empty list remains an override. */
export function parseStringListOption(value: unknown, flag: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new ValidationError(`${flag} must be an array of strings`);
  }
  return [...value];
}

/** Require nonnegative whole counts for key and witness options. */
export function parseCountOption(value: unknown, flag: string): number | undefined {
  const count = parseIntegerOption(value, flag);
  if (count !== undefined && count < 0) throw new ValidationError(`${flag} must not be negative`);
  return count;
}

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
 * Explicit CLI values override file values; omitted flags leave these values
 * intact until the command applies its defaults.
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
export function parseThresholdOption(value: unknown): ThresholdSith | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ValidationError("Threshold must be a nonnegative safe integer");
    }
    return new Tholder({ sith: value }).sith;
  }
  if (typeof value !== "string" && !Array.isArray(value)) {
    throw new ValidationError("Threshold must be a hex string, number or weighted array");
  }
  // Tholder owns weighted syntax, semantic validation and its configurable caps.
  // JSON is the existing input boundary for arrays, avoiding an unchecked cast.
  return new Tholder({ sith: typeof value === "string" ? value : JSON.stringify(value) }).sith;
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
  const loaded = loadOptionObject(path);
  return {
    transferable: parseBooleanOption(loaded.transferable, "transferable"),
    wits: parseStringListOption(loaded.wits, "wits"),
    icount: parseCountOption(loaded.icount, "icount"),
    isith: parseThresholdOption(loaded.isith),
    ncount: parseCountOption(loaded.ncount, "ncount"),
    nsith: parseThresholdOption(loaded.nsith),
    toad: parseCountOption(loaded.toad, "toad"),
    estOnly: parseBooleanOption(loaded.estOnly, "estOnly"),
    data: parseFileData(loaded.data),
    delpre: parseStringOption(loaded.delpre, "delpre"),
  };
}

/** Load known rotation fields, rejecting malformed values rather than filtering them. */
export function loadRotateFileOptions(path: string): RotateFileOptions {
  const loaded = loadOptionObject(path);
  return {
    isith: parseThresholdOption(loaded.isith),
    nsith: parseThresholdOption(loaded.nsith),
    ncount: parseCountOption(loaded.ncount, "ncount"),
    toad: parseCountOption(loaded.toad, "toad"),
    wits: parseStringListOption(loaded.wits, "wits"),
    witsCut: parseStringListOption(loaded.witsCut, "witsCut"),
    witsAdd: parseStringListOption(loaded.witsAdd, "witsAdd"),
    data: parseFileData(loaded.data),
  };
}

/** JSON option files are objects; individual command fields are validated by their loaders. */
export function loadOptionObject(path: string): Record<string, unknown> {
  const value = loadJson(path);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Option file must contain a JSON object");
  }
  return value as Record<string, unknown>;
}

/** Anchored JSON data is application-defined, but its outer collection must be an array. */
export function parseFileData(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("data must be an array");
  return value;
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

/** Require a non-empty string argument (for name, alias, etc.). */
export function requireText(value: string | undefined, label: string): string {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty`);
  }
  return value;
}

/** Require a non-empty value (void-throwing variant used in several commands). */
export function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}
