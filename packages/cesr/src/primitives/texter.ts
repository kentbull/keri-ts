import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { TEXTER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

function isTexterCode(code: string): boolean {
  return TEXTER_CODES.has(code);
}

/**
 * Raw-bytes text primitive.
 *
 * KERIpy substance: `Texter` carries variable-length byte-string text (UTF-8
 * friendly) with Bytes codex families.
 */
export class Texter extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!isTexterCode(this.code)) {
      throw new UnknownCodeError(
        `Expected texter bytes code, got ${this.code}`,
      );
    }
  }

  get text(): string {
    return new TextDecoder().decode(this.raw);
  }
}

/** Parse and hydrate `Texter` from txt/qb2 bytes. */
export function parseTexter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Texter {
  return new Texter(parseMatter(input, cold));
}
