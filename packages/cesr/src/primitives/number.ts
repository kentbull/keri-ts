import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { NUMBER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Ordinal number primitive.
 *
 * KERIpy substance: `Number` encodes non-negative integer values using compact
 * numeric codex families while preserving deterministic serialization.
 */
export class NumberPrimitive extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
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
  cold: Extract<ColdCode, "txt" | "bny">,
): NumberPrimitive {
  return new NumberPrimitive(parseMatter(input, cold));
}
