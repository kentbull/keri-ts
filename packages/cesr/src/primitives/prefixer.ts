import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

const PREFIX_CODE_NAMES = new Set([
  "Ed25519N",
  "ECDSA_256k1N",
  "ECDSA_256r1N",
  "Ed448N",
]);

/**
 * Identifier-prefix primitive.
 *
 * KERIpy substance: `Prefixer` represents AID prefix material and restricts
 * accepted codes to non-transferable/basic prefix derivation families.
 */
export class Prefixer extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (!PREFIX_CODE_NAMES.has(name)) {
      throw new UnknownCodeError(`Expected prefix code, got ${this.code}`);
    }
  }

  get prefix(): string {
    return this.qb64;
  }
}

/** Parse and hydrate `Prefixer` from txt/qb2 bytes. */
export function parsePrefixer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Prefixer {
  return new Prefixer(parseMatter(input, cold));
}
