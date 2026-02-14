import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Cigar {
  code: string;
  qb64: string;
  sig: Uint8Array;
  algorithm: string;
  fullSize: number;
  fullSizeB2: number;
}

export function parseCigar(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Cigar {
  const matter = parseMatter(input, cold);
  const name =
    MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!name.endsWith("_Sig")) {
    throw new UnknownCodeError(
      `Expected non-indexed signature code, got ${matter.code}`,
    );
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    sig: matter.raw,
    algorithm: name,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
