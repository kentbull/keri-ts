import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { matterCodexName, VERFER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

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
    if (!VERFER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected verification key code, got ${this.code}`,
      );
    }
  }

  get key(): Uint8Array {
    return this.raw;
  }

  get algorithm(): string {
    return matterCodexName(this.code) ?? "UnknownKey";
  }
}

/** Parse and hydrate `Verfer` from txt/qb2 bytes. */
export function parseVerfer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verfer {
  return new Verfer(parseMatter(input, cold));
}
