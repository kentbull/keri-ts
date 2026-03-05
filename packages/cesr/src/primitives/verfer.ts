import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

const VERFER_CODE_NAMES = new Set([
  "Ed25519N",
  "Ed25519",
  "ECDSA_256k1N",
  "ECDSA_256k1",
  "ECDSA_256r1N",
  "ECDSA_256r1",
  "Ed448N",
  "Ed448",
]);

/**
 * Verification-key primitive.
 *
 * KERIpy substance: `Verfer` wraps public verification key material and
 * constrains accepted derivation codes to verifier key families.
 */
export class Verfer extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ?? "";
    if (!VERFER_CODE_NAMES.has(name)) {
      throw new UnknownCodeError(
        `Expected verification key code, got ${this.code}`,
      );
    }
  }

  get key(): Uint8Array {
    return this.raw;
  }

  get algorithm(): string {
    return MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
      "UnknownKey";
  }
}

/** Parse and hydrate `Verfer` from txt/qb2 bytes. */
export function parseVerfer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verfer {
  return new Verfer(parseMatter(input, cold));
}
