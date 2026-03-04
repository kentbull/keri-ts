import { UnknownCodeError } from "../core/errors.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
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
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (name !== "X25519_Private") {
      throw new UnknownCodeError(
        `Expected decrypter key code, got ${this.code}`,
      );
    }
  }
}
