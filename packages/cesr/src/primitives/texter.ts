import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Texter {
  code: string;
  qb64: string;
  text: string;
  fullSize: number;
  fullSizeB2: number;
}

function isTexterCode(code: string): boolean {
  const name = MATTER_CODE_NAMES[code as keyof typeof MATTER_CODE_NAMES] ?? "";
  return name.startsWith("Bytes_") || name.startsWith("Bytes_Big_");
}

export function parseTexter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Texter {
  const matter = parseMatter(input, cold);
  if (!isTexterCode(matter.code)) {
    throw new UnknownCodeError(
      `Expected texter bytes code, got ${matter.code}`,
    );
  }
  return {
    code: matter.code,
    qb64: matter.qb64,
    text: new TextDecoder().decode(matter.raw),
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
