import sodium from "npm:libsodium-wrappers@0.8.2";
import {
  Cipher,
  Decrypter,
  Encrypter,
  Salter,
  Signer,
  Verfer,
} from "../../../cesr/mod.ts";

/**
 * KERI-local sodium bridge for Gate D keeper encryption semantics.
 *
 * Why this module exists:
 * - CESR primitives intentionally stay as typed value holders in this repo.
 * - Gate D still needs real KERIpy-compatible sealed-box behavior for keeper
 *   salts and signer seeds.
 * - Putting the sodium dependency here keeps that runtime concern local to the
 *   keeper/app layer instead of making every CESR import path transitively
 *   depend on libsodium initialization.
 *
 * Runtime model:
 * - We use `libsodium-wrappers` 0.8.2, the pure JS + WebAssembly backend.
 * - Module evaluation blocks on `sodium.ready`, so exported helpers can stay
 *   synchronous after import.
 *
 * Parity model:
 * - AEID is still the Ed25519 verifier identifier exposed to higher layers.
 * - Keeper encryption derives X25519 material from that Ed25519 identity, just
 *   like KERIpy's `Encrypter` / `Decrypter` behavior.
 * - Ciphertexts are intentionally randomized sealed boxes, so parity is
 *   behavioral rather than byte-for-byte.
 */
const CIPHER_SALT_CODE = "1AAH";
const CIPHER_SEED_CODE = "P";
const DECRYPTER_CODE = "O";
const ENCRYPTER_CODE = "C";

await sodium.ready;

/**
 * Explicit keeper-crypto readiness marker.
 *
 * This is intentionally a no-op function:
 * - the actual readiness boundary is the top-level `await sodium.ready`
 * - callers use this helper to document the point where encrypted keeper flows
 *   become allowed
 *
 * Maintainer note:
 * If we ever move away from top-level await for packaging/runtime reasons, this
 * function is the stable seam to convert into a real async or stateful check.
 */
export function ensureKeeperCryptoReady(): void {
  // Module evaluation blocks on libsodium-wrappers readiness, so encrypted
  // keeper flows can keep a synchronous surface after this module is imported.
}

/** Small constant-time-ish equality helper for short derived key material. */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

/** Normalize signer-like inputs into one CESR `Signer` seed primitive. */
function asSigner(value: Signer | string | Uint8Array): Signer {
  if (value instanceof Signer) {
    return value;
  }
  return typeof value === "string"
    ? new Signer({ qb64: value })
    : new Signer({ qb64b: value });
}

/** Normalize AEID/verfer-like inputs into one CESR `Verfer` primitive. */
function asVerfer(value: Verfer | string | Uint8Array): Verfer {
  if (value instanceof Verfer) {
    return value;
  }
  return typeof value === "string"
    ? new Verfer({ qb64: value })
    : new Verfer({ qb64b: value });
}

/** Normalize stored cipher payloads into one CESR `Cipher` primitive. */
function asCipher(value: Cipher | string | Uint8Array): Cipher {
  if (value instanceof Cipher) {
    return value;
  }
  return typeof value === "string"
    ? new Cipher({ qb64: value })
    : new Cipher({ qb64b: value });
}

/**
 * Derive the X25519 public key used for keeper encryption from AEID material.
 *
 * KERIpy correspondence:
 * - mirrors `Encrypter(verkey=aeid)` behavior where the keeper's public box key
 *   is derived from the Ed25519 verifier bound to the non-transferable AEID.
 */
function curvePublicKeyFromAeid(aeid: Verfer | string | Uint8Array): Uint8Array {
  const verfer = asVerfer(aeid);
  return new Uint8Array(
    sodium.crypto_sign_ed25519_pk_to_curve25519(verfer.raw),
  );
}

/**
 * Derive the X25519 box keypair used for keeper decryption from a signing seed.
 *
 * Important invariant:
 * - the input is the Ed25519 seed stored/derived by the keeper flow
 * - the returned private key is the Curve25519 box private key associated with
 *   that signing identity, not a second unrelated secret
 */
function curveKeyPairFromSeed(
  seed: Signer | string | Uint8Array,
): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const signer = asSigner(seed);
  const keyPair = sodium.crypto_sign_seed_keypair(signer.raw);
  return {
    publicKey: new Uint8Array(
      sodium.crypto_sign_ed25519_pk_to_curve25519(keyPair.publicKey),
    ),
    privateKey: new Uint8Array(
      sodium.crypto_sign_ed25519_sk_to_curve25519(keyPair.privateKey),
    ),
  };
}

/** Recover the matching X25519 public key from a hydrated keeper decrypter. */
function boxPublicKeyFromDecrypter(decrypter: Decrypter): Uint8Array {
  return new Uint8Array(sodium.crypto_scalarmult_base(decrypter.raw));
}

/**
 * Encrypt one already-qualified plaintext payload into a CESR `Cipher`.
 *
 * The plaintext is always a round-trippable qualified CESR representation
 * (`qb64b`) so the decrypt path can restore the original primitive type
 * without guessing beyond the cipher family code.
 */
function encryptQb64Payload(
  qb64b: Uint8Array,
  encrypter: Encrypter,
  code: string,
): Cipher {
  return new Cipher({
    code,
    raw: new Uint8Array(sodium.crypto_box_seal(qb64b, encrypter.raw)),
  });
}

/**
 * Decrypt one stored keeper payload back to its plaintext bytes.
 *
 * Failure behavior:
 * - wrong passcode / mismatched AEID material will fail here through sodium's
 *   sealed-box open path
 * - callers should treat that as authentication/decryption failure, not as
 *   missing data
 */
function decryptPayload(
  cipher: Cipher | string | Uint8Array,
  decrypter: Decrypter,
): Uint8Array {
  const hydrated = asCipher(cipher);
  return new Uint8Array(
    sodium.crypto_box_seal_open(
      hydrated.raw,
      boxPublicKeyFromDecrypter(decrypter),
      decrypter.raw,
    ),
  );
}

/** Build the keeper encrypter for one AEID-bound identity. */
export function makeEncrypterFromAeid(
  aeid: Verfer | string | Uint8Array,
): Encrypter {
  return new Encrypter({
    code: ENCRYPTER_CODE,
    raw: curvePublicKeyFromAeid(aeid),
  });
}

/** Build the keeper decrypter for one passcode-derived or explicit signing seed. */
export function makeDecrypterFromSeed(
  seed: Signer | string | Uint8Array,
): Decrypter {
  return new Decrypter({
    code: DECRYPTER_CODE,
    raw: curveKeyPairFromSeed(seed).privateKey,
  });
}

/**
 * Verify that a supplied signing seed actually belongs to the given AEID.
 *
 * This is the core reopen/auth check used by the manager before it trusts a
 * passcode-derived seed to decrypt keeper material.
 */
export function seedMatchesAeid(
  seed: Signer | string | Uint8Array,
  aeid: Verfer | string | Uint8Array,
): boolean {
  return bytesEqual(
    curveKeyPairFromSeed(seed).publicKey,
    curvePublicKeyFromAeid(aeid),
  );
}

/** Encrypt one signer seed for storage in keeper `pris.`. */
export function encryptSigner(
  signer: Signer | string | Uint8Array,
  encrypter: Encrypter,
): Cipher {
  return encryptQb64Payload(asSigner(signer).qb64b, encrypter, CIPHER_SEED_CODE);
}

/** Decrypt one stored keeper signer cipher back into a CESR `Signer`. */
export function decryptSigner(
  cipher: Cipher | string | Uint8Array,
  decrypter: Decrypter,
): Signer {
  return new Signer({ qb64b: decryptPayload(cipher, decrypter) });
}

/** Encrypt one root/per-prefix salt for keeper-global or `prms.` storage. */
export function encryptSaltQb64(
  saltQb64: string,
  encrypter: Encrypter,
): Cipher {
  return encryptQb64Payload(
    new Salter({ qb64: saltQb64 }).qb64b,
    encrypter,
    CIPHER_SALT_CODE,
  );
}

/** Decrypt one stored salt cipher back into canonical `Salter.qb64` text. */
export function decryptSaltQb64(
  cipher: Cipher | string | Uint8Array,
  decrypter: Decrypter,
): string {
  return new Salter({ qb64b: decryptPayload(cipher, decrypter) }).qb64;
}
