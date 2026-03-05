import { UnknownCodeError } from "../core/errors.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit } from "./matter.ts";

const SIGNER_CODE_NAMES = new Set([
  "Ed25519_Seed",
  "ECDSA_256k1_Seed",
  "ECDSA_256r1_Seed",
]);

/**
 * Signing-seed primitive.
 *
 * KERIpy substance: Signer wraps private seed material that is used to derive
 * signing key pairs and associated verifier material; this TS layer constrains
 * codex validity while higher crypto layers perform key derivation/signing.
 */
export class Signer extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (!SIGNER_CODE_NAMES.has(name)) {
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
