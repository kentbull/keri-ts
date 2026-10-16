/** Application composition of actual TCP receive and transmit lifetimes. */
import { parse } from "cesr-ts";
import { call, ensure, on, type Operation, race, spawn } from "npm:effection@^3.6.0";
import type { KeriDispatchEnvelope } from "../core/dispatch.ts";
import { rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import type { DispatchDecision } from "./parsering.ts";
import type { Reactor } from "./reactor.ts";
import { socketBytes } from "./socket-source.ts";
import {
  openTcpConnection,
  sendCesrTcpSocket,
  type TcpSendOptions,
  type TcpSourceFactory,
  type TcpTransmission,
} from "./tcp-egress.ts";

/** Protocol processor borrowed only by this application; transport receives no consumer. */
export interface TcpReplyReceiver {
  reactor: Reactor;
}

/** Same-socket protocol processing selected explicitly by the application owner. */
export interface TcpConversationOptions extends TcpSendOptions {
  replies: TcpReplyReceiver & {
    local?: boolean;
    /** Borrow guarded envelopes only for this call; never reenter Reactor or implicitly drain cues. */
    consume?: (envelope?: KeriDispatchEnvelope, decision?: DispatchDecision) => Operation<void>;
  };
}

/** Local output and processed receive EOF; this does not prove authenticated replies or remote acceptance. */
export interface TcpConversation {
  kind: "conversationDrained";
  transmission: TcpTransmission;
  receive: { kind: "eof"; processedFrames: number };
}

/** Send finite wire while this application flow owns parser/dispatch and the transport owns the socket. */
export function converseCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpConversationOptions,
): Operation<TcpConversation> {
  return conversation(url, (signal) => chunkBytes(bytes, { signal, maxChunkBytes: options.maxChunkBytes }), options);
}

/** Pull output and process same-socket frames concurrently without adding a queue or prefetch. */
export function streamCesrTcpConversation(
  url: string,
  source: TcpSourceFactory,
  options: TcpConversationOptions,
): Operation<TcpConversation> {
  return conversation(url, source, options);
}

/** Compose native RX/TX siblings over a real socket; transport never starts protocol work. */
function conversation(
  url: string,
  source: TcpSourceFactory,
  options: TcpConversationOptions,
): Operation<TcpConversation> {
  return call(function*() {
    const { replies, ...output } = options;
    const connection = yield* openTcpConnection(url, output);
    let processedFrames = 0;
    const receive = yield* spawn(function*() {
      yield* race([
        call(function*() {
          const controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, connection.signal]);
          const frames = parse(socketBytes(connection.socket, { signal }));
          let pending: ReturnType<typeof frames.next> | undefined;
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
              yield* replies.reactor.settle(
                next.value,
                { local: replies.local ?? true, escrows: true },
                replies.consume,
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
    const transmission = yield* sendCesrTcpSocket(connection, source, output);
    yield* receive;
    connection.signal.throwIfAborted();
    return { kind: "conversationDrained", transmission, receive: { kind: "eof", processedFrames } };
  });
}
