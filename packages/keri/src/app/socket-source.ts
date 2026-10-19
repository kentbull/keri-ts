/** Pull-based binary TCP input; listener admission and the writable half belong to the connection owner. */
import type { Socket } from "node:net";
import type { SourceOptions } from "./byte-source.ts";

const readers = new WeakSet<Socket>();

/** Cancellation is mandatory so a stalled read can be interrupted before iterator cleanup joins. */
export interface SocketSourceOptions extends SourceOptions {
  /**
   * Required owner cancellation; abort interrupts stalled reads before iterator cleanup can join.
   */
  signal: AbortSignal;
}

/**
 * Borrow exclusive binary readable ownership on first pull; yield independent finite backing buffers.
 * Read size controls each materialized chunk, without claiming a native/RSS memory bound.
 * Socket/OS buffers and a returned native view can have larger backing; copied output is independent.
 * Abort, failure or early return destroys and joins the socket. Genuine receive EOF leaves its writable
 * half intact; the caller must own later socket errors, output drain and final close (allowHalfOpen).
 *
 * @param socket Borrowed binary socket with no competing readable/data consumer; receive ownership is acquired on first pull.
 * @param options Required abort signal and optional positive chunk size in bytes; default 65536.
 * @returns An exclusive iterator allowing one pending next call; each chunk owns its backing buffer.
 * @throws Competing readers, text/object-mode sockets, invalid chunk sizes, I/O and cleanup failures.
 */
export function socketBytes(
  socket: Socket,
  { signal, maxChunkBytes = 64 * 1024 }: SocketSourceOptions,
): AsyncIterableIterator<Uint8Array> {
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1) {
    throw new RangeError("Socket chunk limit must be a positive safe integer");
  }
  let started = false, done = false, busy = false, ended = false, closed = false;
  let failed = false, failure: unknown;
  let wake: (() => void) | undefined, finishClose: (() => void) | undefined;
  let closedSocket: Promise<void> | undefined, closing: Promise<void> | undefined;
  let pending: Promise<IteratorResult<Uint8Array>> | undefined;
  /** Wake the sole pending pull without starting another socket read. */
  const readable = () => wake?.();
  const fail = (error: unknown) => {
    if (!failed) {
      failed = true;
      failure = error;
    }
    readable();
  };
  const end = () => {
    ended = true;
    readable();
  };
  const close = () => {
    closed = true;
    if (!ended && !socket.readableEnded) fail(socket.errored ?? new Error("TCP socket closed before receive EOF"));
    finishClose?.();
    readable();
  };
  /** Keep error/close listeners until destruction joins; EOF only releases readable ownership. */
  const cleanup = (eof = false): Promise<void> =>
    closing ??= (async () => {
      if (!started) return;
      socket.off("readable", readable);
      socket.off("end", end);
      signal.removeEventListener("abort", abort);
      try {
        if (!eof) {
          if (!closed) socket.destroy();
          await closedSocket;
        }
      } finally {
        socket.off("error", fail);
        socket.off("close", close);
        readers.delete(socket);
      }
    })();
  const abort = () => {
    fail(signal.reason);
    // The original Promise stays owned by next()/return(), which join and propagate cleanup errors.
    void cleanup().catch(() => {});
  };
  /** Reject mixed readers before changing socket state or acquiring any listener. */
  const acquire = () => {
    signal.throwIfAborted();
    if (
      readers.has(socket) || socket.readableFlowing || socket.listenerCount("data") || socket.listenerCount("readable")
    ) {
      throw new Error("Socket already has a readable consumer");
    }
    if (socket.readableEncoding || socket.readableObjectMode) {
      throw new TypeError("Socket source requires binary reads");
    }
    if (socket.destroyed && !socket.readableEnded) throw socket.errored ?? new Error("TCP socket is already closed");
    readers.add(socket);
    started = true;
    ended = socket.readableEnded;
    closed = socket.closed;
    closedSocket = new Promise<void>((resolve) => {
      finishClose = resolve;
      if (closed) resolve();
    });
    socket.on("readable", readable);
    socket.on("end", end);
    socket.on("error", fail);
    socket.on("close", close);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    // A readable listener keeps flow mode off; resume also restarts caller-paused native input.
    else socket.resume();
  };
  /** Read only available bytes, so a short fragment does not wait for a full chunk or EOF. */
  const pull = async (): Promise<IteratorResult<Uint8Array>> => {
    try {
      if (!started) acquire();
      while (true) {
        if (failed) throw failure;
        signal.throwIfAborted();
        if (socket.readableLength) {
          const value = socket.read(Math.min(socket.readableLength, maxChunkBytes));
          if (value !== null) {
            if (!(value instanceof Uint8Array) || value.length > maxChunkBytes) {
              throw new TypeError("Socket returned an invalid binary read");
            }
            signal.throwIfAborted();
            // A Node Buffer view may pin a larger native/pool allocation; hand the parser its own backing.
            return { done: false, value: new Uint8Array(value) };
          }
        }
        if (ended || socket.readableEnded) {
          done = true;
          await cleanup(true);
          return { done: true, value: undefined };
        }
        // Start/resume paused native input without requesting an owned data buffer.
        socket.read(0);
        if (failed || ended || socket.readableEnded || socket.readableLength) continue;
        await new Promise<void>((resolve) => wake = resolve);
        wake = undefined;
      }
    } catch (error) {
      done = true;
      try {
        await cleanup();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "TCP read and cleanup failed", { cause: error });
      }
      throw error;
    } finally {
      busy = false;
    }
  };
  return {
    /**
     * Perform the sole pending pull, acquiring readable ownership lazily.
     *
     * @returns The next copied chunk or EOF; overlapping calls reject.
     */
    next() {
      if (busy) return Promise.reject(new Error("Concurrent socket pull"));
      if (done) return Promise.resolve({ done: true, value: undefined });
      busy = true;
      return pending = pull();
    },
    /**
     * Stop iteration early and join socket destruction.
     * A source never pulled owns no socket resources; genuine EOF has already
     * released readable ownership while preserving the writable half.
     *
     * @returns EOF after any acquired socket cleanup and outstanding pull join.
     */
    async return() {
      done = true;
      if (started) {
        fail(new DOMException("Socket source returned", "AbortError"));
        await cleanup();
        await pending?.then(() => {}, () => {});
      }
      return { done: true, value: undefined };
    },
    /**
     * Expose the same reader to for-await iteration; do not create a second consumer.
     *
     * @returns This single-consumer iterator.
     */
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
