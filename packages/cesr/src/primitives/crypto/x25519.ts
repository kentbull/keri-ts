import sodium from "./sodium.ts";

/**
 * Generate raw RFC 7748 X25519 keys with the existing initialized sodium backend.
 * Returns owned public/private bytes. Private bytes are secrets; this operation
 * does not persist, redact, or manage their lifetime. Backend failures propagate.
 */
export function generateX25519KeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const pair = sodium.crypto_box_keypair();
  return { publicKey: new Uint8Array(pair.publicKey), privateKey: new Uint8Array(pair.privateKey) };
}

/**
 * Compute RFC 7748 X25519 over exactly two raw 32-byte keys.
 * Returns owned shared-secret bytes. Rejects wrong lengths, invalid/low-order
 * peer points and zero agreement; backend failures propagate without key logging.
 */
export function deriveX25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  if (
    !(privateKey instanceof Uint8Array) || !(publicKey instanceof Uint8Array)
    || privateKey.length !== 32 || publicKey.length !== 32
  ) {
    throw new TypeError("X25519 agreement requires two 32-byte keys");
  }
  const shared = new Uint8Array(sodium.crypto_scalarmult(privateKey, publicKey));
  if (!shared.some((byte) => byte !== 0)) throw new Error("Invalid X25519 agreement");
  return shared;
}
