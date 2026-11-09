/** Local-file byte source. Host-only: it opens files through `Deno`. */

import { checkLimit, type SourceOptions } from "./byte-source.ts";

/**
 * Stream a local file with fixed-size owned buffers and close it on break or abort.
 *
 * @param path Local filesystem path opened read-only for this iteration.
 * @param options Optional cancellation and positive read buffer size in bytes; defaults to 65536.
 * @yields Owned buffers up to the selected chunk size until file EOF.
 * @throws Open/read failures or cancellation; the file closes on EOF, break or failure.
 */
export async function* fileBytes(
  path: string,
  { signal, maxChunkBytes = 64 * 1024 }: SourceOptions = {},
): AsyncGenerator<Uint8Array> {
  checkLimit(maxChunkBytes);
  signal?.throwIfAborted();
  const file = await Deno.open(path, { read: true });
  let closed = false;
  /** Interrupt a pending read and release the file exactly once. */
  const close = () => {
    if (!closed) {
      closed = true;
      file.close();
    }
  };
  signal?.addEventListener("abort", close, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = new Uint8Array(maxChunkBytes);
      const size = await file.read(chunk);
      signal?.throwIfAborted();
      if (size === null) return;
      if (size > 0) yield chunk.subarray(0, size);
    }
  } finally {
    signal?.removeEventListener("abort", close);
    close();
  }
}
