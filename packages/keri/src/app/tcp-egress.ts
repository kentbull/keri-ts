/** One owned TCP writer shared by finite values and pull-driven sources. */
import {
  type CesrFrame,
  framePayload,
  ResourceAdmissionError,
  type ResourceDecision,
  ResourceLimitError,
} from "cesr-ts";
import { createConnection, type Socket } from "node:net";
import { call, each, type Operation, resource, type Task } from "npm:effection@^3.6.0";
import type { KeriDispatchEnvelope } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { abortable } from "./abortable.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { chunkBytes } from "./byte-source.ts";
import { cesrOutputMetadataBytes } from "./cesr-output.ts";
import type { DispatchDecision } from "./parsering.ts";
import { defaultRuntimeServices, type RuntimeServices, type RuntimeTimer } from "./runtime-services.ts";
import { socketBytes } from "./socket-source.ts";

// Fixed JS read/cursor bounds; handle allowance remains logical policy, not a native pool/kernel ceiling.
const RX_CHUNK = 65536, RX_BUFFER = 8 * 1024 ** 2, RX_HANDLE = 2 * 1024 ** 2;

/** Output limits and cancellation shared by all TCP input forms. */
export interface TcpSendOptions {
  /** Default mode does not parse replies; explicit conversation options select that lifetime. */
  replies?: never;
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
}

/** Producer observes abort, yields immutable bounded backing, and joins cleanup on return. */
export type TcpSourceFactory = (signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;

/** This describes local flushed output and joined close, never authenticated remote acceptance. */
export interface TcpTransmission {
  kind: "transmitted";
  bytes: number;
}

/** Explicit same-socket intake; runtime, callback envelopes and source owners remain borrowed. */
export interface TcpConversationOptions extends Omit<TcpSendOptions, "replies"> {
  replies: {
    runtime: AgentRuntime;
    /** Match upstream TCP reply parsing with local=true by default. */
    local?: boolean;
    /** Guarded, non-retaining consumption; never reenter Reactor or implicitly deliver cues here. */
    consume?: (envelope?: KeriDispatchEnvelope, decision?: DispatchDecision) => Operation<void>;
  };
}

/** Both directions drained locally; dispatch attempts do not establish verified replies or remote acceptance. */
export interface TcpConversation {
  kind: "conversationDrained";
  transmission: TcpTransmission;
  receive: { kind: "eof"; processedFrames: number };
}

type TcpOptions = TcpSendOptions | TcpConversationOptions;
type TcpResult = TcpTransmission | TcpConversation;
/** Joined connection outcome; only capacity refusals created by this send become values. */
type TcpAttempt = TcpResult | { kind: "refuse"; error: ResourceAdmissionError };

/** Send one already resident value; its owner remains borrowed until joined completion. */
export function sendCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpConversationOptions,
): Operation<TcpConversation>;
/** Preserve transmit-only completion unless a reply policy is supplied. */
export function sendCesrTcp(url: string, bytes: Uint8Array, options?: TcpSendOptions): Operation<TcpTransmission>;
/** Adapt finite values to the shared connection owner. */
export function sendCesrTcp(url: string, bytes: Uint8Array, options: TcpOptions = {}): Operation<TcpResult> {
  return completedTcp(attemptSendCesrTcp(url, bytes, options));
}

/** Finite delivery attempt through the same connection owner, including joined reply/source cleanup. */
export function attemptSendCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpOptions = {},
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
  options: TcpConversationOptions,
): Operation<TcpConversation>;
/** Preserve transmit-only streaming unless a reply policy is supplied. */
export function streamCesrTcp(
  url: string,
  source: TcpSourceFactory,
  options?: TcpSendOptions,
): Operation<TcpTransmission>;
/** Adapt source input to the shared connection owner. */
export function streamCesrTcp(
  url: string,
  source: TcpSourceFactory,
  options: TcpOptions = {},
): Operation<TcpResult> {
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
  options: TcpConversationOptions,
): Operation<TcpConversation>;
/** Preserve transmit-only frame serialization unless a reply policy is supplied. */
export function sendCesrTcpFrame(url: string, frame: CesrFrame, options?: TcpSendOptions): Operation<TcpTransmission>;
/** Adapt borrowed frame serialization to the shared connection owner. */
export function sendCesrTcpFrame(
  url: string,
  frame: CesrFrame,
  options: TcpOptions = {},
): Operation<TcpResult> {
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

/** Keep public streaming/frame senders strict while sharing the attempt's lifetime engine. */
function writeTcp(
  url: string,
  factory: TcpSourceFactory,
  options: TcpOptions,
  retainedBytes: number,
): Operation<TcpResult> {
  return completedTcp(attemptWriteTcp(url, factory, options, retainedBytes));
}

/** Unwrap only after the attempt has joined cleanup; foreign failures never become refusal values. */
function* completedTcp(attempt: Operation<TcpAttempt>): Operation<TcpResult> {
  const result = yield* attempt;
  if (result.kind === "refuse") throw result.error;
  return result;
}

/** Shared connection/source/write owner; no direction, queue or parser is duplicated by adapters. */
function attemptWriteTcp(
  url: string,
  factory: TcpSourceFactory,
  options: TcpOptions,
  retainedBytes: number,
): Operation<TcpAttempt> {
  return call(function*() {
    let receiveRefusal: ResourceAdmissionError | undefined;
    try {
      return yield* call(function*(): Operation<TcpAttempt> {
        const parsed = new URL(url), port = Number(parsed.port);
        if (parsed.protocol !== "tcp:" || !Number.isInteger(port) || port < 1 || port > 65535) {
          throw new ValidationError(`TCP output requires tcp: with a valid port: ${url}`);
        }
        const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
        const connectTimeout = positive(options.connectTimeoutMs ?? 30000, "connectTimeoutMs");
        const drainTimeout = positive(options.drainTimeoutMs ?? 30000, "drainTimeoutMs");
        const replies = options.replies === undefined ? undefined : { ...options.replies };
        const services = replies?.runtime.services ?? options.services ?? defaultRuntimeServices;
        if (replies && options.services && options.services !== services) {
          throw new RangeError("TCP replies require the runtime's exact services");
        }
        const outputBytes = retainedBytes + 2 * cap + (replies ? RX_HANDLE : 0);
        if (!Number.isSafeInteger(outputBytes)) throw new RangeError("TCP output charge exceeds safe integer range");
        if (
          replies && (services.resources.limits.streams < 2
            || services.resources.limits.bytes < outputBytes + RX_CHUNK + RX_BUFFER)
        ) {
          const error = new ResourceAdmissionError("TCP conversation exceeds configured capacity", "limit");
          return { kind: "refuse", error };
        }
        const admission = yield* resource<ResourceDecision>(function*(provide) {
          const credit = services.resources.reserve({ streams: 1, bytes: outputBytes });
          try {
            yield* provide(credit);
          } finally {
            if (credit.kind === "reserve") credit.reservation.release();
          }
        });
        if (admission.kind === "refuse") {
          const error = new ResourceAdmissionError(
            `TCP output admission refused: ${admission.reason}`,
            admission.reason,
          );
          return { kind: "refuse", error };
        }
        const receiver = new AbortController();
        let connectedSocket: Socket | undefined;
        // Acquiring this channel reserves RX stream/cursor credit but does not invoke its source factory.
        const channel = replies && (yield* replies.runtime.reactor.frames((signal) => {
          if (!connectedSocket) throw new Error("TCP receive source acquired before connection");
          return socketBytes(connectedSocket, { signal, maxChunkBytes: RX_CHUNK });
        }, {
          signal: receiver.signal,
          maxChunkBytes: RX_CHUNK,
          maxBufferedBytes: RX_BUFFER,
          classifyWireErrors: true,
          onAdmissionRefusal(error) {
            receiveRefusal = error;
          },
        }));
        return yield* abortable(async (upstream, scope) => {
          const controller = new AbortController(), signal = AbortSignal.any([upstream, controller.signal]);
          const socket = createConnection({ host: parsed.hostname, port, allowHalfOpen: !!replies });
          if (replies) socket.pause();
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
          let receiveTask: Task<void> | undefined, receiveEOF = false, processedFrames = 0;
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
            if (channel && replies) {
              receiveTask = scope.run(function*() {
                try {
                  yield* call(function*() {
                    for (const frame of yield* each(channel.frames)) {
                      yield* replies.runtime.reactor.settle(frame, {
                        local: replies.local ?? true,
                        escrows: true,
                      }, replies.consume);
                      processedFrames++;
                      yield* each.next();
                    }
                  });
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
          const transmission: TcpTransmission = { kind: "transmitted", bytes };
          if (!replies) return transmission;
          if (!receiveEOF) throw new Error("TCP receive did not reach EOF");
          return { kind: "conversationDrained", transmission, receive: { kind: "eof", processedFrames } };
        }, options.signal);
      });
    } catch (error) {
      // The Reactor parser still exposes exceptional admission. Keep that bridge at its owning boundary.
      if (!receiveRefusal || error !== receiveRefusal) throw error;
      return { kind: "refuse", error: receiveRefusal };
    }
  });
}
