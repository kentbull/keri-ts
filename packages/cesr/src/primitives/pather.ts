import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Pather {
  code: string;
  qb64: string;
  path: string;
  fullSize: number;
  fullSizeB2: number;
}

function isPatherCode(code: string): boolean {
  const name = MATTER_CODE_NAMES[code as keyof typeof MATTER_CODE_NAMES] ?? "";
  return name.startsWith("StrB64_") || name.startsWith("StrB64_Big_") ||
    name.startsWith("Bytes_") || name.startsWith("Bytes_Big_");
}

export function parsePather(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Pather {
  const matter = parseMatter(input, cold);
  if (!isPatherCode(matter.code)) {
    throw new UnknownCodeError(`Expected pather-compatible code, got ${matter.code}`);
  }
  // For parser-level fidelity we preserve encoded path token text.
  const path = matter.qb64.slice(matter.code.length);
  return {
    code: matter.code,
    qb64: matter.qb64,
    path,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
