import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { p256 } from "npm:@noble/curves@1.9.7/nist";
import { secp256k1 } from "npm:@noble/curves@1.9.7/secp256k1";
import { UnknownCodeError } from "../core/errors.ts";
import { IdrDex, MtrDex } from "./codex.ts";

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

interface IndexedSignatureFamily {
  readonly both: string;
  readonly bigBoth: string;
  readonly currentOnly: string;
  readonly bigCurrentOnly: string;
}

const SIGNER_INDEXED_SIG_CODES = new Map<SupportedSignerCode, IndexedSignatureFamily>([
  [
    MtrDex.Ed25519_Seed,
    {
      both: IdrDex.Ed25519_Sig,
      bigBoth: IdrDex.Ed25519_Big_Sig,
      currentOnly: IdrDex.Ed25519_Crt_Sig,
      bigCurrentOnly: IdrDex.Ed25519_Big_Crt_Sig,
    },
  ],
  [
    MtrDex.ECDSA_256k1_Seed,
    {
      both: IdrDex.ECDSA_256k1_Sig,
      bigBoth: IdrDex.ECDSA_256k1_Big_Sig,
      currentOnly: IdrDex.ECDSA_256k1_Crt_Sig,
      bigCurrentOnly: IdrDex.ECDSA_256k1_Big_Crt_Sig,
    },
  ],
  [
    MtrDex.ECDSA_256r1_Seed,
    {
      both: IdrDex.ECDSA_256r1_Sig,
      bigBoth: IdrDex.ECDSA_256r1_Big_Sig,
      currentOnly: IdrDex.ECDSA_256r1_Crt_Sig,
      bigCurrentOnly: IdrDex.ECDSA_256r1_Big_Crt_Sig,
    },
  ],
]);

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

function assertSupportedSignerCode(code: string): asserts code is SupportedSignerCode {
  if (
    code !== MtrDex.Ed25519_Seed
    && code !== MtrDex.ECDSA_256k1_Seed
    && code !== MtrDex.ECDSA_256r1_Seed
  ) {
    throw new UnknownCodeError(`Unsupported signer seed code ${code}`);
  }
}

function assertSupportedVerferCode(code: string): asserts code is SupportedVerferCode {
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

/** Project one verifier code back to the signer seed code for the same suite. */
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

/** Project one verifier code back to transferability semantics. */
export function transferableForVerferCode(verferCode: string): boolean {
  assertSupportedVerferCode(verferCode);
  return verferCode !== MtrDex.Ed25519N
    && verferCode !== MtrDex.ECDSA_256k1N
    && verferCode !== MtrDex.ECDSA_256r1N;
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

/** Resolve the detached-signature derivation code emitted by one signer suite. */
export function detachedSignatureCodeForSignerCode(signerCode: string): string {
  assertSupportedSignerCode(signerCode);

  switch (signerCode) {
    case MtrDex.Ed25519_Seed:
      return MtrDex.Ed25519_Sig;
    case MtrDex.ECDSA_256k1_Seed:
      return MtrDex.ECDSA_256k1_Sig;
    case MtrDex.ECDSA_256r1_Seed:
      return MtrDex.ECDSA_256r1_Sig;
  }
}

/**
 * Resolve the indexed-signature code family implied by one signer seed code.
 *
 * This mirrors KERIpy's `Signer.sign()` selection rule:
 * - `only=true` uses the current-list-only signature family
 * - otherwise stable-order indexed signing defaults `ondex` to `index`
 * - small codes are used only when `index === ondex` and the index fits in one
 *   sextet
 */
export function indexedSignatureCodeForSignerCode(
  signerCode: string,
  index: number,
  {
    ondex,
    only = false,
  }: {
    ondex?: number;
    only?: boolean;
  } = {},
): string {
  assertSupportedSignerCode(signerCode);
  const families = SIGNER_INDEXED_SIG_CODES.get(signerCode);
  if (!families) {
    throw new UnknownCodeError(`Unsupported signer seed code ${signerCode}`);
  }

  if (only) {
    return index <= 63 ? families.currentOnly : families.bigCurrentOnly;
  }

  const ondexValue = ondex ?? index;
  return ondexValue === index && index <= 63 ? families.both : families.bigBoth;
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
