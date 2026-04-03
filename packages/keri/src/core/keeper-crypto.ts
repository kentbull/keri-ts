import { Cipher, Decrypter, Encrypter, Salter, Signer, Verfer } from "../../../cesr/mod.ts";

/**
 * Thin compatibility wrappers over CESR-owned sealed-box primitives.
 *
 * Maintainer rule:
 * - runtime encryption/decryption behavior lives in CESR primitives
 * - this module only preserves a few KERI-local helper entrypoints for tests
 *   and any still-local call sites that benefit from named convenience helpers
 */

function asSigner(value: Signer | string | Uint8Array): Signer {
  if (value instanceof Signer) {
    return value;
  }
  return typeof value === "string"
    ? new Signer({ qb64: value })
    : new Signer({ qb64b: value });
}

function asVerfer(value: Verfer | string | Uint8Array): Verfer {
  if (value instanceof Verfer) {
    return value;
  }
  return typeof value === "string"
    ? new Verfer({ qb64: value })
    : new Verfer({ qb64b: value });
}

function asCipher(value: Cipher | string | Uint8Array): Cipher {
  if (value instanceof Cipher) {
    return value;
  }
  return typeof value === "string"
    ? new Cipher({ qb64: value })
    : new Cipher({ qb64b: value });
}

/** Legacy no-op readiness seam kept for compatibility with older app code. */
export function ensureKeeperCryptoReady(): void {
  // CESR primitives now own sodium readiness through their own module init.
}

/** Convenience constructor for one AEID-derived X25519 encrypter. */
export function makeEncrypterFromAeid(
  aeid: Verfer | string | Uint8Array,
): Encrypter {
  return new Encrypter({ verkey: asVerfer(aeid).qb64b });
}

/** Convenience constructor for one Ed25519-seed-derived X25519 decrypter. */
export function makeDecrypterFromSeed(
  seed: Signer | string | Uint8Array,
): Decrypter {
  return new Decrypter({ seed: asSigner(seed).qb64b });
}

/** Convenience constructor for one already-hydrated signer seed. */
export function makeDecrypterFromSigner(signer: Signer): Decrypter {
  return new Decrypter({ seed: signer.qb64b });
}

/** Check whether an Ed25519 seed matches the AEID-derived encrypter public key. */
export function seedMatchesAeid(
  seed: Signer | string | Uint8Array,
  aeid: Verfer | string | Uint8Array,
): boolean {
  return makeEncrypterFromAeid(aeid).verifySeed(asSigner(seed).qb64b);
}

/** Encrypt one signer seed for at-rest keeper storage. */
export function encryptSigner(
  signer: Signer | string | Uint8Array,
  encrypter: Encrypter,
): Cipher {
  return encrypter.encrypt({ prim: asSigner(signer) });
}

/** Decrypt one stored signer cipher back into a CESR `Signer`. */
export function decryptSigner(
  cipher: Cipher | string | Uint8Array,
  decrypter: Decrypter,
): Signer {
  return new Signer({ qb64b: decryptCipherQb64b(cipher, decrypter) });
}

/** Decrypt one qualified cipher payload back into raw plaintext CESR bytes. */
export function decryptCipherQb64b(
  cipher: Cipher | string | Uint8Array,
  decrypter: Decrypter,
): Uint8Array {
  return decrypter.decrypt({ cipher: asCipher(cipher), bare: true }) as Uint8Array;
}

/** Encrypt one keeper salt through the CESR sealed-box primitive surface. */
export function encryptSaltQb64(
  saltQb64: string,
  encrypter: Encrypter,
): Cipher {
  return encrypter.encrypt({ prim: new Salter({ qb64: saltQb64 }) });
}

/** Decrypt one stored keeper salt back into canonical `Salter.qb64` text. */
export function decryptSaltQb64(
  cipher: Cipher | string | Uint8Array,
  decrypter: Decrypter,
): string {
  return (decrypter.decrypt({
    cipher: asCipher(cipher),
    ctor: Salter,
  }) as Salter).qb64;
}
