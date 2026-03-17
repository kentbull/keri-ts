import { UnknownCodeError } from "../core/errors.ts";
import { SIGNER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";

/**
 * Signing-seed primitive.
 *
 * KERIpy substance: Signer wraps private seed material that is used to derive
 * signing key pairs and associated verifier material; this TS layer constrains
 * codex validity while higher crypto layers perform key derivation/signing.
 */
export class Signer extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!SIGNER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected signer seed code, got ${this.code}`,
      );
    }
  }

  /** Raw seed bytes for signer key-derivation/instantiation. */
  get seed(): Uint8Array {
    return this.raw;
  }
}
