import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { parseMatterFromText } from "./matter.ts";

/** Lossless summary of one primitive token parsed from text-domain CESR. */
export interface PrimitiveToken {
  code: string;
  name: string;
  qb64: string;
  raw: Uint8Array;
  fullSize: number;
}

/** Parse one text-domain primitive token and include its generated code name. */
export function parsePrimitiveFromText(input: Uint8Array): PrimitiveToken {
  const matter = parseMatterFromText(input);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES]
    ?? "UnknownPrimitive";
  return {
    code: matter.code,
    name,
    qb64: matter.qb64,
    raw: matter.raw,
    fullSize: matter.fullSize,
  };
}

/** Return all known generated matter codes sorted for deterministic scans. */
export function supportedPrimitiveCodes(): string[] {
  return Object.keys(MATTER_CODE_NAMES).sort();
}
