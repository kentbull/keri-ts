import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";

export interface Labeler {
  code: string;
  qb64: string;
  fullSize: number;
  fullSizeB2: number;
  token: string;
  label: string;
  index: number;
  bytes: Uint8Array;
}

const LABELER_CODES = new Set(["V", "W"]);

export function parseLabeler(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Labeler {
  const matter = parseMatter(input, cold);
  if (!LABELER_CODES.has(matter.code)) {
    throw new UnknownCodeError(`Expected labeler code (V/W), got ${matter.code}`);
  }
  let index = 0;
  for (const b of matter.raw) {
    index = (index << 8) | b;
  }
  const text = new TextDecoder().decode(matter.raw).replace(/\u0000/g, "");
  const label = text.length > 0 ? text : matter.qb64.slice(matter.code.length);

  return {
    code: matter.code,
    qb64: matter.qb64,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
    token: matter.qb64,
    label,
    index,
    bytes: matter.raw,
  };
}
