import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface NumberPrimitive {
  code: string;
  qb64: string;
  num: bigint;
  numh: string;
  fullSize: number;
  fullSizeB2: number;
}

const NUMBER_CODE_NAMES = new Set([
  "Short",
  "Long",
  "Big",
  "Tall",
  "Large",
  "Great",
  "Vast",
]);

export function parseNumber(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): NumberPrimitive {
  const matter = parseMatter(input, cold);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES];
  if (!name || !NUMBER_CODE_NAMES.has(name)) {
    throw new UnknownCodeError(`Expected number code, got ${matter.code}`);
  }

  let num = 0n;
  for (const b of matter.raw) {
    num = (num << 8n) | BigInt(b);
  }
  return {
    code: matter.code,
    qb64: matter.qb64,
    num,
    numh: num.toString(16),
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
