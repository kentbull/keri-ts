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

/** Load one JSON file of inception options using the CLI file-input contract. */
export function loadInceptFileOptions(path: string): InceptFileOptions {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text) as InceptFileOptions;
}
