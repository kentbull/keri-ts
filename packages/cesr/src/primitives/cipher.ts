import { UnknownCodeError } from "../core/errors.ts";
import { CIPHER_X25519_ALL_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";

/**
 * Ciphertext primitive for encrypted secret payloads.
 *
 * KERIpy substance: cipher material carries encrypted seed/salt-like plaintext
 * while code determines ciphertext family/size semantics.
 */
export class Cipher extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!CIPHER_X25519_ALL_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected cipher code, got ${this.code}`);
    }
  }
}
