import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import {
  MATTER_CODE_NAMES,
  MATTER_SIZES,
} from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/** Project compact CESR datetime encoding to RFC3339/ISO-8601 text form. */
function toIso8601(dts: string): string {
  return dts.replaceAll("c", ":").replaceAll("d", ".").replaceAll("p", "+");
}

/**
 * Datetime primitive for compact RFC3339/ISO-8601 representations.
 *
 * KERIpy substance: `Dater` encodes datetime text by substituting non-base64
 * characters (`:`, `.`, `+`) with base64-safe symbols (`c`, `d`, `p`).
 */
export class Dater extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name = MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES];
    if (name !== "DateTime") {
      throw new UnknownCodeError(
        `Expected dater DateTime code, got ${this.code}`,
      );
    }
  }

  get dts(): string {
    const sizage = MATTER_SIZES.get(this.code);
    if (!sizage) {
      throw new UnknownCodeError(`Unknown dater code ${this.code}`);
    }
    return this.qb64.slice(sizage.hs);
  }

  get iso8601(): string {
    return toIso8601(this.dts);
  }
}

/** Parse and hydrate `Dater` from txt/qb2 bytes. */
export function parseDater(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Dater {
  return new Dater(parseMatter(input, cold));
}
