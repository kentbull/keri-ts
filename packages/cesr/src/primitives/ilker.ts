import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";

export interface Ilker {
  code: string;
  qb64: string;
  fullSize: number;
  fullSizeB2: number;
  ilk: string;
}

export function parseIlker(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Ilker {
  const matter = parseMatter(input, cold);
  if (matter.code !== "X") {
    throw new UnknownCodeError(`Expected ilker code X, got ${matter.code}`);
  }
  return {
    code: matter.code,
    qb64: matter.qb64,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
    ilk: matter.qb64.slice(matter.code.length),
  };
}
