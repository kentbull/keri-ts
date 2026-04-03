import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { matterCodexName, VERFER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { transferableForVerferCode, verifySignatureByVerferCode } from "./signature-suite.ts";

/**
 * Verification-key primitive.
 *
 * KERIpy substance: `Verfer` wraps public verification key material and
 * constrains accepted derivation codes to verifier key families.
 */
export class Verfer extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
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

  /** Whether this verifier code is transferable in KERI prefix semantics. */
  get transferable(): boolean {
    return transferableForVerferCode(this.code);
  }

  /** Verify one raw signature against one serialized message via this verifier's suite code. */
  verify(sig: Uint8Array, ser: Uint8Array): boolean {
    return verifySignatureByVerferCode(this.code, this.raw, sig, ser);
  }
}

/** Parse and hydrate `Verfer` from txt/qb2 bytes. */
export function parseVerfer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verfer {
  return new Verfer(parseMatter(input, cold));
}
