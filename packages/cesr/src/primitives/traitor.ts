import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseMatter } from "./matter.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";

export interface Traitor {
  code: string;
  qb64: string;
  trait: string;
  fullSize: number;
  fullSizeB2: number;
}

function isTraitName(name: string): boolean {
  return name.startsWith("Tag") || name === "No" || name === "Yes";
}

export function parseTraitor(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Traitor {
  const matter = parseMatter(input, cold);
  const name = MATTER_CODE_NAMES[matter.code as keyof typeof MATTER_CODE_NAMES] ?? "";
  if (!isTraitName(name)) {
    throw new UnknownCodeError(`Expected trait code, got ${matter.code}`);
  }

  return {
    code: matter.code,
    qb64: matter.qb64,
    trait: name,
    fullSize: matter.fullSize,
    fullSizeB2: matter.fullSizeB2,
  };
}
