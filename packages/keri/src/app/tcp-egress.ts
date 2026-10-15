/** One owned TCP writer shared by finite values and pull-driven sources. */
import {
  type CesrFrame,
  framePayload,
  ResourceAdmissionError,
  type ResourceDecision,
  ResourceLimitError,
} from "cesr-ts";
import { createConnection, type Socket } from "node:net";
import { call, type Operation, resource, type Task } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { cesrOutputMetadataBytes } from "./cesr-output.ts";
import { defaultRuntimeServices, type RuntimeServices, type RuntimeTimer } from "./runtime-services.ts";
import { socketBytes } from "./socket-source.ts";

// Read/handle allowance remains logical policy, not a native pool/kernel ceiling.
const RX_HANDLE = 2 * 1024 ** 2;

/** Output limits and cancellation shared by all TCP input forms. */
export interface TcpSendOptions {
  /** Optional bounded byte consumer; application parsing/dispatch stays above this transport. */
  read?: TcpRead;
  /** Source backing limit and one admitted transport-copy allowance; default 64 KiB. */
  maxChunkBytes?: number;
  /** Connection acquisition deadline; default 30 seconds. */
  connectTimeoutMs?: number;
  /** Absolute end/peer-close deadline after source EOF, never refreshed; default 30 seconds. */
  drainTimeoutMs?: number;
  /** Cancellation joins source reads, write callbacks and socket close. */
  signal?: AbortSignal;
  /** Owning runtime's shared admission and clock. */
  services?: RuntimeServices;
  /** Invocation-local observation of engine-created capacity refusal; foreign failures remain unclassified. */
  onAdmissionRefusal?: (error: ResourceAdmissionError) => void;
}

/** Producer observes abort, yields immutable bounded backing, and joins cleanup on return. */
export type TcpSourceFactory = (signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;

/** This describes local flushed output and joined close, never authenticated remote acceptance. */
export interface TcpTransmission {
  kind: "transmitted";
  bytes: number;
}

/**
 * One bounded incoming byte stream, prepared before connection and run after connect.
 * open owns consumer setup/cleanup and lends one operation for the connection scope.
 * Consume through EOF or fail; setup must not invoke the source before connection.
 * The transport knows bytes and finite read bounds, not the consumer's protocol.
 * This scope-local consumer is never retained as queued work.
 */
export interface TcpRead {
  readonly maxChunkBytes: number;
  readonly maxBufferedBytes: number;
  open(source: (signal: AbortSignal) => AsyncIterable<Uint8Array>, signal: AbortSignal): Operation<Operation<void>>;
}

/** Expected capacity refusal from this transport invocation, after owned cleanup joins. */
export type TcpAttempt = TcpTransmission | { kind: "refuse"; error: ResourceAdmissionError };

/** Send one already resident value; its owner remains borrowed until joined completion. */
export function sendCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  return completedTcp(attemptSendCesrTcp(url, bytes, options));
}

/** Finite attempt shares the byte transport owner without acquiring protocol components. */
export function attemptSendCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpSendOptions = {},
): Operation<TcpAttempt> {
  const cap = Math.min(positive(options.maxChunkBytes ?? 65536, "maxChunkBytes"), Math.max(1, bytes.length));
  return attemptWriteTcp(url, (signal) => chunkBytes(bytes, { signal, maxChunkBytes: cap }), {
    ...options,
    maxChunkBytes: cap,
  }, bytes.buffer.byteLength);
}

/**
 * Pull one chunk only after the previous write callback and required drain finish.
 * Admission precedes connection and factory acquisition. Custom factories must honor
 * their signal and admit any pre-yield allocations themselves; this owns two chunk
 * allowances, not native pools, readable high-water buffers or kernel socket memory.
 */
export function streamCesrTcp(
  url: string,
  source: TcpSourceFactory,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  return writeTcp(url, source, options, 0);
}

/**
 * Send an already admitted frame tree directly through its serializer, never reparsing.
 * Borrow every actual frame/ESSR/child owner until joined completion; this neither
 * adopts nor discards them. Conservative HTTP-equivalent metadata credit precedes
 * serializer construction; fixed reader/output backing credit covers re-chunking.
 */
export function sendCesrTcpFrame(
  url: string,
  frame: CesrFrame,
  options: TcpSendOptions = {},
): Operation<TcpTransmission> {
  const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
  const metadata = 8 * cesrOutputMetadataBytes(frame) + 2 * 1024 ** 2;
  return writeTcp(
    url,
    async function*(signal) {
      for await (const chunk of framePayload(frame).open(signal)) {
        yield* chunkBytes(chunk, { signal, maxChunkBytes: cap });
      }
    },
    options,
    metadata,
  );
}

/** Validate caller budgets before admission or socket acquisition. */
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
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

/** Output on a caller-owned connection, borrowing its existing stream/cursor slot. */
export interface TcpSocketWriteOptions {
  services: RuntimeServices;
  maxChunkBytes?: number;
  signal?: AbortSignal;
}

/**
 * Write a bounded source without ending the accepted socket or acquiring another parser/stream.
 * The caller owns connection/stream admission and source evidence through joined completion.
 * Separate output backing credit precedes source acquisition; cancellation destroys the socket
 * to wake pending callbacks, joins source return/write completion, then returns byte credit.
 */
export function writeCesrTcpSocket(
  socket: Socket,
  factory: TcpSourceFactory,
  { services, maxChunkBytes = 65536, signal }: TcpSocketWriteOptions,
): Operation<TcpTransmission> {
  return call(function*() {
    const cap = positive(maxChunkBytes, "maxChunkBytes");
    yield* resource<void>(function*(provide) {
      const credit = services.resources.reserve({ bytes: 2 * cap });
      if (credit.kind === "refuse") {
        throw new ResourceAdmissionError("TCP socket output admission refused", credit.reason);
      }
      try {
        yield* provide();
      } finally {
        credit.reservation.release();
      }
    });
    return yield* abortable(async (signal) => {
      const destroy = () => socket.destroy();
      signal.addEventListener("abort", destroy, { once: true });
      try {
        return {
          kind: "transmitted",
          bytes: await writeBorrowedSource(socket, factory, signal, services, cap, { fail: destroy }),
        };
      } finally {
        signal.removeEventListener("abort", destroy);
      }
    }, signal);
  });
}

/** Shared source/read/callback/drain loop; connection owners handle abort and socket close. */
async function writeBorrowedSource(
  socket: Socket,
  factory: TcpSourceFactory,
  signal: AbortSignal,
  services: RuntimeServices,
  cap: number,
  hooks: { eof?: () => void; fail?: (error: unknown) => void; failedCleanup?: () => void } = {},
): Promise<number> {
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let pendingRead: Promise<IteratorResult<Uint8Array>> | undefined;
  let pendingWrite: Promise<void> | undefined;
  let timer: RuntimeTimer | undefined;
  let failure: { error: unknown } | undefined;
  let bytes = 0, work = 0;
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
            timer = services.clock.setTimeout(resolve, 0);
          }),
          signal,
        );
        services.clock.clearTimeout(timer);
        timer = undefined;
      }
      pendingRead = Promise.resolve(iterator.next());
      const part = await interrupted(pendingRead, signal);
      pendingRead = undefined;
      if (part.done) {
        hooks.eof?.();
        break;
      }
      if (!(part.value instanceof Uint8Array)) throw new TypeError("TCP source must yield binary chunks");
      if (part.value.buffer.byteLength > cap) {
        throw new ResourceLimitError(`TCP chunk backing exceeds ${cap} bytes`);
      }
      if (!part.value.length) continue;
      let drain!: () => void;
      const drained = new Promise<void>((resolve) => drain = resolve);
      socket.once("drain", drain);
      try {
        let writable = false;
        pendingWrite = new Promise<void>((resolve, reject) => {
          writable = socket.write(part.value, (error) => error ? reject(error) : resolve());
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
    if (failure !== undefined || signal.aborted) hooks.failedCleanup?.();
    try {
      await pendingRead?.catch(() => undefined);
      await iterator?.return?.();
    } catch (error) {
      failure = { error: failure ? new AggregateError([failure.error, error], "TCP source cleanup failed") : error };
    } finally {
      await pendingWrite?.catch(() => undefined);
      if (timer !== undefined) services.clock.clearTimeout(timer);
    }
  }
  if (failure) throw failure.error;
  return bytes;
}

/** Preserve strict streaming/frame APIs over the same connection owner. */
function writeTcp(
  url: string,
  factory: TcpSourceFactory,
  options: TcpSendOptions,
  retainedBytes: number,
): Operation<TcpTransmission> {
  return completedTcp(attemptWriteTcp(url, factory, options, retainedBytes));
}

/** Refusals become exceptions only after the attempt joins its owned cleanup. */
function* completedTcp(attempt: Operation<TcpAttempt>): Operation<TcpTransmission> {
  const result = yield* attempt;
  if (result.kind === "refuse") throw result.error;
  return result;
}

/** Shared connection/source/write owner; no direction, queue or parser is duplicated by adapters. */
function attemptWriteTcp(
  url: string,
  factory: TcpSourceFactory,
  options: TcpSendOptions,
  retainedBytes: number,
): Operation<TcpAttempt> {
  return call(function*(): Operation<TcpAttempt> {
    const refuse = (error: ResourceAdmissionError): Extract<TcpAttempt, { kind: "refuse" }> => {
      options.onAdmissionRefusal?.(error);
      return { kind: "refuse", error };
    };
    const parsed = new URL(url), port = Number(parsed.port);
    if (parsed.protocol !== "tcp:" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`TCP output requires tcp: with a valid port: ${url}`);
    }
    const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
    const connectTimeout = positive(options.connectTimeoutMs ?? 30000, "connectTimeoutMs");
    const drainTimeout = positive(options.drainTimeoutMs ?? 30000, "drainTimeoutMs");
    const read = options.read === undefined ? undefined : {
      maxChunkBytes: options.read.maxChunkBytes,
      maxBufferedBytes: options.read.maxBufferedBytes,
      open: options.read.open.bind(options.read),
    };
    const services = options.services ?? defaultRuntimeServices;
    if (read) {
      positive(read.maxChunkBytes, "read.maxChunkBytes");
      positive(read.maxBufferedBytes, "read.maxBufferedBytes");
      if (read.maxChunkBytes > read.maxBufferedBytes) throw new RangeError("Read chunk limit exceeds buffer limit");
    }
    const outputBytes = retainedBytes + 2 * cap + (read ? RX_HANDLE : 0);
    if (!Number.isSafeInteger(outputBytes)) throw new RangeError("TCP output charge exceeds safe integer range");
    if (
      read && (services.resources.limits.streams < 2
        || services.resources.limits.bytes < outputBytes + read.maxChunkBytes + read.maxBufferedBytes)
    ) {
      return refuse(new ResourceAdmissionError("TCP duplex exceeds configured capacity", "limit"));
    }
    const credit = yield* resource<ResourceDecision>(function*(provide) {
      const admission = services.resources.reserve({ streams: 1, bytes: outputBytes });
      try {
        yield* provide(admission);
      } finally {
        if (admission.kind === "reserve") admission.reservation.release();
      }
    });
    if (credit.kind === "refuse") {
      return refuse(new ResourceAdmissionError(`TCP output admission refused: ${credit.reason}`, credit.reason));
    }
    const receiver = new AbortController();
    let connectedSocket: Socket | undefined;
    // Consumer setup owns RX admission before connect; its byte source remains lazy until the returned task runs.
    const incoming = read && (yield* read.open((signal) => {
      if (!connectedSocket) throw new Error("TCP receive source acquired before connection");
      return socketBytes(connectedSocket, { signal, maxChunkBytes: read.maxChunkBytes });
    }, receiver.signal));
    return yield* abortable(async (upstream, scope) => {
      const controller = new AbortController(), signal = AbortSignal.any([upstream, controller.signal]);
      const socket = createConnection({ host: parsed.hostname, port, allowHalfOpen: !!read });
      if (read) socket.pause();
      // Transmit-only completion still drains ignored peer bytes so genuine EOF/close can arrive.
      else socket.resume();
      connectedSocket = socket;
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      const fail = (error: unknown) => controller.abort(error);
      socket.on("error", fail);
      const abort = () => socket.destroy();
      signal.addEventListener("abort", abort, { once: true });
      let timer: RuntimeTimer, timerActive = false;
      socket.once("close", () => {
        if (!socket.writableFinished) fail(new Error("TCP closed before output completed"));
      });
      let pendingWrite: Promise<void> | undefined;
      let receiveTask: Task<void> | undefined, receiveEOF = false;
      let closingReceive: Promise<void> | undefined, receiveCleanupFailure: unknown;
      const stopReceive = () => {
        receiver.abort(signal.reason);
        closingReceive ??= receiveTask?.halt().then(() => {}, (error) => {
          receiveCleanupFailure = error;
        });
      };
      let failure: unknown, bytes = 0, finished = false;
      try {
        timer = services.clock.setTimeout(() => fail(new Error("TCP connect deadline exceeded")), connectTimeout);
        timerActive = true;
        await interrupted(
          new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("close", () => reject(new Error("TCP closed before output completed")));
          }),
          signal,
        );
        services.clock.clearTimeout(timer);
        timerActive = false;
        if (incoming) {
          receiveTask = scope.run(function*() {
            try {
              yield* incoming;
              receiveEOF = true;
            } catch (error) {
              fail(error);
            }
          });
        }
        bytes = await writeBorrowedSource(socket, factory, signal, services, cap, {
          fail,
          failedCleanup: stopReceive,
          eof() {
            timer = services.clock.setTimeout(() => fail(new Error("TCP drain deadline exceeded")), drainTimeout);
            timerActive = true;
          },
        });
        pendingWrite = new Promise<void>((resolve, reject) =>
          socket.end((error?: Error) => error ? reject(error) : resolve())
        );
        await interrupted(pendingWrite, signal);
        pendingWrite = undefined;
        finished = true;
        if (receiveTask) await interrupted(Promise.resolve(receiveTask), signal);
        // Preserve finite sender policy: peer EOF/close completes the connection; deadline bounds waiting.
        await interrupted(closed, signal);
      } catch (error) {
        failure = error;
      } finally {
        controller.abort();
        receiver.abort(signal.reason);
        socket.destroy();
        // Start both directional cleanups before awaiting either one; slow source return cannot delay RX abort.
        stopReceive();
        await closingReceive;
        if (receiveCleanupFailure !== undefined) {
          failure = failure === undefined
            ? receiveCleanupFailure
            : new AggregateError([failure, receiveCleanupFailure], "TCP reply cleanup failed");
        }
        await pendingWrite?.catch(() => undefined);
        await closed;
        signal.removeEventListener("abort", abort);
        socket.removeListener("error", fail);
        if (timerActive) services.clock.clearTimeout(timer);
      }
      if (failure !== undefined) throw failure;
      if (!finished) throw new Error("TCP closed before output completed");
      if (read && !receiveEOF) throw new Error("TCP receive did not reach EOF");
      return { kind: "transmitted", bytes };
    }, options.signal);
  });
}
