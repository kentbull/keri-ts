import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { p256 } from "npm:@noble/curves@1.9.7/nist";
import { secp256k1 } from "npm:@noble/curves@1.9.7/secp256k1";
import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { matterCodexName, MtrDex, VERFER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

type SupportedVerferCode =
  | typeof MtrDex.Ed25519
  | typeof MtrDex.Ed25519N
  | typeof MtrDex.ECDSA_256k1
  | typeof MtrDex.ECDSA_256k1N
  | typeof MtrDex.ECDSA_256r1
  | typeof MtrDex.ECDSA_256r1N;

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
  private readonly _verifyRaw: (sig: Uint8Array, ser: Uint8Array) => boolean;

  constructor(init: Matter | MatterInit) {
    super(init);
    Verfer.assertSupportedCode(this.code);
    this._verifyRaw = Verfer.bindSuite(this.code, this.raw);
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
    return this._verifyRaw(sig, ser);
  }

  private static assertSupportedCode(
    code: string,
  ): asserts code is SupportedVerferCode {
    if (!VERFER_CODES.has(code)) {
      throw new UnknownCodeError(
        `Expected verification key code, got ${code}`,
      );
    }
  }

  /** Bind one KERIpy-style verifier suite at construction time. */
  private static bindSuite(
    code: SupportedVerferCode,
    key: Uint8Array,
  ): (sig: Uint8Array, ser: Uint8Array) => boolean {
    switch (code) {
      case MtrDex.Ed25519:
      case MtrDex.Ed25519N:
        return (sig, ser) => ed25519.verify(sig, ser, key);
      case MtrDex.ECDSA_256k1:
      case MtrDex.ECDSA_256k1N:
        return (sig, ser) =>
          secp256k1.verify(sig, ser, key, {
            format: "compact",
            lowS: false,
            prehash: true,
          });
      case MtrDex.ECDSA_256r1:
      case MtrDex.ECDSA_256r1N:
        return (sig, ser) =>
          p256.verify(sig, ser, key, {
            format: "compact",
            lowS: false,
            prehash: true,
          });
    }
  }
}

/** Parse and hydrate `Verfer` from txt/qb2 bytes. */
export function parseVerfer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Verfer {
  return new Verfer(parseMatter(input, cold));
}
