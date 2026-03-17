const TEXT_ENCODER = new TextEncoder();

/**
 * Strip annotation comments/whitespace and rebuild the raw CESR text stream.
 *
 * This is the inverse of maintainer-facing annotation output, not a general
 * parser: comment lines and inline `# ...` commentary are discarded.
 */
export function denot(annotated: string): Uint8Array {
  const tokens: string[] = [];
  for (const line of annotated.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const commentIndex = line.indexOf("#");
    const sansComment = (commentIndex >= 0 ? line.slice(0, commentIndex) : line)
      .trim();
    if (!sansComment) continue;
    tokens.push(sansComment);
  }
  return TEXT_ENCODER.encode(tokens.join(""));
}
