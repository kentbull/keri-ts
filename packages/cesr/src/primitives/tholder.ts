import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

function isNumericName(name: string): boolean {
  return name === "Short" || name === "Long" || name === "Big" ||
    name === "Tall" ||
    name === "Large" || name === "Great" || name === "Vast";
}

function isWeightedName(name: string): boolean {
  return name.startsWith("StrB64_") || name.startsWith("StrB64_Big_");
}

/**
 * Threshold expression primitive.
 *
 * KERIpy substance: `Tholder` supports both numeric thresholds and weighted
 * threshold expressions encoded as StrB64 payloads.
 */
export class Tholder extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (!isNumericName(name) && !isWeightedName(name)) {
      throw new UnknownCodeError(`Expected threshold code, got ${this.code}`);
    }
  }

  get sith(): string {
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (isNumericName(name)) {
      return [...this.raw].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
        .toString(16);
    }
    return new TextDecoder().decode(this.raw);
  }
}

/** Parse and hydrate `Tholder` from txt/qb2 bytes. */
export function parseTholder(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Tholder {
  return new Tholder(parseMatter(input, cold));
}
