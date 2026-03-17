import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { CIGAR_CODES, matterCodexName } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Non-indexed signature primitive.
 *
 * KERIpy substance: `Cigar` wraps detached signature material where code
 * determines signature suite and payload holds raw signature bytes.
 */
export class Cigar extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!CIGAR_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected non-indexed signature code, got ${this.code}`,
      );
    }
  }

  get sig(): Uint8Array {
    return this.raw;
  }

  get algorithm(): string {
    return matterCodexName(this.code) ?? "UnknownSig";
  }
}

/** Parse and hydrate `Cigar` from txt/qb2 bytes. */
export function parseCigar(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Cigar {
  return new Cigar(parseMatter(input, cold));
}
