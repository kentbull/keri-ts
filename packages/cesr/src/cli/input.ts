import { ResourceLimitError } from "../core/errors.ts";

/** Collect admitted CLI input with geometric growth and no unbounded list of source chunks. */
export async function collectInput(source: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("max-bytes must be a positive safe integer");
  let bytes = new Uint8Array(0);
  let size = 0;
  for await (const chunk of source) {
    if (chunk.length > limit - size) throw new ResourceLimitError(`Input exceeds ${limit} bytes`);
    const end = size + chunk.length;
    if (end > bytes.length) {
      const grown = new Uint8Array(Math.min(limit, Math.max(end, 65536, bytes.length * 2)));
      grown.set(bytes.subarray(0, size));
      bytes = grown;
    }
    bytes.set(chunk, size);
    size = end;
  }
  return bytes.subarray(0, size);
}
