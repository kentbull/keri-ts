import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { TRAIT_TAGS } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { Tagger } from "./tagger.ts";

/**
 * Configuration-trait primitive for key-event trait tags.
 *
 * KERIpy semantics: trait values are compact tags validated against canonical
 * `TraitDex` membership rather than a local string list.
 */
export class Traitor extends Tagger {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!TRAIT_TAGS.has(this.tag)) {
      throw new UnknownCodeError(`Invalid trait tag for Traitor: ${this.tag}`);
    }
  }

  /** Trait string token (alias of validated tag payload). */
  get trait(): string {
    return this.tag;
  }
}

/** Parse and hydrate `Traitor` from txt/qb2 bytes. */
export function parseTraitor(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Traitor {
  return new Traitor(parseMatter(input, cold));
}
