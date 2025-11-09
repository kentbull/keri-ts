/**
 * Check if keyBytes starts with prefixBytes
 */
export function startsWith(keyBytes: Uint8Array, prefixBytes: Uint8Array): boolean {
  if (prefixBytes.length === 0) {
    return true; // Empty prefix matches everything
  }
  if (keyBytes.length < prefixBytes.length) {
    return false;
  }
  return prefixBytes.every((byte, i) => keyBytes[i] === byte);
}
