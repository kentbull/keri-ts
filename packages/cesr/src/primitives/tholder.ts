import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Tholder {
  code: string;
  qb64: string;
  sith: string;
  fullSize: number;
  fullSizeB2: number;
}

function isNumericName(name: string): boolean {
  return name === "Short" || name === "Long" || name === "Big" ||
    name === "Tall" ||
    name === "Large" || name === "Great" || name === "Vast";
}

function isWeightedName(name: string): boolean {
  return name.startsWith("StrB64_") || name.startsWith("StrB64_Big_");
}

export function parseTholder(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Tholder {
  const matter = parseMatter(input, cold);
  const name =
    MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!isNumericName(name) && !isWeightedName(name)) {
    throw new UnknownCodeError(`Expected threshold code, got ${matter.code}`);
  }

  const sith = isNumericName(name)
    ? [...matter.raw].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n).toString(
      16,
    )
    : new TextDecoder().decode(matter.raw);

  return {
    code: matter.code,
    qb64: matter.qb64,
    sith,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
