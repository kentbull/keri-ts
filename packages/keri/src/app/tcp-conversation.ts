/** Application composition of a byte-level TCP connection with CESR parsing and guarded dispatch. */
import { ResourceAdmissionError } from "cesr-ts";
import { call, each, type Operation, resource } from "npm:effection@^3.6.0";
import type { KeriDispatchEnvelope } from "../core/dispatch.ts";
import type { FrameIntake } from "./frame-intake.ts";
import type { DispatchDecision } from "./parsering.ts";
import type { Reactor } from "./reactor.ts";
import type { RuntimeServices } from "./runtime-services.ts";
import {
  attemptSendCesrTcp,
  streamCesrTcp,
  type TcpRead,
  type TcpSendOptions,
  type TcpSourceFactory,
  type TcpTransmission,
} from "./tcp-egress.ts";

/** Components borrowed by this application flow; the transport receives only a bounded byte consumer. */
export interface TcpReplyReceiver {
  services: RuntimeServices;
  intake: FrameIntake;
  reactor: Reactor;
}

/** Same-socket protocol processing selected explicitly by the application owner. */
export interface TcpConversationOptions extends Omit<TcpSendOptions, "read"> {
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

/** Application-owned attempt includes parser admission; transport remains byte-only. */
export type TcpConversationAttempt = TcpConversation | { kind: "refuse"; error: ResourceAdmissionError };

/** Return only invocation-owned refusals after both transport and parser cleanup join. */
export function attemptConverseCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpConversationOptions,
): Operation<TcpConversationAttempt> {
  return conversation(url, bytes, options);
}

/** Strict callers unwrap a completed application attempt. */
function* completedConversation(attempt: Operation<TcpConversationAttempt>): Operation<TcpConversation> {
  const result = yield* attempt;
  if (result.kind === "refuse") throw result.error;
  return result;
}

/** Send finite wire while this application flow owns parser/dispatch and the transport owns the socket. */
export function converseCesrTcp(
  url: string,
  bytes: Uint8Array,
  options: TcpConversationOptions,
): Operation<TcpConversation> {
  return completedConversation(conversation(url, bytes, options));
}

/** Pull output and process same-socket frames concurrently without adding a queue or prefetch. */
export function streamCesrTcpConversation(
  url: string,
  source: TcpSourceFactory,
  options: TcpConversationOptions,
): Operation<TcpConversation> {
  return completedConversation(conversation(url, source, options));
}

/** Both actual output forms share exactly one application-owned read scope. */
function conversation(
  url: string,
  input: Uint8Array | TcpSourceFactory,
  options: TcpConversationOptions,
): Operation<TcpConversationAttempt> {
  return call(function*() {
    let parserRefusal: ResourceAdmissionError | undefined;
    try {
      return yield* call(function*(): Operation<TcpConversationAttempt> {
        const { replies: receiver, ...output } = options;
        const replies = { ...receiver };
        const services = replies.services;
        if (output.services && output.services !== services) {
          throw new RangeError("TCP replies require the receiver's exact services");
        }
        let processedFrames = 0;
        const read: TcpRead = {
          maxChunkBytes: 65536,
          maxBufferedBytes: 8 * 1024 ** 2,
          open(source, signal) {
            return resource<Operation<void>>(function*(provide) {
              const channel = yield* replies.intake.frames(source, {
                signal,
                maxChunkBytes: read.maxChunkBytes,
                maxBufferedBytes: read.maxBufferedBytes,
                classifyWireErrors: true,
                onAdmissionRefusal(error) {
                  parserRefusal = error;
                },
              });
              yield* provide(call(function*() {
                for (const frame of yield* each(channel.frames)) {
                  yield* replies.reactor.settle(
                    frame,
                    { local: replies.local ?? true, escrows: true },
                    replies.consume,
                  );
                  processedFrames++;
                  yield* each.next();
                }
              }));
            });
          },
        };
        const transport = { ...output, services, read };
        const transmission = yield* (input instanceof Uint8Array
          ? attemptSendCesrTcp(url, input, transport)
          : streamCesrTcp(url, input, transport));
        if (transmission.kind === "refuse") return transmission;
        return { kind: "conversationDrained", transmission, receive: { kind: "eof", processedFrames } };
      });
    } catch (error) {
      if (!parserRefusal || error !== parserRefusal) throw error;
      return { kind: "refuse", error: parserRefusal };
    }
  });
}
