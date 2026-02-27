export interface InceptFileOptions {
  transferable?: boolean;
  wits?: string[];
  icount?: number;
  isith?: string;
  ncount?: number;
  nsith?: string;
  toad?: number;
  estOnly?: boolean;
  data?: unknown[];
  delpre?: string;
}

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

export function loadInceptFileOptions(path: string): InceptFileOptions {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text) as InceptFileOptions;
}
