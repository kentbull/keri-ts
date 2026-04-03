import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { matterCodexName, VERFER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { verifySignatureByVerferCode } from "./signature-suite.ts";

/**
 * Verification-key primitive.
 *
 * KERIpy substance: `Verfer` wraps public verification key material and
 * constrains accepted derivation codes to verifier key families.
 *
 * Responsibility split:
 * - `Matter` owns derivation-code semantics such as transferability
 * - `Verfer` owns suite-dispatched signature verification
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

  /** Raw public verification key bytes used by suite-specific verify paths. */
  get key(): Uint8Array {
    return this.raw;
  }

  /** Human-oriented generated codex member name for diagnostics and tooling. */
  get algorithm(): string {
    return matterCodexName(this.code) ?? "UnknownKey";
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
