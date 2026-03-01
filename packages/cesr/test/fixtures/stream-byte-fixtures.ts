/** Encode text fixture material into parser input bytes. */
export function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

/** Slice a stream into deterministic feed chunks at provided boundaries. */
export function chunkByBoundaries(
  input: Uint8Array,
  boundaries: number[],
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const end of boundaries) {
    chunks.push(input.slice(start, end));
    start = end;
  }
  chunks.push(input.slice(start));
  return chunks;
}
