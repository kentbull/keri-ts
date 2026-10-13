/** Bounded transport readers. Each yielded chunk owns its buffer until consumption finishes. */
import { ResourceLimitError } from "cesr-ts";

/** Bounds for one transport read, independent of the stream's total length. */
export interface SourceOptions {
  /** Abort reads and release the transport when its operation stops. */
  signal?: AbortSignal;
  /** Largest owned backing allocation admitted for one transport read. */
  maxChunkBytes?: number;
}

/** Adapt an already resident finite value into independent bounded parser chunks. */
export async function* chunkBytes(
  bytes: Uint8Array,
  { signal, maxChunkBytes = 64 * 1024 }: SourceOptions = {},
): AsyncGenerator<Uint8Array> {
  checkLimit(maxChunkBytes);
  signal?.throwIfAborted();
  for (let offset = 0; offset < bytes.byteLength; offset += maxChunkBytes) {
    signal?.throwIfAborted();
    // A subarray would retain the full input backing buffer and exceed the cursor's chunk budget.
    yield bytes.slice(offset, offset + maxChunkBytes);
  }
}

/** Read a Fetch stream on demand and cancel its reader when parsing stops. */
export async function* streamBytes(
  stream: ReadableStream<Uint8Array> | null,
  { signal, maxChunkBytes = 1024 * 1024 }: SourceOptions = {},
): AsyncGenerator<Uint8Array> {
  checkLimit(maxChunkBytes);
  signal?.throwIfAborted();
  if (!stream) return;
  const reader = stream.getReader();
  let closing: Promise<void> | undefined;
  /** Share the original cancellation Promise so finally joins asynchronous transport cleanup. */
  const close = () => closing ??= reader.cancel(signal?.reason).catch(() => {});
  /** Cancellation interrupts the pending read; the generator finally joins the same cleanup. */
  const abort = () => {
    void close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return;
      // Counting the backing allocation prevents a tiny view from retaining a huge input buffer.
      if (value.buffer.byteLength > maxChunkBytes) {
        throw new ResourceLimitError(`Transport chunk exceeds ${maxChunkBytes} bytes`);
      }
      if (value.length > 0) yield value;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await close();
    reader.releaseLock();
  }
}

/** Stream a local file with fixed-size owned buffers and close it on break or abort. */
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

/** Collect an explicitly finite operation; bulk ingress should consume its source directly. */
export async function collectBytes(source: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  checkLimit(limit);
  let bytes = new Uint8Array(0);
  let size = 0;
  for await (const chunk of source) {
    if (chunk.length > limit - size) throw new ResourceLimitError(`Input exceeds ${limit} bytes`);
    const end = size + chunk.length;
    if (end > bytes.length) {
      // Geometric growth bounds copies without retaining one metadata entry per transport chunk.
      const grown = new Uint8Array(Math.min(limit, Math.max(end, 64 * 1024, bytes.length * 2)));
      grown.set(bytes.subarray(0, size));
      bytes = grown;
    }
    bytes.set(chunk, size);
    size = end;
  }
  return bytes.subarray(0, size);
}

/** Reject invalid budgets before opening a file or taking ownership of a stream. */
function checkLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Byte limit must be a positive safe integer");
}
