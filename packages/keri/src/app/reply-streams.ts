/** Own lazy HTTP replay readers until EOF, transport cancellation, or runtime shutdown. */
export class ReplyStreams {
  /** Closing readers do not retain their replay source or its current event. */
  private readonly readers = new Set<(reason?: unknown) => void>();
  /** Shutdown permanently closes this runtime's response creation. */
  private closed = false;
  /**
   * Borrow a reopenable source without advancing until HTTP requests bytes.
   * Transfer the optional disposer through source closure, including acquisition failure.
   *
   * @param messages Synchronous wire-message iterable; its iterator remains owned by the response until EOF/cancel/close.
   * @param dispose Cleanup callback retained through iterator closure; invoked once even if acquisition fails.
   * @returns Request-owned Web stream.
   * @throws Source or disposer failures propagate; independent cleanup failures are retained.
   */
  open(messages: Iterable<Uint8Array>, dispose?: () => void): ReadableStream<Uint8Array> {
    return this.openChecked(messages, dispose, false)!;
  }

  /**
   * Prime one message; empty output closes ownership for a caller's 404 decision.
   *
   * @param messages Synchronous wire-message iterable; its iterator remains owned by the response until EOF/cancel/close.
   * @param dispose Cleanup callback retained through iterator closure; invoked once even if acquisition fails.
   * @returns Request-owned Web stream, or null after empty-source cleanup.
   * @throws Source or disposer failures propagate; independent cleanup failures are retained.
   */
  openNonEmpty(messages: Iterable<Uint8Array>, dispose?: () => void): ReadableStream<Uint8Array> | null {
    return this.openChecked(messages, dispose, true);
  }

  /**
   * Optional priming shares the same response owner/disposer; ordinary open always returns a stream.
   *
   * @param messages Synchronous wire-message iterable; its iterator remains owned by the response until EOF/cancel/close.
   * @param dispose Cleanup callback retained through iterator closure; invoked once even if acquisition fails.
   * @param requireContent Prime one nonempty message before publishing; empty sources close and return null.
   * @returns Request-owned Web stream, or null after empty-source cleanup.
   * @throws Source or disposer failures propagate; independent cleanup failures are retained.
   */
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

  /**
   * Keep the optional disposer through iterator cleanup, including cancellation before the first pull.
   *
   * @param messages Synchronous wire-message iterable; its iterator remains owned by the response until EOF/cancel/close.
   * @param release Cleanup callback retained through iterator closure; invoked once even if acquisition fails.
   * @param requireContent Prime one nonempty message before publishing; empty sources close and return null.
   * @returns Request-owned Web stream, or null after empty-source cleanup.
   * @throws Source or disposer failures propagate; independent cleanup failures are retained.
   */
  private openOwned(
    messages: Iterable<Uint8Array>,
    release: () => void,
    requireContent: boolean,
  ): ReadableStream<Uint8Array> | null {
    if (this.closed) throw new Error("Reply streams are closed");
    let iterator: Iterator<Uint8Array> | undefined;
    let current: Uint8Array | undefined;
    /** Retain at most one event, ignoring empty source values without acquiring another owner. */
    const advance = (): boolean => {
      while (!current && iterator) {
        const next = iterator.next();
        if (next.done) return false;
        if (next.value.length > 0) current = next.value;
      }
      return current !== undefined;
    };
    /** Close unpublished iterators and their disposer before returning or throwing. */
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
        /**
         * Attach the controller to this response lifetime before the first pull.
         *
         * @param controller Web stream controller retained for subsequent pulls and cancellation.
         */
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
            controller.enqueue(current);
            current = undefined;
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
