import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { p256 } from "npm:@noble/curves@1.9.7/nist";
import { secp256k1 } from "npm:@noble/curves@1.9.7/secp256k1";
import { UnknownCodeError } from "../core/errors.ts";
import { MtrDex } from "./codex.ts";

type SupportedSignerCode =
  | typeof MtrDex.Ed25519_Seed
  | typeof MtrDex.ECDSA_256k1_Seed
  | typeof MtrDex.ECDSA_256r1_Seed;

type SupportedVerferCode =
  | typeof MtrDex.Ed25519
  | typeof MtrDex.Ed25519N
  | typeof MtrDex.ECDSA_256k1
  | typeof MtrDex.ECDSA_256k1N
  | typeof MtrDex.ECDSA_256r1
  | typeof MtrDex.ECDSA_256r1N;

/**
 * CESR-local authority for signature suite dispatch.
 *
 * Boundary contract:
 * - higher KERI runtime layers should choose primitives (`Signer`, `Verfer`,
 *   `Siger`, `Cigar`)
 * - this module chooses the concrete crypto implementation from CESR codes
 * - curve-specific imports should not leak into `Kever`, reply routing, app
 *   management code, or ordinary caller-facing crypto surfaces
 */

function assertSupportedSignerCode(
  code: string,
): asserts code is SupportedSignerCode {
  if (
    code !== MtrDex.Ed25519_Seed
    && code !== MtrDex.ECDSA_256k1_Seed
    && code !== MtrDex.ECDSA_256r1_Seed
  ) {
    throw new UnknownCodeError(`Unsupported signer seed code ${code}`);
  }
}

function assertSupportedVerferCode(
  code: string,
): asserts code is SupportedVerferCode {
  if (
    code !== MtrDex.Ed25519
    && code !== MtrDex.Ed25519N
    && code !== MtrDex.ECDSA_256k1
    && code !== MtrDex.ECDSA_256k1N
    && code !== MtrDex.ECDSA_256r1
    && code !== MtrDex.ECDSA_256r1N
  ) {
    throw new UnknownCodeError(`Unsupported verifier code ${code}`);
  }
}

/** All supported signer seed suites currently use 32-byte seeds. */
export function signerSeedSizeForCode(signerCode: string): number {
  assertSupportedSignerCode(signerCode);
  return 32;
}

/** Project one signer seed code to the verifier derivation code for the same suite. */
export function verferCodeForSignerCode(
  signerCode: string,
  transferable: boolean,
): string {
  assertSupportedSignerCode(signerCode);

  switch (signerCode) {
    case MtrDex.Ed25519_Seed:
      return transferable ? MtrDex.Ed25519 : MtrDex.Ed25519N;
    case MtrDex.ECDSA_256k1_Seed:
      return transferable ? MtrDex.ECDSA_256k1 : MtrDex.ECDSA_256k1N;
    case MtrDex.ECDSA_256r1_Seed:
      return transferable ? MtrDex.ECDSA_256r1 : MtrDex.ECDSA_256r1N;
  }
}

/**
 * Project one verifier code back to the signer seed code for the same suite.
 *
 * This inverse mapping exists so higher layers such as keeper-managed derived
 * signing can reconstruct the correct seed suite from persisted verifier keys
 * without importing curve-specific logic.
 */
export function signerCodeForVerferCode(verferCode: string): string {
  assertSupportedVerferCode(verferCode);

  switch (verferCode) {
    case MtrDex.Ed25519:
    case MtrDex.Ed25519N:
      return MtrDex.Ed25519_Seed;
    case MtrDex.ECDSA_256k1:
    case MtrDex.ECDSA_256k1N:
      return MtrDex.ECDSA_256k1_Seed;
    case MtrDex.ECDSA_256r1:
    case MtrDex.ECDSA_256r1N:
      return MtrDex.ECDSA_256r1_Seed;
  }
}

/** Derive one raw public verification key from seed bytes and signer-suite code. */
export function publicKeyForSignerCode(
  signerCode: string,
  seed: Uint8Array,
): Uint8Array {
  assertSupportedSignerCode(signerCode);

  switch (signerCode) {
    case MtrDex.Ed25519_Seed:
      return ed25519.getPublicKey(seed);
    case MtrDex.ECDSA_256k1_Seed:
      return secp256k1.getPublicKey(seed);
    case MtrDex.ECDSA_256r1_Seed:
      return p256.getPublicKey(seed);
  }
}

/** Create one raw detached signature from seed bytes and the suite implied by `signerCode`. */
export function signRawForSignerCode(
  signerCode: string,
  seed: Uint8Array,
  ser: Uint8Array,
): Uint8Array {
  assertSupportedSignerCode(signerCode);

  switch (signerCode) {
    case MtrDex.Ed25519_Seed:
      return ed25519.sign(ser, seed);
    case MtrDex.ECDSA_256k1_Seed:
      return secp256k1.sign(ser, seed, {
        format: "compact",
        lowS: false,
        prehash: true,
      }).toBytes("compact");
    case MtrDex.ECDSA_256r1_Seed:
      return p256.sign(ser, seed, {
        format: "compact",
        lowS: false,
        prehash: true,
      }).toBytes("compact");
  }
}

/**
 * Verify one raw signature through the verifier suite implied by `verferCode`.
 *
 * ECDSA parity note:
 * - KERI stores compact `r || s` signatures
 * - KERIpy verifies those as ECDSA-over-SHA256
 * - noble's `prehash: true` option preserves that message hashing rule while
 *   keeping DER/compact adaptation local to this module
 */
export function verifySignatureByVerferCode(
  verferCode: string,
  key: Uint8Array,
  sig: Uint8Array,
  ser: Uint8Array,
): boolean {
  assertSupportedVerferCode(verferCode);

  switch (verferCode) {
    case MtrDex.Ed25519:
    case MtrDex.Ed25519N:
      return ed25519.verify(sig, ser, key);
    case MtrDex.ECDSA_256k1:
    case MtrDex.ECDSA_256k1N:
      return secp256k1.verify(sig, ser, key, {
        format: "compact",
        lowS: false,
        prehash: true,
      });
    case MtrDex.ECDSA_256r1:
    case MtrDex.ECDSA_256r1N:
      return p256.verify(sig, ser, key, {
        format: "compact",
        lowS: false,
        prehash: true,
      });
  }
}
