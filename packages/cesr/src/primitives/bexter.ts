import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Bexter {
  code: string;
  qb64: string;
  bext: string;
  fullSize: number;
  fullSizeB2: number;
}

function isBexterCode(code: string): boolean {
  const name = MATTER_CODE_NAMES[code as keyof typeof MATTER_CODE_NAMES] ?? "";
  return name.startsWith("StrB64_") || name.startsWith("StrB64_Big_");
}

export function parseBexter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Bexter {
  const matter = parseMatter(input, cold);
  if (!isBexterCode(matter.code)) {
    throw new UnknownCodeError(
      `Expected bexter strb64 code, got ${matter.code}`,
    );
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    bext: new TextDecoder().decode(matter.raw),
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
