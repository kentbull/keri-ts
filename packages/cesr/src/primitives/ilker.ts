import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { ILKER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { Tagger } from "./tagger.ts";

/**
 * Message-type primitive (`ilk`) encoded via Tagger compact tag semantics.
 *
 * KERIpy semantics: `Ilker` is restricted to Tag3 (`X`) values that carry
 * compact Base64 ilk identifiers.
 */
export class Ilker extends Tagger {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!ILKER_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected ilker Tag3 code, got ${this.code}`);
    }
  }

  /** Decoded ilk value (alias of tag payload for this subclass). */
  get ilk(): string {
    return this.tag;
  }
}

/** Parse and hydrate `Ilker` from txt/qb2 bytes. */
export function parseIlker(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Ilker {
  return new Ilker(parseMatter(input, cold));
}
