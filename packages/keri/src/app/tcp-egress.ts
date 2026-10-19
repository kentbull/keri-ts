/** Concrete TCP connections and pull-driven writers; applications compose receive work. */
import { type CesrFrame, framePayload } from "cesr-ts";
import { createConnection, type Socket } from "node:net";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable, rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { type RuntimeClock, type RuntimeTimer } from "./runtime-clock.ts";
import { TransportError } from "./transport-error.ts";

/** Actual connection/write choices, without a parser or receive callback. */
export interface TcpSendOptions {
  /** Serializer chunk size; default 64 KiB. */
  maxChunkBytes?: number;
  /** Connection acquisition deadline; default 30 seconds. */
  connectTimeoutMs?: number;
  /** Absolute local-drain deadline from output EOF, also covering peer close for duplex; default 30 seconds. */
  drainTimeoutMs?: number;
  /**
   * Optional upstream cancellation; abort stops source/output and joins the owned connection.
   */
  signal?: AbortSignal;
}

/** Producer observes abort and joins cleanup on return. */
export type TcpSourceFactory = (signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;

/**
 * Count bytes whose local write completion was observed.
 * This result does not prove remote parsing or acceptance. Owning send operations
 * join socket close; writeCesrTcpSocket only joins its source and leaves the
 * caller-owned writable half open.
 */
export interface TcpTransmission {
  /**
   * Identifies local transmission completion, not a protocol receipt.
   */
  kind: "transmitted";
  /**
   * Sum of nonempty source chunks whose write callbacks and required drains completed.
   */
  bytes: number;
}

/** A borrowed real connection. Its owner joins close after application children stop. */
export interface TcpConnection {
  /**
   * Paused binary socket with allowHalfOpen; borrower supplies any receive processing.
   */
  readonly socket: Socket;
  /**
   * Settles on native socket close; does not itself imply successful transmission.
   */
  readonly closed: Promise<void>;
  /**
   * Combined caller/connection cancellation, including the originating connection failure.
   */
  readonly signal: AbortSignal;
  /**
   * Stop both directions immediately, retaining the originating failure.
   *
   * @param reason Optional failure/cancellation reason retained by the connection signal.
   */
  close(reason?: unknown): void;
}

/**
 * Validate actual chunk sizes and deadlines before acquiring a socket.
 *
 * @param value Requested byte count or duration.
 * @param name Option name used in the validation error.
 * @returns The unchanged validated value.
 * @throws RangeError for nonpositive or unsafe integers.
 */
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

/**
 * Open a socket and lend it to application-owned receive/transmit operations.
 * This resource does not parse incoming data. Its scope destroys the socket and
 * joins native close after child operations stop. Receive EOF can leave output
 * open; the borrower must complete or cancel both directions before releasing it.
 *
 * @param url TCP endpoint with an explicit port in the range 1–65535.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Connection timeout in milliseconds and optional upstream cancellation; default timeout is 30000.
 * @returns A paused half-open-capable connection borrowed until the enclosing scope ends.
 * @throws URL/option validation failures precede connection acquisition; connection errors retain their causes as TransportError.
 */
export function openTcpConnection(
  url: string,
  clock: RuntimeClock,
  options: Pick<TcpSendOptions, "connectTimeoutMs" | "signal"> = {},
): Operation<TcpConnection> {
  return resource<TcpConnection>(function*(provide) {
    const parsed = new URL(url), port = Number(parsed.port);
    if (parsed.protocol !== "tcp:" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`TCP output requires tcp: with a valid port: ${url}`);
    }
    const timeout = positive(options.connectTimeoutMs ?? 30000, "connectTimeoutMs");
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    signal.throwIfAborted();
    const socket = createConnection({ host: parsed.hostname, port, allowHalfOpen: true });
    socket.pause();
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    const destroy = () => socket.destroy();
    const close = (reason?: unknown) => {
      controller.abort(reason);
      socket.destroy();
    };
    const disconnected = () => {
      if (!socket.writableFinished) close(new TransportError(`TCP ${url} closed before output completed`));
      else if (!socket.readableEnded) close(new TransportError(`TCP ${url} closed before receive EOF`));
    };
    const failed = (cause: Error) => close(new TransportError(`TCP connection to ${url} failed`, { cause }));
    socket.on("error", failed);
    socket.on("close", disconnected);
    signal.addEventListener("abort", destroy, { once: true });
    let timer: RuntimeTimer | undefined;
    try {
      yield* abortable(async (signal) => {
        timer = clock.setTimeout(() => close(new TransportError(`TCP connect deadline exceeded for ${url}`)), timeout);
        try {
          await interrupted(new Promise<void>((resolve) => socket.once("connect", resolve)), signal);
        } finally {
          clock.clearTimeout(timer);
          timer = undefined;
        }
      }, signal);
      yield* provide({ socket, closed, signal, close });
    } finally {
      close();
      yield* call(() => closed);
      signal.removeEventListener("abort", destroy);
      socket.off("error", failed);
      socket.off("close", disconnected);
    }
  });
}

/**
 * Send a resident value over the same concrete connection/source owner as streaming output.
 *
 * @param url TCP endpoint with an explicit port in the range 1–65535.
 * @param bytes Resident signed wire bytes; chunking copies each outgoing segment.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines.
 * @returns Locally flushed byte count after owned socket cleanup joins; no receive-EOF or protocol-acceptance guarantee.
 * @throws Source/serialization, transport, cancellation and cleanup errors propagate.
 */
export function sendCesrTcp(
  url: string,
  bytes: Uint8Array,
  clock: RuntimeClock,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
  return streamCesrTcp(url, (signal) => chunkBytes(bytes, { signal, maxChunkBytes: cap }), clock, options);
}

/**
 * Transmit-only flow completes local drain, then its connection owner joins close without awaiting peer EOF.
 *
 * @param url TCP endpoint with an explicit port in the range 1–65535.
 * @param source Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines.
 * @returns Locally flushed byte count after owned socket cleanup joins; no receive-EOF or protocol-acceptance guarantee.
 * @throws Source/serialization, transport, cancellation and cleanup errors propagate.
 */
export function streamCesrTcp(
  url: string,
  source: TcpSourceFactory,
  clock: RuntimeClock,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  return call(function*() {
    const connection = yield* openTcpConnection(url, clock, options);
    connection.socket.resume();
    return yield* finishTcpOutput(connection, source, clock, options, false);
  });
}

/**
 * Borrow an already hydrated frame through serializer completion, without reparsing.
 *
 * @param url TCP endpoint with an explicit port in the range 1–65535.
 * @param frame Borrowed parsed frame; serialization preserves its body and attachments without reparsing.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines.
 * @returns Locally flushed byte count after owned socket cleanup joins; no receive-EOF or protocol-acceptance guarantee.
 * @throws Source/serialization, transport, cancellation and cleanup errors propagate.
 */
export function sendCesrTcpFrame(
  url: string,
  frame: CesrFrame,
  clock: RuntimeClock,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
  return streamCesrTcp(
    url,
    async function*(signal) {
      for await (const chunk of framePayload(frame).open(signal)) {
        yield* chunkBytes(chunk, { signal, maxChunkBytes: cap });
      }
    },
    clock,
    options,
  );
}

/** Write options for a caller-owned socket; this operation never ends its writable half. */
export interface TcpSocketWriteOptions {
  /**
   * Optional caller cancellation; abort destroys this socket but its caller owns joining close.
   */
  signal?: AbortSignal;
}

/**
 * Pull/write/drain one chunk at a time and join source cleanup before returning.
 *
 * @param socket Borrowed writable socket; this operation never calls end on successful completion.
 * @param factory Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Optional cancellation for this write/source lifetime.
 * @returns Locally flushed byte count after source cleanup; caller still owns final socket close.
 * @throws Source and write errors propagate; abort destroys the socket to interrupt pending output.
 */
export function writeCesrTcpSocket(
  socket: Socket,
  factory: TcpSourceFactory,
  clock: RuntimeClock,
  { signal }: TcpSocketWriteOptions = {},
): Operation<TcpTransmission> {
  return abortable(async (signal) => {
    const destroy = () => socket.destroy();
    signal.addEventListener("abort", destroy, { once: true });
    try {
      return {
        kind: "transmitted",
        bytes: await writeBorrowedSource(socket, factory, signal, clock, { fail: destroy }),
      };
    } finally {
      signal.removeEventListener("abort", destroy);
    }
  }, signal);
}

/**
 * Finish output on a duplex connection and wait for native connection close.
 * The receiver must run concurrently and consume the peer's readable half. The
 * messenger separately joins receive processing before reporting duplex success.
 *
 * @param connection Borrowed connection with an application-owned concurrent receive operation.
 * @param factory Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Absolute drain timeout starting at source EOF; default 30000 milliseconds.
 * @returns Flushed bytes after local end and peer close, within the same drain deadline.
 */
export function sendCesrTcpSocket(
  connection: TcpConnection,
  factory: TcpSourceFactory,
  clock: RuntimeClock,
  options: Pick<TcpSendOptions, "drainTimeoutMs"> = {},
): Operation<TcpTransmission> {
  return finishTcpOutput(connection, factory, clock, options, true);
}

/**
 * Write the source, end the writable half, and apply the selected close boundary.
 * One deadline starts at source EOF and is never refreshed by activity. Transmit-only
 * completion does not wait for arbitrary peer EOF. Its enclosing connection resource
 * subsequently joins close; a later receive reset does not revise completed local output.
 *
 * @param connection Connection whose signal and close operation own both directions.
 * @param factory Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param options Absolute post-source-EOF drain timeout in milliseconds.
 * @param waitForPeer True for duplex: also await native close. False completes after local end.
 * @returns Local transmission count at the selected completion boundary.
 */
function finishTcpOutput(
  connection: TcpConnection,
  factory: TcpSourceFactory,
  clock: RuntimeClock,
  options: Pick<TcpSendOptions, "drainTimeoutMs">,
  waitForPeer: boolean,
): Operation<TcpTransmission> {
  const timeout = positive(options.drainTimeoutMs ?? 30000, "drainTimeoutMs");
  return abortable(async (signal) => {
    let timer: RuntimeTimer | undefined;
    let ending: Promise<void> | undefined;
    let endClosed: (() => void) | undefined;
    const stop = () => connection.close(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    try {
      const bytes = await writeBorrowedSource(connection.socket, factory, signal, clock, {
        fail: connection.close,
        /**
         * Start the absolute output-drain deadline only after the source reports EOF.
         */
        eof() {
          timer = clock.setTimeout(() => connection.close(new TransportError("TCP drain deadline exceeded")), timeout);
        },
      });
      signal.throwIfAborted();
      ending = new Promise<void>((resolve, reject) => {
        // Some runtimes omit end's callback after destroy; actual socket close still settles this I/O.
        endClosed = () => reject(signal.aborted ? signal.reason : new TransportError("TCP closed before output ended"));
        connection.socket.once("close", endClosed);
        connection.socket.end((cause?: Error) =>
          cause
            ? reject(signal.aborted ? signal.reason : new TransportError("TCP output end failed", { cause }))
            : resolve()
        );
      });
      await interrupted(ending, signal);
      ending = undefined;
      if (waitForPeer) await interrupted(connection.closed, signal);
      return { kind: "transmitted", bytes };
    } finally {
      if (signal.aborted) connection.close(signal.reason);
      await ending?.catch(() => undefined);
      if (endClosed) connection.socket.off("close", endClosed);
      if (timer !== undefined) clock.clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  }, connection.signal);
}

/**
 * Interrupt waiting without claiming to cancel or join the underlying I/O.
 * The attached rejection observer avoids an unhandled late rejection; ownership
 * and cleanup of the pending operation remain with the caller.
 *
 * @param pending Actual I/O promise; its owner must still join it after cancellation.
 * @param signal Signal whose exact reason rejects the wait.
 * @returns The I/O result if it wins the cancellation race.
 */
async function interrupted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Pull and flush one source chunk before requesting the next.
 * Source EOF is distinct from socket.end. The owner receives failure before this
 * helper joins pending reads/writes and returns the iterator, allowing it to unblock
 * connection I/O. Distinct late cleanup failures remain visible.
 *
 * @param socket Borrowed socket; the connection owner handles final destruction and close.
 * @param factory Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
 * @param signal Owner cancellation, checked between pulls and native writes.
 * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
 * @param hooks Optional owner notifications: eof runs on source exhaustion; fail interrupts the connection before cleanup joins.
 * @returns Bytes whose write callbacks and any backpressure drain completed.
 */
async function writeBorrowedSource(
  socket: Socket,
  factory: TcpSourceFactory,
  signal: AbortSignal,
  clock: RuntimeClock,
  hooks: { eof?: () => void; fail?: (error: unknown) => void } = {},
): Promise<number> {
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let pendingRead: Promise<IteratorResult<Uint8Array>> | undefined;
  let pendingWrite: Promise<void> | undefined;
  let timer: RuntimeTimer | undefined;
  let failure: { error: unknown } | undefined;
  let bytes = 0, work = 0;
  /** Join late failures without reporting the same read/write rejection twice. */
  const noteCleanup = (error: unknown) => {
    if (failure && error === failure.error) return;
    try {
      if (signal.aborted) rethrowCleanupFailure(error, signal);
      else throw error;
    } catch (remaining) {
      failure = {
        error: failure ? new AggregateError([failure.error, remaining], "TCP source cleanup failed") : remaining,
      };
    }
  };
  try {
    const source = await factory(signal);
    iterator = source[Symbol.asyncIterator]();
    signal.throwIfAborted();
    while (true) {
      // Empty/immediately resolved producers must not starve socket events or scope cancellation.
      if (++work === 4096) {
        work = 0;
        await interrupted(
          new Promise<void>((resolve) => {
            timer = clock.setTimeout(resolve, 0);
          }),
          signal,
        );
        clock.clearTimeout(timer);
        timer = undefined;
      }
      pendingRead = Promise.resolve(iterator.next());
      const part = await interrupted(pendingRead, signal);
      pendingRead = undefined;
      signal.throwIfAborted();
      if (part.done) {
        hooks.eof?.();
        break;
      }
      if (!(part.value instanceof Uint8Array)) throw new TypeError("TCP source must yield binary chunks");
      if (!part.value.length) continue;
      let drain!: () => void;
      const drained = new Promise<void>((resolve) => drain = resolve);
      socket.once("drain", drain);
      try {
        let writable = false;
        pendingWrite = new Promise<void>((resolve, reject) => {
          writable = socket.write(part.value, (error) => {
            // Destroying our socket cancels its queued write; preserve that owner's abort reason.
            if (
              signal.aborted && ((error as NodeJS.ErrnoException | undefined)?.code === "ECANCELED"
                || (signal.reason instanceof TransportError && signal.reason.cause === error))
            ) {
              reject(signal.reason);
            } else if (error) reject(new TransportError("TCP output write failed", { cause: error }));
            else resolve();
          });
        });
        await interrupted(pendingWrite, signal);
        pendingWrite = undefined;
        if (!writable) await interrupted(drained, signal);
      } finally {
        socket.removeListener("drain", drain);
      }
      bytes += part.value.length;
    }
  } catch (error) {
    failure = { error };
    hooks.fail?.(error);
  } finally {
    try {
      await pendingRead?.catch(noteCleanup);
      await iterator?.return?.();
    } catch (error) {
      noteCleanup(error);
    } finally {
      await pendingWrite?.catch(noteCleanup);
      if (timer !== undefined) clock.clearTimeout(timer);
    }
  }
  if (failure) throw failure.error;
  return bytes;
}
