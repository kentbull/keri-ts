import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

function isDigestName(name: string): boolean {
  return name.startsWith("Blake") || name.startsWith("SHA2_") ||
    name.startsWith("SHA3_");
}

/**
 * Self-addressing identifier digest primitive.
 *
 * KERIpy substance: `Saider` is digest-qualified material used as SAD SAID
 * values; this class validates digest-family code semantics.
 */
export class Saider extends Matter {
  constructor(init: Matter | MatterInit) {
    const matter = init instanceof Matter ? init : new Matter(init);
    super(matter);
    const name =
      MATTER_CODE_NAMES[this.code as keyof typeof MATTER_CODE_NAMES] ??
        "";
    if (!isDigestName(name)) {
      throw new UnknownCodeError(
        `Expected said digest code, got ${this.code}`,
      );
    }
  }

  get said(): string {
    return this.qb64;
  }

  get digest(): Uint8Array {
    return this.raw;
  }
}

/** Parse and hydrate `Saider` from txt/qb2 bytes. */
export function parseSaider(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Saider {
  return new Saider(parseMatter(input, cold));
}
