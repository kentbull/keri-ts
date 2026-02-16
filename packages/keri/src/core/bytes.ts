/**
 * Check if keyBytes starts with prefixBytes
 */
export function startsWith(
  keyBytes: Uint8Array,
  prefixBytes: Uint8Array,
): boolean {
  if (prefixBytes.length === 0) {
    return true; // Empty prefix matches everything
  }
  if (keyBytes.length < prefixBytes.length) {
    return false;
  }
  return prefixBytes.every((byte, i) => keyBytes[i] === byte);
}

/**
 * Convert bytes to a displayable string for terminal output.
 *
 * Decodes bytes as UTF-8 and replaces non-printable control characters
 * with '.' for readable terminal display. UTF-8 can represent control
 * characters (like \x00, \x09, \x0A) which are valid but not printable.
 *
 * @param bytes - Bytes to convert to display string
 * @param maxLength - Optional maximum length; if exceeded, truncates and adds "..."
 * @returns Displayable string with control characters replaced
 */
export function displayStr(bytes: Uint8Array, maxLength?: number): string {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let str = decoder.decode(bytes);
    // Replace control characters (non-printable) for readable terminal output
    str = str.replace(/[\x00-\x1F\x7F-\x9F]/g, ".");
    // Truncate if maxLength is specified
    if (maxLength !== undefined && str.length > maxLength) {
      str = str.substring(0, maxLength - 3) + "...";
    }
    return str;
  } catch {
    return `[${bytes.length} bytes]`;
  }
}
