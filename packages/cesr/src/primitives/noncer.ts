import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Noncer {
  code: string;
  qb64: string;
  nonce: Uint8Array;
  fullSize: number;
  fullSizeB2: number;
}

const NONCE_CODE_NAMES = new Set(["Salt_128", "Salt_256"]);

export function parseNoncer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Noncer {
  const matter = parseMatter(input, cold);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!NONCE_CODE_NAMES.has(name)) {
    throw new UnknownCodeError(`Expected nonce code, got ${matter.code}`);
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    nonce: matter.raw,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
