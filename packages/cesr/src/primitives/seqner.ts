import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Fixed-width sequence/ordinal primitive.
 *
 * KERIpy substance: `Seqner` forces fixed-size ordinal serialization (Salt_128
 * family) for lexicographically stable ordering in key-value namespaces.
 */
export class Seqner extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name = MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES];
    if (name !== "Salt_128") {
      throw new UnknownCodeError(
        `Expected seqner Salt_128 code, got ${this.code}`,
      );
    }
  }

  get sn(): bigint {
    let sn = 0n;
    for (const b of this.raw) {
      sn = (sn << 8n) | BigInt(b);
    }
    return sn;
  }

  get snh(): string {
    return this.sn.toString(16).padStart(this.raw.length * 2, "0");
  }
}

/** Parse and hydrate `Seqner` from txt/qb2 bytes. */
export function parseSeqner(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Seqner {
  return new Seqner(parseMatter(input, cold));
}
