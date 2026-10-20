/** Reopenable content whose bytes need not reside in memory together. */
export interface Payload {
  /** Exact content length; readers must neither truncate nor exceed it. */
  readonly size: number;
  /** Reopen from byte zero, honoring cancellation and yielding immutable chunks. */
  open(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/** Collect the declared content extent, rejecting truncated or overlong readers. */
export async function collectPayload(payload: Payload, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(payload.size) || payload.size < 0) {
    throw new RangeError("Invalid payload size");
  }
  signal?.throwIfAborted();
  const result = new Uint8Array(payload.size);
  let offset = 0;
  for await (const chunk of payload.open(signal)) {
    signal?.throwIfAborted();
    if (chunk.length > result.length - offset) throw new RangeError("Payload exceeds declared size");
    result.set(chunk, offset);
    offset += chunk.length;
  }
  signal?.throwIfAborted();
  if (offset !== result.length) throw new RangeError("Payload is shorter than declared size");
  return result;
}
