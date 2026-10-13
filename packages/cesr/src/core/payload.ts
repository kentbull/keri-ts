/** Reopenable content whose bytes need not reside in memory together. */
export interface Payload {
  readonly size: number;
  open(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/** A completed payload whose storage lifetime belongs to its consumer. */
export interface OwnedPayload extends Payload {
  discard(): Promise<void>;
}

/** Awaited writes apply backpressure; finish transfers ownership to the caller. */
export interface PayloadSink {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<OwnedPayload>;
  abort(reason?: unknown): Promise<void>;
}

/** Collect explicitly bounded content, rejecting dishonest size declarations. */
export async function collectPayload(payload: Payload, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(payload.size) || payload.size < 0) {
    throw new RangeError("Invalid payload size or limit");
  }
  if (payload.size > limit) throw new RangeError("Payload exceeds collection limit");
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

/** Bounded staging in fixed-size slabs, independent of incoming chunk count. */
export class MemoryPayloadSink implements PayloadSink {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private used = 0;
  private state: "open" | "finished" | "aborted" = "open";
  private readonly cancel = () => {
    void this.abort();
  };

  constructor(private readonly maxBytes: number, private readonly signal?: AbortSignal) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid payload limit");
    signal?.throwIfAborted();
    signal?.addEventListener("abort", this.cancel, { once: true });
  }

  /** Copy bytes before resolving, permitting the caller to reuse its buffer. */
  write(chunk: Uint8Array): Promise<void> {
    return Promise.resolve().then(() => {
      this.check();
      if (chunk.length > this.maxBytes - this.size) throw new RangeError("Payload exceeds sink limit");
      let offset = 0;
      while (offset < chunk.length) {
        let slab = this.chunks[this.chunks.length - 1];
        if (!slab || this.used === slab.length) {
          slab = new Uint8Array(Math.min(65536, this.maxBytes - this.size));
          this.chunks.push(slab);
          this.used = 0;
        }
        const count = Math.min(slab.length - this.used, chunk.length - offset);
        slab.set(chunk.subarray(offset, offset + count), this.used);
        this.used += count;
        this.size += count;
        offset += count;
      }
    });
  }

  /** Return immutable-by-copy reads; aborting this sink cannot revoke the result. */
  finish(): Promise<OwnedPayload> {
    return Promise.resolve().then(() => {
      this.check();
      this.state = "finished";
      this.signal?.removeEventListener("abort", this.cancel);
      const chunks = this.chunks;
      const size = this.size;
      let discarded = false;
      this.chunks = [];
      return {
        size,
        async *open(signal?: AbortSignal) {
          if (discarded) throw new Error("Payload is discarded");
          let remaining = size;
          for (const chunk of chunks) {
            if (discarded) throw new Error("Payload is discarded");
            signal?.throwIfAborted();
            const count = Math.min(remaining, chunk.length);
            yield chunk.slice(0, count);
            remaining -= count;
          }
          signal?.throwIfAborted();
          if (discarded) throw new Error("Payload is discarded");
        },
        discard(): Promise<void> {
          discarded = true;
          chunks.length = 0;
          return Promise.resolve();
        },
      };
    });
  }

  /** Release unfinished content; completed payloads belong to their consumers. */
  abort(): Promise<void> {
    if (this.state === "open") {
      this.state = "aborted";
      this.chunks = [];
      this.signal?.removeEventListener("abort", this.cancel);
    }
    return Promise.resolve();
  }

  private check(): void {
    this.signal?.throwIfAborted();
    if (this.state !== "open") throw new Error(`Payload sink is ${this.state}`);
  }
}
