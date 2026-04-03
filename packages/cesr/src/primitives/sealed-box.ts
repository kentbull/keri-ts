import sodium from "npm:libsodium-wrappers@0.8.2";

await sodium.ready;

/**
 * Internal libsodium-backed sealed-box seam for KERIpy cipher parity.
 *
 * Boundary rule:
 * - CESR primitives own sealed-box behavior
 * - higher layers consume `Cipher`/`Encrypter`/`Decrypter`, not sodium calls
 */

/** Derive X25519 public key material from one Ed25519 verifier key. */
export function boxPublicKeyFromEd25519Verfer(
  verferRaw: Uint8Array,
): Uint8Array {
  return new Uint8Array(
    sodium.crypto_sign_ed25519_pk_to_curve25519(verferRaw),
  );
}

/**
 * Derive the X25519 box keypair corresponding to one Ed25519 signing seed.
 *
 * KERIpy parity:
 * - derive the Ed25519 signing keypair first
 * - then convert both sides to the associated X25519 box keys
 */
export function boxKeyPairFromEd25519Seed(seedRaw: Uint8Array): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  const keyPair = sodium.crypto_sign_seed_keypair(seedRaw);
  return {
    publicKey: new Uint8Array(
      sodium.crypto_sign_ed25519_pk_to_curve25519(keyPair.publicKey),
    ),
    privateKey: new Uint8Array(
      sodium.crypto_sign_ed25519_sk_to_curve25519(keyPair.privateKey),
    ),
  };
}

/** Recover the X25519 public key corresponding to one raw X25519 private key. */
export function boxPublicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  return new Uint8Array(sodium.crypto_scalarmult_base(privateKey));
}

/** Encrypt one plaintext using libsodium's X25519 sealed-box primitive. */
export function sealBox(plaintext: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return new Uint8Array(sodium.crypto_box_seal(plaintext, publicKey));
}

/** Open one libsodium X25519 sealed-box ciphertext. */
export function openSealedBox(
  cipher: Uint8Array,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array {
  return new Uint8Array(
    sodium.crypto_box_seal_open(cipher, publicKey, privateKey),
  );
}
