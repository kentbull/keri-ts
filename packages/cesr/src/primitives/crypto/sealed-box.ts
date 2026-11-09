import { hsalsa, xsalsa20poly1305 } from "npm:@noble/ciphers@1.3.0/salsa";
import { ed25519, x25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { blake2b } from "npm:@noble/hashes@1.8.0/blake2";

/**
 * libsodium-compatible sealed boxes built from audited pure-JS primitives.
 *
 * Construction (libsodium `crypto_box_seal`):
 * - ephemeral X25519 keypair `(esk, epk)`
 * - nonce = BLAKE2b-192(epk || recipient_pk)
 * - key = HSalsa20(X25519(esk, recipient_pk)) (`crypto_box_beforenm`)
 * - output = epk || XSalsa20-Poly1305(key, nonce, plaintext) with the 16-byte tag first
 *
 * Boundary rule:
 * - CESR primitives own sealed-box behavior
 * - higher layers consume `Cipher`/`Encrypter`/`Decrypter`, not these calls
 * - this module returns only raw key/plaintext/cipher bytes; derivation codes
 *   and primitive hydration stay outside at the CESR primitive layer
 *
 * Parity evidence: `test/fixtures/sodium-parity-vectors.json` holds pysodium
 * outputs, including fixed-ephemeral constructions that must match byte for byte.
 */

/** NaCl `sigma` constant as the four little-endian words HSalsa20 expects. */
const SIGMA = new Uint32Array(new TextEncoder().encode("expand 32-byte k").buffer);
const ZERO_INPUT = new Uint32Array(4);
const PUBLIC_KEY_BYTES = 32;
const SEAL_OVERHEAD = PUBLIC_KEY_BYTES + 16;
const NONCE_BYTES = 24;

/** Noble reports a zero X25519 output (low-order peer) with exactly this message. */
const NONCONTRIBUTORY = "invalid private or public key received";

/** libsodium rejects wrong-length keys as argument errors before any computation. */
function assertKeyLength(name: string, key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== PUBLIC_KEY_BYTES) {
    throw new RangeError(`${name} must be ${PUBLIC_KEY_BYTES} bytes`);
  }
}

function toWords(bytes: Uint8Array): Uint32Array {
  return new Uint32Array(bytes.slice().buffer);
}

/** `crypto_box_beforenm`: HSalsa20 over the raw X25519 point with a zero input block. */
function boxSharedKey(publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(privateKey, publicKey);
  const sharedWords = toWords(shared);
  const keyWords = new Uint32Array(8);
  try {
    hsalsa(SIGMA, sharedWords, ZERO_INPUT, keyWords);
    return new Uint8Array(keyWords.buffer).slice();
  } finally {
    shared.fill(0);
    sharedWords.fill(0);
    keyWords.fill(0);
  }
}

function sealNonce(ephemeralPublicKey: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const input = new Uint8Array(PUBLIC_KEY_BYTES * 2);
  input.set(ephemeralPublicKey);
  input.set(recipientPublicKey, PUBLIC_KEY_BYTES);
  return blake2b(input, { dkLen: NONCE_BYTES });
}

/** Derive X25519 public key material from one Ed25519 verifier key. */
export function boxPublicKeyFromEd25519Verfer(verferRaw: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(verferRaw);
}

/**
 * Derive the X25519 box keypair corresponding to one Ed25519 signing seed.
 *
 * KERIpy parity (`crypto_sign_ed25519_{pk,sk}_to_curve25519`):
 * - public: birational map of the Ed25519 public point
 * - private: clamped first half of SHA-512(seed)
 */
export function boxKeyPairFromEd25519Seed(seedRaw: Uint8Array): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  return {
    publicKey: ed25519.utils.toMontgomery(ed25519.getPublicKey(seedRaw)),
    privateKey: ed25519.utils.toMontgomerySecret(seedRaw),
  };
}

/** Recover the X25519 public key corresponding to one raw X25519 private key. */
export function boxPublicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/** Deterministic seam for parity vectors; production callers use `sealBox`. */
export function sealBoxWithEphemeral(
  plaintext: Uint8Array,
  publicKey: Uint8Array,
  ephemeralPrivateKey: Uint8Array,
): Uint8Array {
  assertKeyLength("publicKey", publicKey);
  assertKeyLength("ephemeralPrivateKey", ephemeralPrivateKey);
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const key = boxSharedKey(publicKey, ephemeralPrivateKey);
  try {
    const boxed = xsalsa20poly1305(key, sealNonce(ephemeralPublicKey, publicKey)).encrypt(plaintext);
    const sealed = new Uint8Array(PUBLIC_KEY_BYTES + boxed.length);
    sealed.set(ephemeralPublicKey);
    sealed.set(boxed, PUBLIC_KEY_BYTES);
    return sealed;
  } finally {
    key.fill(0);
  }
}

/** Encrypt one plaintext as a libsodium sealed box with a fresh ephemeral key. */
export function sealBox(plaintext: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const ephemeralPrivateKey = crypto.getRandomValues(new Uint8Array(PUBLIC_KEY_BYTES));
  try {
    return sealBoxWithEphemeral(plaintext, publicKey, ephemeralPrivateKey);
  } finally {
    ephemeralPrivateKey.fill(0);
  }
}

/** Return null only for authentication failure (bad tag or low-order ephemeral key); contract failures propagate. */
export function openSealedBox(
  cipher: Uint8Array,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array | null {
  assertKeyLength("publicKey", publicKey);
  assertKeyLength("privateKey", privateKey);
  if (cipher.length < SEAL_OVERHEAD) {
    throw new Error(`Sealed box requires at least ${SEAL_OVERHEAD} bytes, got ${cipher.length}`);
  }
  const ephemeralPublicKey = cipher.subarray(0, PUBLIC_KEY_BYTES);
  let key: Uint8Array;
  try {
    key = boxSharedKey(ephemeralPublicKey, privateKey);
  } catch (error) {
    if (error instanceof Error && error.message === NONCONTRIBUTORY) return null;
    throw error;
  }
  try {
    return xsalsa20poly1305(key, sealNonce(ephemeralPublicKey, publicKey)).decrypt(cipher.subarray(PUBLIC_KEY_BYTES));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid tag") return null;
    throw error;
  } finally {
    key.fill(0);
  }
}
