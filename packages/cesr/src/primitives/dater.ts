import { UnknownCodeError } from "../core/errors.ts";
import type { CesrDomain } from "../core/types.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import { DATER_CODES, MtrDex } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/** Project compact CESR datetime encoding to RFC3339/ISO-8601 text form. */
function toIso8601(dts: string): string {
  return dts.replaceAll("c", ":").replaceAll("d", ".").replaceAll("p", "+");
}

/** Explicit datetime input; encoded material takes precedence as in KERIpy. */
export interface DaterInit extends MatterInit {
  dts?: string;
}

/**
 * Datetime primitive for compact RFC3339/ISO-8601 representations.
 *
 * KERIpy substance: `Dater` encodes datetime text by substituting non-base64
 * characters (`:`, `.`, `+`) with base64-safe symbols (`c`, `d`, `p`).
 */
export class Dater extends Matter {
  /** Construct from qualified material or an explicit RFC3339 datetime string. */
  constructor(init: Matter | DaterInit) {
    const fromDatetime = !(init instanceof Matter) && init.raw === undefined
      && init.qb64b === undefined && init.qb64 === undefined && init.qb2 === undefined
      && init.dts !== undefined;
    super(
      fromDatetime
        ? { qb64: MtrDex.DateTime + init.dts!.replaceAll(":", "c").replaceAll(".", "d").replaceAll("+", "p") }
        : init,
    );
    if (!DATER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected dater DateTime code, got ${this.code}`,
      );
    }
  }

  /** Return the RFC3339 datetime, reversing the CESR character substitutions. */
  get dts(): string {
    const sizage = MATTER_SIZES.get(this.code);
    if (!sizage) {
      throw new UnknownCodeError(`Unknown dater code ${this.code}`);
    }
    return toIso8601(this.qb64.slice(sizage.hs));
  }
}

/** Parse and hydrate `Dater` from txt/qb2 bytes. */
export function parseDater(
  input: Uint8Array,
  cold: CesrDomain,
): Dater {
  return new Dater(parseMatter(input, cold));
}
