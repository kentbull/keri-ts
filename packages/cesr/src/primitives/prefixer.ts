import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Prefixer {
  code: string;
  qb64: string;
  prefix: string;
  fullSize: number;
  fullSizeB2: number;
}

const PREFIX_CODE_NAMES = new Set([
  "Ed25519N",
  "ECDSA_256k1N",
  "ECDSA_256r1N",
  "Ed448N",
]);

export function parsePrefixer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Prefixer {
  const matter = parseMatter(input, cold);
  const name =
    MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!PREFIX_CODE_NAMES.has(name)) {
    throw new UnknownCodeError(`Expected prefix code, got ${matter.code}`);
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    prefix: matter.qb64,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
