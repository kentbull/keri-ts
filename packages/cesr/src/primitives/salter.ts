import { UnknownCodeError } from "../core/errors.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
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
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (name !== "Salt_128" && name !== "Salt_256") {
      throw new UnknownCodeError(`Expected salt code, got ${this.code}`);
    }
  }

  /** Raw salt bytes used by key-derivation consumers. */
  get salt(): Uint8Array {
    return this.raw;
  }
}
