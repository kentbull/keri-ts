import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Non-indexed signature primitive.
 *
 * KERIpy substance: `Cigar` wraps detached signature material where code
 * determines signature suite and payload holds raw signature bytes.
 */
export class Cigar extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ?? "";
    if (!name.endsWith("_Sig")) {
      throw new UnknownCodeError(
        `Expected non-indexed signature code, got ${this.code}`,
      );
    }
  }

  get sig(): Uint8Array {
    return this.raw;
  }

  get algorithm(): string {
    return MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
      "UnknownSig";
  }
}

/** Parse and hydrate `Cigar` from txt/qb2 bytes. */
export function parseCigar(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Cigar {
  return new Cigar(parseMatter(input, cold));
}
