import type { CesrDomain } from "./types.ts";

/** Domain-sensitive token size helper (qb64 vs qb2). */
export function tokenSize(
  token: { fullSize: number; fullSizeB2: number },
  cold: CesrDomain,
): number {
  return cold === "bny" ? token.fullSizeB2 : token.fullSize;
}

/** Domain-sensitive counter unit (quadlet count for txt, triplet count for bny). */
export function unitBytes(cold: CesrDomain): number {
  return cold === "bny" ? 3 : 4;
}

/** Attachment parsing domains supported by the parser. */
export function isCesrDomain(cold: string): cold is CesrDomain {
  return cold === "txt" || cold === "bny";
}
