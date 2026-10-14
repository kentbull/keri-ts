/** One owned TCP writer shared by finite values and pull-driven sources. */
import { ResourceAdmissionError, ResourceLimitError } from "cesr-ts";
import { createConnection } from "node:net";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { defaultRuntimeServices, type RuntimeServices, type RuntimeTimer } from "./runtime-services.ts";

/** Output limits and cancellation shared by all TCP input forms. */
export interface TcpSendOptions {
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

/** Send one already resident value; its owner remains borrowed until joined completion. */
export function sendCesrTcp(url: string, bytes: Uint8Array, options: TcpSendOptions = {}): Operation<TcpTransmission> {
  const cap = Math.min(positive(options.maxChunkBytes ?? 65536, "maxChunkBytes"), Math.max(1, bytes.length));
  return writeTcp(url, (signal) => chunkBytes(bytes, { signal, maxChunkBytes: cap }), {
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

/** Shared connection/source/write owner; no direction, queue or parser is duplicated by adapters. */
function writeTcp(
  url: string,
  factory: TcpSourceFactory,
  options: TcpSendOptions,
  retainedBytes: number,
): Operation<TcpTransmission> {
  return call(function*() {
    const parsed = new URL(url), port = Number(parsed.port);
    if (parsed.protocol !== "tcp:" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`TCP output requires tcp: with a valid port: ${url}`);
    }
    const cap = positive(options.maxChunkBytes ?? 65536, "maxChunkBytes");
    const connectTimeout = positive(options.connectTimeoutMs ?? 30000, "connectTimeoutMs");
    const drainTimeout = positive(options.drainTimeoutMs ?? 30000, "drainTimeoutMs");
    const services = options.services ?? defaultRuntimeServices;
    yield* resource<void>(function*(provide) {
      const admission = services.resources.reserve({ streams: 1, bytes: retainedBytes + 2 * cap });
      if (admission.kind === "refuse") {
        throw new ResourceAdmissionError(`TCP output admission refused: ${admission.reason}`, admission.reason);
      }
      try {
        yield* provide();
      } finally {
        admission.reservation.release();
      }
    });
    return yield* abortable(async (upstream) => {
      const controller = new AbortController(), signal = AbortSignal.any([upstream, controller.signal]);
      const socket = createConnection({ host: parsed.hostname, port });
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      const fail = (error: unknown) => controller.abort(error);
      socket.on("error", fail);
      const abort = () => socket.destroy();
      signal.addEventListener("abort", abort, { once: true });
      let timer: RuntimeTimer, timerActive = false;
      socket.once("close", () => {
        if (!socket.writableFinished) fail(new Error("TCP closed before output completed"));
      });
      let iterator: AsyncIterator<Uint8Array> | undefined;
      let pendingRead: Promise<IteratorResult<Uint8Array>> | undefined;
      let pendingWrite: Promise<void> | undefined;
      let failure: unknown, bytes = 0, work = 0, finished = false;
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
                timerActive = true;
              }),
              signal,
            );
            services.clock.clearTimeout(timer);
            timerActive = false;
          }
          pendingRead = Promise.resolve(iterator.next());
          const part = await interrupted(pendingRead, signal);
          pendingRead = undefined;
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) throw new TypeError("TCP source must yield binary chunks");
          if (part.value.buffer.byteLength > cap) {
            throw new ResourceLimitError(`TCP chunk backing exceeds ${cap} bytes`);
          }
          if (!part.value.length) continue;
          const drained = Promise.withResolvers<void>();
          const drain = () => drained.resolve();
          socket.once("drain", drain);
          try {
            let writable = false;
            pendingWrite = new Promise<void>((resolve, reject) => {
              writable = socket.write(part.value, (error) => error ? reject(error) : resolve());
            });
            await interrupted(pendingWrite, signal);
            pendingWrite = undefined;
            if (!writable) await interrupted(drained.promise, signal);
          } finally {
            socket.removeListener("drain", drain);
          }
          bytes += part.value.length;
        }
        timer = services.clock.setTimeout(() => fail(new Error("TCP drain deadline exceeded")), drainTimeout);
        timerActive = true;
        pendingWrite = new Promise<void>((resolve, reject) =>
          socket.end((error?: Error) => error ? reject(error) : resolve())
        );
        await interrupted(pendingWrite, signal);
        pendingWrite = undefined;
        finished = true;
        // Preserve finite sender policy: peer EOF/close completes the connection; deadline bounds waiting.
        await interrupted(closed, signal);
      } catch (error) {
        failure = error;
      } finally {
        controller.abort();
        socket.destroy();
        try {
          await pendingRead?.catch(() => undefined);
          await iterator?.return?.();
        } catch (error) {
          failure = failure === undefined ? error : new AggregateError([failure, error], "TCP source cleanup failed");
        } finally {
          await pendingWrite?.catch(() => undefined);
          await closed;
          signal.removeEventListener("abort", abort);
          socket.removeListener("error", fail);
          if (timerActive) services.clock.clearTimeout(timer);
        }
      }
      if (failure !== undefined) throw failure;
      if (!finished) throw new Error("TCP closed before output completed");
      return { kind: "transmitted", bytes };
    }, options.signal);
  });
}
