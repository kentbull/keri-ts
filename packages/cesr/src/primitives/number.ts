import { UnknownCodeError } from "../core/errors.ts";
import type { CesrDomain } from "../core/types.ts";
import { NUMBER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/** KERIpy's automatic numeric ladder; fixed-width 0H/0A remain explicit wire choices. */
const NUMBER_WIDTHS = [["M", 2], ["R", 5], ["N", 8], ["S", 11], ["T", 14], ["U", 17]] as const;

/**
 * Ordinal number primitive.
 *
 * KERIpy substance: `Number` encodes non-negative integer values using compact
 * numeric codex families while preserving deterministic serialization.
 */
export class NumberPrimitive extends Matter {
  /** Encode a non-negative bigint with KERIpy's smallest automatic numeric code. */
  static fromNum(value: bigint): NumberPrimitive {
    if (typeof value !== "bigint") throw new TypeError("Expected a bigint CESR number");
    if (value < 0n) throw new RangeError("CESR numbers must be non-negative");
    // A width of n bytes carries values below 2^(8n); reject before allocating.
    const entry = NUMBER_WIDTHS.find(([, width]) => value < (1n << BigInt(width * 8)));
    if (!entry) throw new RangeError("CESR number exceeds 136 bits");
    const [code, width] = entry;
    const raw = new Uint8Array(width);
    // Fill from the least significant byte while retaining leading zero bytes.
    for (let at = width - 1; at >= 0; at--, value >>= 8n) {
      raw[at] = Number(value & 0xffn);
    }
    return new NumberPrimitive({ code, raw });
  }

  /** Hydrate qualified numeric wire material without changing its explicit code. */
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!NUMBER_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected number code, got ${this.code}`);
    }
  }

  get num(): bigint {
    let value = 0n;
    for (const b of this.raw) {
      value = (value << 8n) | BigInt(b);
    }
    return value;
  }

  get numh(): string {
    return this.num.toString(16);
  }
}

/** Parse and hydrate `NumberPrimitive` from txt/qb2 bytes. */
export function parseNumber(
  input: Uint8Array,
  cold: CesrDomain,
): NumberPrimitive {
  return new NumberPrimitive(parseMatter(input, cold));
}
