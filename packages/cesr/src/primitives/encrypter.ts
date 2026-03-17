import { UnknownCodeError } from "../core/errors.ts";
import { ENCRYPTER_CODES } from "./codex.ts";
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
    super(init);
    if (!ENCRYPTER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected encrypter key code, got ${this.code}`,
      );
    }
  }
}
