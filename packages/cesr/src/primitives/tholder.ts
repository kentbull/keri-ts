import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { THOLDER_NUMERIC_CODES, THOLDER_WEIGHTED_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { t } from '../core/bytes.ts'

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
    if (
      !THOLDER_NUMERIC_CODES.has(this.code) &&
      !THOLDER_WEIGHTED_CODES.has(this.code)
    ) {
      throw new UnknownCodeError(`Expected threshold code, got ${this.code}`);
    }
  }

  get sith(): string {
    if (THOLDER_NUMERIC_CODES.has(this.code)) {
      return [...this.raw].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
        .toString(16);
    }
    return t(this.raw);
  }
}

/** Parse and hydrate `Tholder` from txt/qb2 bytes. */
export function parseTholder(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Tholder {
  return new Tholder(parseMatter(input, cold));
}
