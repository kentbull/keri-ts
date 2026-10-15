import { GroupSizeError, ShortageError } from "../core/errors.ts";

/** Cancellation shared by the input owner and every enclosure view. */
export interface CursorOptions {
  signal?: AbortSignal;
}

/** One immutable source allocation and its unconsumed suffix. */
interface Segment {
  /** Transport-owned bytes retained until this segment is exhausted. */
  bytes: Uint8Array;
  /** First unconsumed byte within bytes. */
  start: number;
  /** Next source allocation, in wire order. */
  next?: Segment;
}

/** Own the shared input queue and iterator; scopes only constrain its absolute position. */
class Input {
  /** Absolute number of consumed wire bytes. */
  offset = 0;
  /** Unconsumed bytes across all queued segments. */
  available = 0;
  /** Queue ends; consuming the last segment clears both references. */
  head?: Segment;
  private tail?: Segment;
  /** EOF is separate from close: buffered bytes remain readable after EOF. */
  private eof = false;
  /** One read owns the shared position across all scopes. */
  private busy = false;
  /** Terminal failure rethrown by every later operation. */
  private failure: unknown;
  /** Close is idempotent, including cancellation during an upstream read. */
  private closed = false;
  /** The single upstream return operation, if one was available. */
  private closing?: Promise<void>;
  /** A queued generator return must not block cancellation behind a pending next. */
  private returnMayBlock = false;
  /** The one outstanding source pull and its cancellable local waiter. */
  private pending?: Promise<IteratorResult<Uint8Array>>;
  private rejectRead?: (reason: unknown) => void;
  /** One scheduling timer per input; cancellation wakes and clears it synchronously. */
  private resumeWork?: () => void;
  private workBytes = 0;
  private workItems = 0;
  /** This input alone owns source advancement and cleanup. */
  private readonly iterator: AsyncIterator<Uint8Array>;
  /** Caller cancellation is observed once for this input's lifetime. */
  private readonly signal?: AbortSignal;
  /** Own the caller's source and observe cancellation once. */
  constructor(source: AsyncIterable<Uint8Array>, options: CursorOptions) {
    this.iterator = source[Symbol.asyncIterator]();
    this.signal = options.signal;
    this.signal?.addEventListener("abort", this.abort, { once: true });
    if (this.signal?.aborted) this.abort();
  }

  /** Convert external cancellation into the input's one terminal failure. */
  private abort = (): void => {
    this.stop(this.signal?.reason ?? new DOMException("Input aborted", "AbortError"));
  };

  /** Prevent reads and new scopes from outliving their source owner. */
  check(): void {
    if (this.closed) throw this.failure;
  }

  /** Serialize reads across parent and child scopes sharing one byte position. */
  async access<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    if (this.busy) throw new Error("Cursor scopes cannot read concurrently");
    // Scopes share one position, so overlapping reads would steal each other's bytes.
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }

  /** Pull only until the requested prefix is available. */
  async ensure(size: number): Promise<boolean> {
    this.check();
    while (this.available < size && !this.eof) {
      try {
        // Record the pending operation before invoking user code, which may abort synchronously.
        this.pending = Promise.resolve().then(() => {
          this.check();
          return this.iterator.next();
        });
        // Keep only the current waiter. Racing every pull against one lifetime
        // stop promise would retain completed reactions for the entire stream.
        const result = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          this.rejectRead = reject;
          this.pending!.then(resolve, reject);
        });
        this.rejectRead = undefined;
        this.pending = undefined;
        this.check();
        // Empty producer chunks consume work even without retained bytes.
        const checkpoint = this.checkpoint();
        if (checkpoint) await checkpoint;
        if (result.done) {
          this.eof = true;
          break;
        }
        const bytes = result.value;
        if (!(bytes instanceof Uint8Array)) throw new TypeError("Cursor source must yield Uint8Array chunks");
        if (bytes.length === 0) continue;
        const segment: Segment = { bytes, start: 0 };
        if (this.tail) this.tail.next = segment;
        else this.head = segment;
        this.tail = segment;
        this.available += bytes.length;
      } catch (error) {
        this.rejectRead = undefined;
        this.pending = undefined;
        this.stop(error);
        throw error;
      }
    }
    return this.available >= size;
  }

  /** Copy a requested prefix into independently owned primitive storage. */
  copy(size: number): Uint8Array {
    // Give hydrated primitives only their own bytes, never a view pinning the input queue.
    const result = new Uint8Array(size);
    let copied = 0;
    for (let segment = this.head; segment && copied < size; segment = segment.next) {
      const length = Math.min(segment.bytes.length - segment.start, size - copied);
      result.set(segment.bytes.subarray(segment.start, segment.start + length), copied);
      copied += length;
    }
    return result;
  }

  /** Advance once and unlink each fully consumed allocation immediately. */
  consume(size: number): Promise<void> | undefined {
    const start = this.offset;
    this.offset += size;
    this.available -= size;
    while (size > 0) {
      const segment = this.head!;
      const length = Math.min(size, segment.bytes.length - segment.start);
      segment.start += length;
      size -= length;
      if (segment.start === segment.bytes.length) {
        // Unlink immediately; retaining consumed segments would make memory grow with the stream.
        this.head = segment.next;
        if (!this.head) this.tail = undefined;
      }
    }
    return this.checkpoint(this.offset - start);
  }

  /** Yield a host turn after 64 KiB or 4,096 pull/consume operations, shared by all scopes. */
  private checkpoint(bytes = 0): Promise<void> | undefined {
    this.workBytes += bytes;
    this.workItems++;
    if (this.workBytes < 65536 && this.workItems < 4096) return;
    this.workBytes = this.workItems = 0;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.resumeWork = undefined;
        resolve();
      }, 0);
      this.resumeWork = () => {
        clearTimeout(timer);
        this.resumeWork = undefined;
        resolve();
      };
    }).then(() => this.check());
  }

  /** Release queued allocations, wake the current read, and close upstream once. */
  private stop(reason: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = reason;
    this.signal?.removeEventListener("abort", this.abort);
    this.resumeWork?.();
    this.head = this.tail = undefined;
    this.available = 0;
    // Wake blocked readers before attempting upstream cleanup, which may itself be blocked.
    this.rejectRead?.(reason);
    this.rejectRead = undefined;
    this.returnMayBlock = this.pending !== undefined;
    try {
      this.closing = Promise.resolve(this.iterator.return?.()).then(() => {});
    } catch (error) {
      this.closing = Promise.reject(error);
    }
    this.closing.catch(() => {});
  }

  /** Await cooperative cleanup without getting stuck behind an uncancellable next. */
  async close(): Promise<void> {
    this.stop(new DOMException("Cursor closed", "AbortError"));
    // A generic async generator queues return behind next. If next ignores
    // cancellation, waiting for return here would prevent parser shutdown.
    if (!this.returnMayBlock) await this.closing;
  }
}

/**
 * Pull-based byte cursor with immutable enclosure ends and a shared position.
 *
 * Source chunks transfer immutable ownership to the cursor. Only one scope may
 * read at a time.
 * `read`/`peek` return owned bytes; `take` borrows a consumed segment for an
 * awaited sink write. Callers retaining returned values own that memory.
 *
 * Abort interrupts pending reads locally and closes the iterator once. Sources
 * must also honor the signal to cancel their own blocked I/O and cleanup.
 */
export class Cursor {
  /** Shared input owner; child cursors never own a separate source. */
  private readonly input: Input;
  /** Absolute exclusive enclosure end; Infinity denotes the root stream. */
  readonly end: number;

  /** Own a new source and its cancellation. */
  constructor(source: AsyncIterable<Uint8Array>, options?: CursorOptions);
  /** Internal child view over an already owned source and absolute extent. */
  constructor(source: Input, end: number);
  constructor(source: AsyncIterable<Uint8Array> | Input, options: CursorOptions | number = {}) {
    this.input = source instanceof Input ? source : new Input(source, options as CursorOptions);
    this.end = typeof options === "number" ? options : Infinity;
  }

  /** Shared absolute consumed-byte position. */
  get offset(): number {
    return this.input.offset;
  }
  /** Bytes remaining in this enclosure, without reading ahead. */
  get remaining(): number {
    return this.end - this.offset;
  }
  /** Unconsumed queued bytes across all shared scopes. */
  get bufferedBytes(): number {
    return this.input.available;
  }
  /** Reject invalid arithmetic and enclosure crossings before any source pull. */
  private extent(size: number): void {
    this.input.check();
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError("Read size must be a non-negative safe integer");
    if (!Number.isSafeInteger(this.offset + size) || size > this.remaining) {
      throw new GroupSizeError("Read extends beyond enclosure", this.offset);
    }
  }

  /** Make a bounded view without reading ahead or allocating its declared payload. */
  scope(length: number): Cursor {
    this.extent(length);
    return new Cursor(this.input, this.offset + length);
  }

  /** Wait for an exact prefix without consuming it; headers should be read in size stages. */
  peek(size: number): Promise<Uint8Array> {
    return this.bytes(size, false);
  }

  /** Return owned bytes and advance the shared position by exactly their length. */
  read(size: number): Promise<Uint8Array> {
    return this.bytes(size, true);
  }

  /** Share the extent and owned-copy path for read and peek. */
  private bytes(size: number, consume: boolean): Promise<Uint8Array> {
    return this.input.access(async () => {
      this.extent(size);
      if (!await this.input.ensure(size)) throw new ShortageError(size, this.input.available, this.offset);
      const bytes = this.input.copy(size);
      if (consume) {
        const checkpoint = this.input.consume(size);
        if (checkpoint) await checkpoint;
      }
      return bytes;
    });
  }

  /** Borrow and consume at most one segment; returns empty only at a clean view end. */
  take(max: number): Promise<Uint8Array> {
    return this.input.access(async () => {
      if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("Take size must be a positive safe integer");
      this.extent(0);
      if (this.remaining === 0) return new Uint8Array();
      if (!await this.input.ensure(1)) {
        if (this.end === Infinity) return new Uint8Array();
        throw new ShortageError(1, 0, this.offset);
      }
      const segment = this.input.head!;
      const size = Math.min(max, this.remaining, segment.bytes.length - segment.start);
      this.extent(size);
      const bytes = segment.bytes.subarray(segment.start, segment.start + size);
      const checkpoint = this.input.consume(size);
      if (checkpoint) await checkpoint;
      return bytes;
    });
  }

  /** Root EOF is a clean end; EOF inside an unfinished enclosure is a shortage. */
  atEnd(): Promise<boolean> {
    return this.input.access(async () => {
      this.extent(0);
      if (this.remaining === 0) return true;
      if (await this.input.ensure(1)) return false;
      if (this.end !== Infinity) throw new ShortageError(1, 0, this.offset);
      return true;
    });
  }

  /** Require exact enclosure exhaustion before returning to its parent reader. */
  expectEnd(): void {
    this.input.check();
    if (this.remaining !== 0) throw new GroupSizeError("Enclosure has unconsumed bytes", this.offset);
  }

  /** Release queued input and close upstream once, including during blocked reads. */
  close(): Promise<void> {
    return this.input.close();
  }
}
