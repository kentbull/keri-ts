import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Verfer {
  code: string;
  qb64: string;
  key: Uint8Array;
  algorithm: string;
  fullSize: number;
  fullSizeB2: number;
}

const VERFER_CODE_NAMES = new Set([
  "Ed25519N",
  "Ed25519",
  "ECDSA_256k1N",
  "ECDSA_256k1",
  "ECDSA_256r1N",
  "ECDSA_256r1",
  "Ed448N",
  "Ed448",
]);

export function parseVerfer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verfer {
  const matter = parseMatter(input, cold);
  const name =
    MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!VERFER_CODE_NAMES.has(name)) {
    throw new UnknownCodeError(
      `Expected verification key code, got ${matter.code}`,
    );
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    key: matter.raw,
    algorithm: name,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
