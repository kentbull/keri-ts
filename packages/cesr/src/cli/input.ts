/** Collect CLI input with geometric growth and no unbounded list of source chunks. */
export async function collectInput(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  let bytes = new Uint8Array(0);
  let size = 0;
  for await (const chunk of source) {
    const end = size + chunk.length;
    if (end > bytes.length) {
      const grown = new Uint8Array(Math.max(end, 65536, bytes.length * 2));
      grown.set(bytes.subarray(0, size));
      bytes = grown;
    }
    bytes.set(chunk, size);
    size = end;
  }
  return bytes.subarray(0, size);
}
