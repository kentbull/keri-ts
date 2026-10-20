/** Finite raw TCP stream delivery using the existing socket owner. */
import type { Operation } from "effection";
import { chunkBytes } from "./byte-source.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { streamCesrTcp, type TcpSendOptions } from "./tcp-egress.ts";

/** Bind one payload without a second queue, socket implementation or receive loop. */
export class TCPStreamMessenger {
  /** Construction borrows prepared bytes and opens no connection. */
  constructor(
    readonly url: string,
    private readonly clock: RuntimeClock,
    private readonly payload: Uint8Array,
  ) {}

  /** Send every admitted byte and join local output/cleanup without awaiting remote EOF. */
  send(options: TcpSendOptions = {}): Operation<void> {
    return streamCesrTcp(
      this.url,
      signal => chunkBytes(this.payload, { signal, maxChunkBytes: options.maxChunkBytes }),
      this.clock,
      options,
    );
  }
}
