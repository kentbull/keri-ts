/** TCP attempt ownership: source transmission, optional signed replies and joined cleanup. */
import { parse } from "cesr-ts";
import { call, ensure, on, type Operation, race, spawn } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import { rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { socketBytes } from "./socket-source.ts";
import {
  openTcpConnection,
  sendCesrTcpSocket,
  streamCesrTcp,
  type TcpSendOptions,
  type TcpSourceFactory,
  type TcpTransmission,
} from "./tcp-egress.ts";

/** Per-attempt choices; collaborators are required constructor dependencies. */
export interface TCPMessengerOptions extends Omit<TcpSendOptions, "clock"> {
  /** Process same-socket replies through receive EOF; omitted completes local TX only. */
  replies?: boolean;
  /** Locally received witness/controller semantics for parsed protocol frames. */
  local?: boolean;
}

/** Local output plus processed receive EOF; neither proves remote protocol acceptance. */
export interface TCPConversation {
  /** Both directions reached their explicitly requested completion boundary. */
  kind: "conversationDrained";
  /** Actual locally flushed transmission, independently of receipt verification. */
  transmission: TcpTransmission;
  /** Actual receive exhaustion and count of frames handed to protocol processing. */
  receive: { kind: "eof"; processedFrames: number };
}

/** Completion depends on whether the caller requested receive processing. */
export type TCPMessengerResult = TcpTransmission | TCPConversation;

/**
 * Own one TCP delivery attempt and its parser/Kevery, following KERIpy TCPMessenger.
 *
 * Poster or QueryCoordinator owns queued source work and retry. This messenger runs
 * directly in that owner's scope, keeps no message queue or sent history, and joins
 * TX, optional RX, parser/source cleanup and connection close before returning.
 * Finite bytes and pull sources share one implementation; no stream subclass is needed.
 */
export class TCPMessenger {
  /** Input-owned Kevery (kvy); null when no protocol receive capability was supplied. */
  readonly kvy: Kevery | null;

  /**
   * Bind the actual receiver and clock without opening a socket or acquiring stores.
   *
   * @param protocol Borrowed shared protocol owner, or null for transmit-only use. A supplied owner creates this messenger's Kevery.
   * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
   */
  constructor(
    /** Borrowed shared protocol owner; null explicitly permits transmit-only operation. */
    private readonly protocol: ProtocolProcessor | null,
    /** Borrowed clock controls actual connection/drain deadlines. */
    private readonly clock: RuntimeClock,
  ) {
    this.kvy = protocol?.makeKevery() ?? null;
  }

  /**
   * Adapt resident signed wire to the same pull-source lifetime as streamed output.
   *
   * @param url TCP endpoint with an explicit port in the range 1–65535.
   * @param msg Resident signed CESR bytes; copied into chunks as transmitted.
   * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines. Set replies to process same-socket input through EOF; local controls KEL intake policy.
   * @returns Local transmission for send-only use, or transmission plus processed receive EOF for duplex.
   * @throws Reply mode requires a protocol processor. Source/parser, dispatch, transport and cleanup failures propagate.
   */
  send(url: string, msg: Uint8Array, options: TCPMessengerOptions = {}): Operation<TCPMessengerResult> {
    return this.stream(url, (signal) => chunkBytes(msg, { signal, maxChunkBytes: options.maxChunkBytes }), options);
  }

  /**
   * Send one source; duplex processing is explicit and never changes the local-only success contract.
   *
   * @param url TCP endpoint with an explicit port in the range 1–65535.
   * @param source Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
   * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines. Set replies to process same-socket input through EOF; local controls KEL intake policy.
   * @returns Local transmission for send-only use, or transmission plus processed receive EOF for duplex.
   * @throws Reply mode requires a protocol processor. Source/parser, dispatch, transport and cleanup failures propagate.
   */
  stream(url: string, source: TcpSourceFactory, options: TCPMessengerOptions = {}): Operation<TCPMessengerResult> {
    if (options.replies) return this.converse(url, source, options);
    return streamCesrTcp(url, source, this.clock, { ...options });
  }

  /**
   * Run concurrent native RX/TX children; cancel and join them before releasing the borrowed socket.
   *
   * @param url TCP endpoint with an explicit port in the range 1–65535.
   * @param source Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
   * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines. Set replies to process same-socket input through EOF; local controls KEL intake policy.
   * @returns Local transmission for send-only use, or transmission plus processed receive EOF for duplex.
   * @throws Reply mode requires a protocol processor. Source/parser, dispatch, transport and cleanup failures propagate.
   */
  private converse(url: string, source: TcpSourceFactory, options: TCPMessengerOptions): Operation<TCPConversation> {
    const protocol = this.protocol, kvy = this.kvy, clock = this.clock;
    if (!protocol || !kvy) throw new Error("TCP reply delivery requires a protocol processor");
    return call(function*() {
      const { replies: _replies, local = true, ...send } = options;
      const connection = yield* openTcpConnection(url, clock, send);
      // Register RX before TX so a peer can reply while the outbound source is still open.
      let processedFrames = 0;
      const receive = yield* spawn(function*() {
        yield* race([
          call(function*() {
            const controller = new AbortController();
            const signal = AbortSignal.any([controller.signal, connection.signal]);
            const frames = parse(socketBytes(connection.socket, { signal }));
            let pending: ReturnType<typeof frames.next> | undefined;
            // Join the outstanding read before returning the parser/source iterator.
            yield* ensure(function*() {
              try {
                if (pending) {
                  try {
                    yield* call(() => pending!);
                  } catch (error) {
                    rethrowCleanupFailure(error, signal);
                  }
                }
              } finally {
                yield* call(() => frames.return());
              }
            });
            try {
              while (true) {
                signal.throwIfAborted();
                pending = frames.next();
                let next: Awaited<typeof pending>;
                try {
                  next = yield* call(() => pending!);
                } catch (error) {
                  pending = undefined;
                  throw error;
                }
                pending = undefined;
                signal.throwIfAborted();
                if (next.done) return;
                yield* protocol.dispatch(
                  next.value,
                  { local, escrows: true },
                  kvy,
                );
                processedFrames++;
              }
            } catch (error) {
              // Stop TX before parser/source cleanup can suspend on the failed direction.
              connection.close(error);
            } finally {
              controller.abort();
            }
          }),
          call(function*(): Operation<never> {
            const abort = yield* on(connection.signal, "abort");
            connection.signal.throwIfAborted();
            yield* abort.next();
            throw connection.signal.reason;
          }),
        ]);
      });
      const transmission = yield* sendCesrTcpSocket(connection, source, clock, send);
      // Duplex completion requires processed receive EOF; transmit-only never enters this path.
      yield* receive;
      connection.signal.throwIfAborted();
      return { kind: "conversationDrained", transmission, receive: { kind: "eof", processedFrames } };
    });
  }
}
