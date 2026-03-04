import { UnknownCodeError } from "../core/errors.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit } from "./matter.ts";

/**
 * Public-key encryption primitive for asymmetric envelope encryption.
 *
 * KERIpy substance: Encrypter uses public key material (typically X25519,
 * optionally derived from verifier keys) to produce ciphertext envelopes.
 * This TS class validates material type; encryption ops live in crypto layers.
 */
export class Encrypter extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (name !== "X25519") {
      throw new UnknownCodeError(
        `Expected encrypter key code, got ${this.code}`,
      );
    }
  }
}
