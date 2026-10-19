/** Transport readers. Each operation owns its reader and joins cancellation. */

/** Cancellation and chunk size for byte-array and file sources. */
export interface SourceOptions {
  /** Abort reads and release the transport when its operation stops. */
  signal?: AbortSignal;
  /** Buffer size used when chunking resident bytes or reading a local file. */
  maxChunkBytes?: number;
}

/**
 * Adapt an already resident finite value into independent bounded parser chunks.
 *
 * @param bytes Borrowed resident input; each yielded chunk is a copy independent of subsequent producer mutation.
 * @param options Optional signal and positive integer chunk size in bytes; defaults to 65536.
 * @yields Copied byte chunks in input order; this does not parse message boundaries.
 */
export async function* chunkBytes(
  bytes: Uint8Array,
  { signal, maxChunkBytes = 64 * 1024 }: SourceOptions = {},
): AsyncGenerator<Uint8Array> {
  checkLimit(maxChunkBytes);
  signal?.throwIfAborted();
  for (let offset = 0; offset < bytes.byteLength; offset += maxChunkBytes) {
    signal?.throwIfAborted();
    // Give the consumer an independent chunk of the resident value.
    yield bytes.slice(offset, offset + maxChunkBytes);
  }
}

/**
 * Read a Fetch stream on demand and cancel its reader when parsing stops.
 *
 * @param stream Borrowed Web stream to read exclusively; null yields no bytes.
 * @param options Optional signal that cancels the pending read.
 * @yields Nonempty chunks supplied by the underlying stream.
 * @throws Read/cancel/unlock failures, combined when distinct failures occur.
 */
export async function* streamBytes(
  stream: ReadableStream<Uint8Array> | null,
  { signal }: Pick<SourceOptions, "signal"> = {},
): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  if (!stream) return;
  const reader = stream.getReader();
  let closing: Promise<void> | undefined;
  /** Share the original cancellation Promise so finally joins asynchronous transport cleanup. */
  const close = () => closing ??= reader.cancel(signal?.reason);
  /** Cancellation interrupts the pending read; the generator finally joins the same cleanup. */
  const abort = () => {
    // Observe the notification rejection here; finally joins the same Promise and propagates it.
    void close().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  let failed = false, failure: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return;
      if (value.length > 0) yield value;
    }
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    // Always unlock, and retain distinct read/cancel/unlock failures rather than masking the first.
    const errors: unknown[] = failed ? [failure] : [];
    try {
      await close();
    } catch (error) {
      if (!errors.includes(error)) errors.push(error);
    }
    try {
      reader.releaseLock();
    } catch (error) {
      if (!errors.includes(error)) errors.push(error);
    }
    // deno-lint-ignore no-unsafe-finally -- Preserve all failures, including cleanup during iterator return.
    if (errors.length > 1) throw new AggregateError(errors, "Transport read and cleanup failed");
    // deno-lint-ignore no-unsafe-finally -- The single original failure retains its identity.
    if (errors.length) throw errors[0];
  }
}

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

/**
 * Collect an explicitly finite operation; bulk ingress should consume its source directly.
 *
 * @param source Finite byte source whose iteration errors propagate; do not pass an unbounded mailbox stream.
 * @returns A contiguous owned array containing all chunks in order.
 */
export async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  let bytes = new Uint8Array(0);
  let size = 0;
  for await (const chunk of source) {
    const end = size + chunk.length;
    if (end > bytes.length) {
      // Geometric growth bounds copies without retaining one metadata entry per transport chunk.
      const grown = new Uint8Array(Math.max(end, 64 * 1024, bytes.length * 2));
      grown.set(bytes.subarray(0, size));
      bytes = grown;
    }
    bytes.set(chunk, size);
    size = end;
  }
  return bytes.subarray(0, size);
}

/**
 * Reject invalid chunk sizes before allocation or opening a file.
 *
 * @param limit Requested per-chunk byte count.
 * @throws RangeError unless the count is a positive safe integer.
 */
function checkLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Chunk size must be a positive safe integer");
}
