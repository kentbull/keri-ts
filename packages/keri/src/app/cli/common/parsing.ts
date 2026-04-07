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

/** Parse one CLI/file threshold input into semantic numeric or weighted form. */
export function parseThresholdOption(
  value: string | undefined,
): ThresholdSith | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as ThresholdSith;
  }
  return trimmed;
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
  return JSON.parse(text) as InceptFileOptions;
}
