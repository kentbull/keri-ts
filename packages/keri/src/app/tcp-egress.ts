/** Concrete TCP connections and pull-driven writers; applications compose receive work. */
import { type CesrFrame, framePayload } from "cesr-ts";
import { createConnection, type Socket } from "node:net";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable, rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { defaultRuntimeClock, type RuntimeClock, type RuntimeTimer } from "./runtime-services.ts";
import { TransportError } from "./transport-error.ts";

/** Actual connection/write choices, without a parser or receive callback. */
export interface TcpSendOptions {
  /** Serializer chunk size; default 64 KiB. */
  maxChunkBytes?: number;
  /** Connection acquisition deadline; default 30 seconds. */
  connectTimeoutMs?: number;
  /** Absolute local-drain deadline from output EOF, also covering peer close for duplex; default 30 seconds. */
  drainTimeoutMs?: number;
  signal?: AbortSignal;
  clock?: RuntimeClock;
}

/** Producer observes abort and joins cleanup on return. */
export type TcpSourceFactory = (signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;

/** Local flushed output and joined close, never authenticated remote acceptance. */
export interface TcpTransmission {
  kind: "transmitted";
  bytes: number;
}

/** A borrowed real connection. Its owner joins close after application children stop. */
export interface TcpConnection {
  readonly socket: Socket;
  readonly closed: Promise<void>;
  readonly signal: AbortSignal;
  /** Stop both directions immediately, retaining the originating failure. */
  close(reason?: unknown): void;
}

/** Validate actual chunk sizes and deadlines before acquiring a socket. */
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

/** Lend a paused, half-open-capable socket; no application receiver runs inside transport. */
export function openTcpConnection(
  url: string,
  options: Pick<TcpSendOptions, "clock" | "connectTimeoutMs" | "signal"> = {},
): Operation<TcpConnection> {
  return resource<TcpConnection>(function*(provide) {
    const parsed = new URL(url), port = Number(parsed.port);
    if (parsed.protocol !== "tcp:" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`TCP output requires tcp: with a valid port: ${url}`);
    }
    const timeout = positive(options.connectTimeoutMs ?? 30000, "connectTimeoutMs");
    const clock = options.clock ?? defaultRuntimeClock;
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

/** Send a resident value over the same concrete connection/source owner as streaming output. */
export function sendCesrTcp(url: string, bytes: Uint8Array, options: TcpSendOptions = {}): Operation<TcpTransmission> {
  const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
  return streamCesrTcp(url, (signal) => chunkBytes(bytes, { signal, maxChunkBytes: cap }), options);
}

/** Transmit-only flow completes local drain, then its connection owner joins close without awaiting peer EOF. */
export function streamCesrTcp(
  url: string,
  source: TcpSourceFactory,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  return call(function*() {
    const connection = yield* openTcpConnection(url, options);
    connection.socket.resume();
    return yield* finishTcpOutput(connection, source, options, false);
  });
}

/** Borrow an already hydrated frame through serializer completion, without reparsing. */
export function sendCesrTcpFrame(
  url: string,
  frame: CesrFrame,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
  return streamCesrTcp(url, async function*(signal) {
    for await (const chunk of framePayload(frame).open(signal)) {
      yield* chunkBytes(chunk, { signal, maxChunkBytes: cap });
    }
  }, options);
}

/** Write options for a caller-owned socket; this operation never ends its writable half. */
export interface TcpSocketWriteOptions {
  clock?: RuntimeClock;
  signal?: AbortSignal;
}

/** Pull/write/drain one chunk at a time and join source cleanup before returning. */
export function writeCesrTcpSocket(
  socket: Socket,
  factory: TcpSourceFactory,
  { clock = defaultRuntimeClock, signal }: TcpSocketWriteOptions = {},
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

/** End local output after source EOF, then join peer close under one fixed drain deadline. */
export function sendCesrTcpSocket(
  connection: TcpConnection,
  factory: TcpSourceFactory,
  options: Pick<TcpSendOptions, "clock" | "drainTimeoutMs"> = {},
): Operation<TcpTransmission> {
  return finishTcpOutput(connection, factory, options, true);
}

/** One fixed deadline covers local end and, only for a duplex owner, peer close. */
function finishTcpOutput(
  connection: TcpConnection,
  factory: TcpSourceFactory,
  options: Pick<TcpSendOptions, "clock" | "drainTimeoutMs">,
  waitForPeer: boolean,
): Operation<TcpTransmission> {
  const timeout = positive(options.drainTimeoutMs ?? 30000, "drainTimeoutMs");
  const clock = options.clock ?? defaultRuntimeClock;
  return abortable(async (signal) => {
    let timer: RuntimeTimer | undefined;
    let ending: Promise<void> | undefined;
    let endClosed: (() => void) | undefined;
    const stop = () => connection.close(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    try {
      const bytes = await writeBorrowedSource(connection.socket, factory, signal, clock, {
        fail: connection.close,
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

/** Wake blocked I/O on cancellation without leaving the underlying promise unobserved. */
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

/** Shared source/read/callback/drain loop; connection owners handle abort and socket close. */
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
