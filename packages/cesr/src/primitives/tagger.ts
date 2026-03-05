import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import { TAG_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

/**
 * Extract unpadded tag payload from a tag-coded qb64 token.
 *
 * Tag codes store the value in soft-code characters, optionally with xtra
 * prepad (`xs`) that must be removed before exposing the semantic tag value.
 */
function extractTag(code: string, qb64: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage) {
    throw new UnknownCodeError(`Unknown tag code ${code}`);
  }
  const soft = qb64.slice(sizage.hs, sizage.hs + sizage.ss);
  return soft.slice(sizage.xs);
}

/** True when `code` belongs to KERIpy `TagCodex` family. */
export function isTaggerCode(code: string): boolean {
  return TAG_CODES.has(code);
}

/**
 * Compact "special" primitive for CESR tag values stored in soft-code fields.
 *
 * Invariant: instances always represent one of `TagCodex` codes.
 */
export class Tagger extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!isTaggerCode(this.code)) {
      throw new UnknownCodeError(`Expected tag code, got ${this.code}`);
    }
  }

  /** Decoded tag value with prepad removed. */
  get tag(): string {
    return extractTag(this.code, this.qb64);
  }
}

/** Parse and hydrate a `Tagger` from txt or qb2 stream bytes. */
export function parseTagger(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Tagger {
  return new Tagger(parseMatter(input, cold));
}
