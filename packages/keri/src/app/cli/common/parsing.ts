import type { ThresholdSith } from "../../../../../cesr/mod.ts";

/** JSON file schema for `tufa incept --file` option loading. */
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

/** JSON file schema for `tufa rotate --file` option loading. */
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

/** Parse one CLI/file threshold input into semantic numeric or weighted form. */
export function parseThresholdOption(
  value: string | undefined,
): ThresholdSith | undefined {
  return normalizeThresholdOption(value);
}

/** Parse inline JSON values or `@file` references used by CLI `--data` flags. */
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

function loadJson(path: string): unknown {
  return JSON.parse(Deno.readTextFileSync(path));
}

function isNumber(value: string): boolean {
  if (value.trim().length === 0) {
    return false;
  }
  return !Number.isNaN(Number(value));
}

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

/** Load one JSON file of inception options using the CLI file-input contract. */
export function loadInceptFileOptions(path: string): InceptFileOptions {
  const text = Deno.readTextFileSync(path);
  const loaded = JSON.parse(text) as InceptFileOptions;
  return {
    ...loaded,
    isith: normalizeThresholdOption(loaded.isith),
    nsith: normalizeThresholdOption(loaded.nsith),
  };
}

/** Load one JSON file of rotation options using the CLI file-input contract. */
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

/** Load one required CLI text argument or `@file` reference as UTF-8 bytes. */
export function loadTextArgument(text: string): Uint8Array {
  const source = text.startsWith("@")
    ? Deno.readTextFileSync(text.slice(1))
    : text;
  return new TextEncoder().encode(source);
}
