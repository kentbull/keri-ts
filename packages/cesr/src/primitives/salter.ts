import { UnknownCodeError } from "../core/errors.ts";
import { SALTER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";

/**
 * Salt primitive for deterministic secret/signer derivation workflows.
 *
 * KERIpy substance: Salter stores random or fixed salt bytes and is used as
 * input to deterministic signer/seed generation paths.
 */
export class Salter extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!SALTER_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected salt code, got ${this.code}`);
    }
  }

  /** Raw salt bytes used by key-derivation consumers. */
  get salt(): Uint8Array {
    return this.raw;
  }
}
