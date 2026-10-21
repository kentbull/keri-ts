/** TCP attempt ownership: source transmission, optional signed replies and joined cleanup. */
import { parse } from "cesr-ts";
import { call, ensure, on, type Operation, race, spawn } from "npm:effection@^3.6.0";
import type { Kevery } from "../../core/kel/eventing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { rethrowCleanupFailure } from "../runtime/abortable.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { chunkBytes } from "./byte-source.ts";
import { socketBytes } from "./socket-source.ts";
import {
  openTcpConnection,
  sendCesrTcpSocket,
  streamCesrTcp,
  type TcpSendOptions,
  type TcpSourceFactory,
} from "./tcp-egress.ts";

/** Per-attempt choices; collaborators are required constructor dependencies. */
export interface TCPMessengerOptions extends TcpSendOptions {
  /** Process same-socket replies through receive EOF; omitted completes local TX only. */
  replies?: boolean;
  /** Locally received witness/controller semantics for parsed protocol frames. */
  local?: boolean;
}

/**
 * Own one TCP delivery attempt and its parser/Kevery, following KERIpy TCPMessenger.
 *
 * Poster or WitnessInquisitor owns queued source work and delivery policy. This messenger runs
 * directly in that owner's scope, keeps no message queue or sent history, and joins
 * TX, optional RX, parser/source cleanup and connection close before returning.
 * Finite bytes and pull sources share the same socket implementation.
 *
 * Transmit-only is the default. Reply mode starts RX before TX so the peer may
 * answer during upload, then waits for receive EOF and dispatch completion.
 * Those are socket/protocol-processing facts, not the calling workflow's
 * accepted-state predicate or an application acknowledgement from the peer.
 */
export class TCPMessenger {
  /** Input-owned Kevery (kvy); null when no protocol receive capability was supplied. */
  readonly kvy: Kevery | null;

  /**
   * Bind the actual receiver and clock without opening a socket or acquiring stores.
   *
   * @param url TCP endpoint bound to this messenger.
   * @param clock Borrowed clock for connection/drain deadlines and scheduler yields; durations are milliseconds.
   * @param protocol Optional borrowed receiver; omitted means transmit-only.
   */
  constructor(
    readonly url: string,
    private readonly clock: RuntimeClock,
    private readonly protocol: ProtocolProcessor | null = null,
  ) {
    this.kvy = protocol?.makeKevery() ?? null;
  }

  /**
   * Adapt resident signed wire to the same pull-source lifetime as streamed output.
   *
   * @param msg Resident signed CESR bytes; copied into chunks as transmitted.
   * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines. Set replies to process same-socket input through EOF; local controls KEL intake policy.
   * @returns Completion after local output; reply mode also joins receive EOF and protocol processing.
   * @throws Reply mode requires a protocol processor. Source/parser, dispatch, transport and cleanup failures propagate.
   */
  send(msg: Uint8Array, options: TCPMessengerOptions = {}): Operation<void> {
    return this.sendSource((signal) => chunkBytes(msg, { signal, maxChunkBytes: options.maxChunkBytes }), options);
  }

  /**
   * Send one source; duplex processing is explicit and never changes the local-only success contract.
   *
   * @param source Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
   * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines. Set replies to process same-socket input through EOF; local controls KEL intake policy.
   * @returns Completion after local output; reply mode also joins receive EOF and protocol processing.
   * @throws Reply mode requires a protocol processor. Source/parser, dispatch, transport and cleanup failures propagate.
   */
  sendSource(source: TcpSourceFactory, options: TCPMessengerOptions = {}): Operation<void> {
    if (options.replies) return this.receiptDo(source, options);
    return streamCesrTcp(this.url, source, this.clock, { ...options });
  }

  /**
   * Send while processing replies, corresponding to KERIpy TCPMessenger.receiptDo/msgDo.
   * Cancel and join concurrent RX/TX children before releasing the borrowed socket.
   *
   * @param source Creates a finite binary source with the owner's cancellation signal; must interrupt reads and finish cleanup when aborted.
   * @param options Chunk size, connection/drain deadlines and optional cancellation; defaults are 64 KiB and 30-second deadlines. Set replies to process same-socket input through EOF; local controls KEL intake policy.
   * @returns Completion after output, processed receive EOF and joined connection cleanup.
   * @throws Missing receive capability, source/parser, dispatch, transport and cleanup failures propagate.
   */
  private receiptDo(source: TcpSourceFactory, options: TCPMessengerOptions): Operation<void> {
    const protocol = this.protocol, kvy = this.kvy, clock = this.clock, url = this.url;
    if (!protocol || !kvy) throw new Error("TCP reply delivery requires a protocol processor");
    return call(function*() {
      const { replies: _replies, local = true, ...send } = options;
      const connection = yield* openTcpConnection(url, clock, send);
      // Register RX before TX so a peer can reply while the outbound source is still open.
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
      yield* sendCesrTcpSocket(connection, source, clock, send);
      // Duplex completion requires processed receive EOF; transmit-only never enters this path.
      yield* receive;
      connection.signal.throwIfAborted();
    });
  }
}
