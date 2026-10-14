import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";

/** Finite response admission policy, separate from the total number of events in a replay. */
export interface ReplyStreamLimits {
  /** Maximum live HTTP replies owned by one runtime; default eight. */
  maxStreams?: number;
  /** Largest complete event cloned from storage; default 8 MiB. */
  maxMessageBytes?: number;
  /** Largest output allocation passed to the HTTP transport; default 64 KiB. */
  maxChunkBytes?: number;
}

/** Own lazy HTTP replay readers until EOF, transport cancellation, or runtime shutdown. */
export class ReplyStreams {
  /** Closing readers do not retain their replay source or its current event. */
  private readonly readers = new Set<(reason?: unknown) => void>();
  /** Shutdown permanently closes this runtime's response admission. */
  private closed = false;
  /** Finite concurrent response metadata admission. */
  private readonly maxStreams: number;
  /** Finite materialized event admission; replay aggregates remain unbounded in length. */
  private readonly maxMessageBytes: number;
  /** Independent byte credit supplied by each HTTP pull. */
  private readonly maxChunkBytes: number;

  /** Conservative credit for native/body/decoded/proof/reconstruction copies and one outgoing chunk. */
  private readonly reservationBytes: number;

  /** Validate all limits before any response can acquire a storage reader. */
  constructor(
    { maxStreams = 8, maxMessageBytes = 8 * 1024 * 1024, maxChunkBytes = 64 * 1024 }: ReplyStreamLimits = {},
    private readonly resources = new ResourcePolicy(),
  ) {
    for (const limit of [maxStreams, maxMessageBytes, maxChunkBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError("Reply limits must be positive safe integers");
      }
    }
    this.maxStreams = maxStreams;
    this.maxMessageBytes = maxMessageBytes;
    this.maxChunkBytes = maxChunkBytes;
    // Reserve before iterator acquisition: next() may reconstruct an event before yielding its final bytes.
    this.reservationBytes = 8 * maxMessageBytes + maxChunkBytes;
    if (!Number.isSafeInteger(this.reservationBytes)) throw new RangeError("Reply reservation exceeds safe range");
  }

  /** Source producers use this same captured ceiling for native preflight before hydration. */
  get messageByteLimit(): number {
    return this.maxMessageBytes;
  }

  /** Borrow a reopenable source without advancing until HTTP requests bytes.
   * Transfer the optional disposer through source closure, including admission/acquisition refusal.
   */
  open(messages: Iterable<Uint8Array>, dispose?: () => void): ReadableStream<Uint8Array> {
    return this.openChecked(messages, dispose, false)!;
  }

  /** Admit before priming one finite message; empty output closes ownership for a caller's 404 decision. */
  openNonEmpty(messages: Iterable<Uint8Array>, dispose?: () => void): ReadableStream<Uint8Array> | null {
    return this.openChecked(messages, dispose, true);
  }

  /** Optional priming shares the same response owner/disposer; ordinary open always returns a stream. */
  private openChecked(
    messages: Iterable<Uint8Array>,
    dispose: (() => void) | undefined,
    requireContent: boolean,
  ): ReadableStream<Uint8Array> | null {
    const release = () => {
      const owned = dispose;
      dispose = undefined;
      owned?.();
    };
    try {
      return this.openOwned(messages, release, requireContent);
    } catch (error) {
      try {
        release();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Reply acquisition cleanup failed");
      }
      throw error;
    }
  }

  /** Keep transferred cue credit through iterator cleanup, including cancellation before the first pull. */
  private openOwned(
    messages: Iterable<Uint8Array>,
    release: () => void,
    requireContent: boolean,
  ): ReadableStream<Uint8Array> | null {
    if (this.closed) throw new Error("Reply streams are closed");
    if (this.readers.size >= this.maxStreams) throw new ResourceAdmissionError("Too many active HTTP replies", "busy");
    const credit = this.resources.reserve({ streams: 1, bytes: this.reservationBytes });
    if (credit.kind === "refuse") {
      throw new ResourceAdmissionError(`Reply ${credit.resource} admission refused: ${credit.reason}`, credit.reason);
    }
    let iterator: Iterator<Uint8Array> | undefined;
    let current: Uint8Array | undefined;
    let offset = 0;
    /** Retain at most one admitted event, ignoring empty source values without acquiring another owner. */
    const advance = (): boolean => {
      while (!current && iterator) {
        const next = iterator.next();
        if (next.done) return false;
        if (next.value.buffer.byteLength > this.maxMessageBytes) {
          throw new ResourceLimitError("Replay message exceeds byte limit");
        }
        if (next.value.length > 0) current = next.value;
        offset = 0;
      }
      return current !== undefined;
    };
    /** Unpublished acquisition/empty-result cleanup runs before response credit returns. */
    const closeUnpublished = (primary?: { error: unknown }) => {
      const errors = primary ? [primary.error] : [];
      const owned = iterator;
      iterator = undefined;
      current = undefined;
      try {
        owned?.return?.();
      } catch (error) {
        if (!errors.includes(error)) errors.push(error);
      }
      try {
        release();
      } catch (error) {
        if (!errors.includes(error)) errors.push(error);
      }
      credit.reservation.release();
      if (errors.length > 1) throw new AggregateError(errors, "Reply acquisition cleanup failed");
      if (errors.length) throw errors[0];
    };
    let empty = false;
    try {
      iterator = messages[Symbol.iterator]();
      if (!iterator || typeof iterator.next !== "function") {
        throw new TypeError("Reply source must provide an iterator");
      }
      empty = requireContent && !advance();
    } catch (error) {
      closeUnpublished({ error });
    }
    if (empty) {
      closeUnpublished();
      return null;
    }
    let stream: ReadableStreamDefaultController<Uint8Array>;
    /** Remove ownership exactly once, including when the platform still holds a reader lock. */
    const close = (reason?: unknown) => {
      if (!iterator) return;
      const owned = iterator;
      iterator = undefined;
      current = undefined;
      this.readers.delete(close);
      const failures: unknown[] = [];
      try {
        owned.return?.();
      } catch (error) {
        failures.push(error);
      }
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
      credit.reservation.release();
      if (failures.length) {
        const error = failures.length === 1 && reason === undefined
          ? failures[0]
          : new AggregateError(reason === undefined ? failures : [reason, ...failures], "Reply cleanup failed");
        stream.error(error);
        throw error;
      }
      if (reason !== undefined) stream.error(reason);
    };
    this.readers.add(close);
    try {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
        pull: (controller) => {
          try {
            if (!advance()) {
              close();
              controller.close();
              return;
            }
            if (!current) return;
            // Copy the outgoing extent so a retained transport chunk cannot pin the entire event buffer.
            const end = Math.min(current.length, offset + this.maxChunkBytes);
            controller.enqueue(current.slice(offset, end));
            offset = end;
            if (offset === current.length) current = undefined;
          } catch (error) {
            close(error);
          }
        },
        cancel: () => close(),
      }, { highWaterMark: 0 });
    } catch (error) {
      this.readers.delete(close);
      closeUnpublished({ error });
      throw error;
    }
  }

  /** Abort all response readers before their underlying runtime/database owners close. */
  close(): void {
    this.closed = true;
    const reason = new DOMException("Runtime closed", "AbortError");
    const failures: unknown[] = [];
    for (const close of this.readers) {
      try {
        close(reason);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Reply shutdown failed");
  }
}
