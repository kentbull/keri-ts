/** Finite raw TCP stream delivery using the existing socket owner. */
import type { Operation } from "effection";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { chunkBytes } from "./byte-source.ts";
import { streamCesrTcp, type TcpSendOptions } from "./tcp-egress.ts";

/**
 * KERIpy-style TCPStreamMessenger over one already prepared opaque payload.
 * Borrow bytes until send finishes, with no CESR parsing, receive processor or
 * private queue. Reuse the ordinary socket owner for connection, local drain and
 * joined cancellation; producers retain preparation and any delivery policy.
 */
export class TCPStreamMessenger {
  /** Construction borrows prepared bytes and opens no connection. */
  constructor(
    readonly url: string,
    private readonly clock: RuntimeClock,
    private readonly payload: Uint8Array,
  ) {}

  /**
   * Send all bytes and join local drain/cleanup without awaiting remote EOF.
   * Completion does not prove the peer parsed, accepted or durably stored them.
   * Connection/drain deadlines use the borrowed clock; source, transport and
   * genuine cleanup failures propagate to this operation's caller.
   */
  send(options: TcpSendOptions = {}): Operation<void> {
    return streamCesrTcp(
      this.url,
      signal => chunkBytes(this.payload, { signal, maxChunkBytes: options.maxChunkBytes }),
      this.clock,
      options,
    );
  }
}
