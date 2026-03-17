import { UnknownCodeError } from "../core/errors.ts";
import { DECRYPTER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";

/**
 * Private-key decryption primitive for asymmetric envelope payloads.
 *
 * KERIpy substance: decrypter material is private X25519 key material used to
 * recover plaintext from cipher envelopes (often derived from signing seeds).
 */
export class Decrypter extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    if (!DECRYPTER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected decrypter key code, got ${this.code}`,
      );
    }
  }
}
