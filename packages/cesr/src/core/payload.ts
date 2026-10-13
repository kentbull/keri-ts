/** Reopenable content whose bytes need not reside in memory together. */
export interface Payload {
  /** Exact content length; readers must neither truncate nor exceed it. */
  readonly size: number;
  /** Reopen from byte zero, honoring cancellation and yielding immutable chunks. */
  open(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/** A completed payload whose storage lifetime belongs to its consumer. */
export interface OwnedPayload extends Payload {
  /** Release owned storage and invalidate all future reads; safe to repeat. */
  discard(): Promise<void>;
}

/** Awaited writes apply backpressure; finish transfers ownership to the caller. */
export interface PayloadSink {
  /** Resolve only after accepting this chunk; callers await before writing again. */
  write(chunk: Uint8Array): Promise<void>;
  /** Complete staging and transfer storage ownership to the returned payload. */
  finish(): Promise<OwnedPayload>;
  /** Dispose unfinished storage; completed payload ownership stays with its caller. */
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
  /** Fixed-size storage slabs; count is bounded by maxBytes rather than input chunk count. */
  private chunks: Uint8Array[] = [];
  /** Accepted content bytes across every slab. */
  private size = 0;
  /** Occupied prefix of the final slab. */
  private used = 0;
  /** Only open sinks accept operations; finish transfers ownership irreversibly. */
  private state: "open" | "finished" | "aborted" = "open";
  /** Abort unfinished storage when caller cancellation arrives between writes. */
  private readonly cancel = () => {
    void this.abort();
  };

  /** Bind a finite allocation budget and optional cancellation to one stage. */
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
        /** Yield copies so a reader cannot mutate retained canonical bytes. */
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
        /** Drop all owning slab references without waiting for garbage collection. */
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

  /** Reject cancellation and any operation after ownership has transferred. */
  private check(): void {
    this.signal?.throwIfAborted();
    if (this.state !== "open") throw new Error(`Payload sink is ${this.state}`);
  }
}
