/** Raw X25519 agreement over fresh caller-owned keys; no signing-key conversion or KDF. */
import { x25519 } from "npm:@noble/curves@1.9.7/ed25519";

/** Recover the public key for one 32-byte X25519 private scalar. */
export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/** Null means a noncontributory peer key; argument and backend failures propagate. */
export function x25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array | null {
  try {
    return x25519.getSharedSecret(privateKey, publicKey);
  } catch (error) {
    // Noble rejects an all-zero shared point (low-order peer) with exactly this message,
    // matching libsodium's crypto_scalarmult failure; other errors are argument contracts.
    if (error instanceof Error && error.message === "invalid private or public key received") return null;
    throw error;
  }
}
