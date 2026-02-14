import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Seqner {
  code: string;
  qb64: string;
  sn: bigint;
  snh: string;
  fullSize: number;
  fullSizeB2: number;
}

export function parseSeqner(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Seqner {
  const matter = parseMatter(input, cold);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES];
  if (name !== "Salt_128") {
    throw new UnknownCodeError(
      `Expected seqner Salt_128 code, got ${matter.code}`,
    );
  }

  let sn = 0n;
  for (const b of matter.raw) {
    sn = (sn << 8n) | BigInt(b);
  }
  const snh = sn.toString(16).padStart(matter.raw.length * 2, "0");

  return {
    code: matter.code,
    qb64: matter.qb64,
    sn,
    snh,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
