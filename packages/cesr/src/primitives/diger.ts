import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Diger {
  code: string;
  qb64: string;
  digest: Uint8Array;
  algorithm: string;
  fullSize: number;
  fullSizeB2: number;
}

function isDigestName(name: string): boolean {
  return name.startsWith("Blake") || name.startsWith("SHA2_") ||
    name.startsWith("SHA3_");
}

export function parseDiger(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Diger {
  const matter = parseMatter(input, cold);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!isDigestName(name)) {
    throw new UnknownCodeError(`Expected digest code, got ${matter.code}`);
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    digest: matter.raw,
    algorithm: name,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
