/** Raw X25519 agreement over fresh caller-owned keys; no signing-key conversion or KDF. */
import sodium from "./sodium.ts";

/** Recover the public key for one 32-byte X25519 private scalar. */
export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return new Uint8Array(sodium.crypto_scalarmult_base(privateKey));
}

/** Null means a noncontributory peer key; argument and backend failures propagate. */
export function x25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array | null {
  try {
    const shared = new Uint8Array(sodium.crypto_scalarmult(privateKey, publicKey));
    return shared.some((byte) => byte !== 0) ? shared : null;
  } catch (error) {
    // Pinned libsodium-wrappers-sumo 0.8.4 reports the native low-order rejection here.
    if (error instanceof Error && error.message === "weak public key") return null;
    throw error;
  }
}
