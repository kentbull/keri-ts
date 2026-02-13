import { parseMatterFromText } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface PrimitiveToken {
  code: string;
  name: string;
  qb64: string;
  raw: Uint8Array;
  fullSize: number;
}

export function parsePrimitiveFromText(input: Uint8Array): PrimitiveToken {
  const matter = parseMatterFromText(input);
  const name =
    MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ??
      "UnknownPrimitive";
  return {
    code: matter.code,
    name,
    qb64: matter.qb64,
    raw: matter.raw,
    fullSize: matter.fullSize,
  };
}

export function supportedPrimitiveCodes(): string[] {
  return Object.keys(MATTER_CODE_NAMES).sort();
}
