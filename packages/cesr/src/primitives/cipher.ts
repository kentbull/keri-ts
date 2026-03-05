import { UnknownCodeError } from "../core/errors.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit } from "./matter.ts";

function isCipherName(name: string): boolean {
  return name.startsWith("X25519_Cipher_");
}

/**
 * Ciphertext primitive for encrypted secret payloads.
 *
 * KERIpy substance: cipher material carries encrypted seed/salt-like plaintext
 * while code determines ciphertext family/size semantics.
 */
export class Cipher extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (!isCipherName(name)) {
      throw new UnknownCodeError(`Expected cipher code, got ${this.code}`);
    }
  }
}
