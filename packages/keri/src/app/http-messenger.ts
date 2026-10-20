/** Ordinary signed-message POST delivery, independent of query receive processing. */
import type { Operation } from "effection";
import { chunkBytes } from "./byte-source.ts";
import { attemptPostCesr, type CesrPostResult, type EgressOptions } from "./cesr-egress.ts";
import type { HttpClient } from "./http-client.ts";

/** Fixed request metadata; transport construction does not select a framing preference. */
export type HTTPMessengerOptions = Pick<EgressOptions, "destination" | "headers">;

/**
 * Send ordinary signed messages as ordered HTTP POSTs and finish response cleanup.
 * Producers own preparation and Poster owns queued work. This component needs no
 * Habery, protocol processor, parser state, timer or response history.
 */
export class HTTPMessenger {
  /** Bind one endpoint and request metadata; construction performs no I/O. */
  constructor(
    readonly url: string,
    private readonly http: HttpClient,
    private readonly options: HTTPMessengerOptions = {},
  ) {}

  /** Send resident signed bytes; successful delivery includes response EOF and cleanup. */
  send(msg: Uint8Array, options: Pick<EgressOptions, "bodyMode" | "signal"> = {}): Operation<CesrPostResult> {
    return this.sendSource((signal) => chunkBytes(msg, { signal }), options);
  }

  /**
   * Iterate ordinary messages into POSTs; this is not whole-stream PUT delivery.
   * A later malformed message cannot prevent an earlier valid POST. Parser,
   * transport, source and cleanup failures propagate; HTTP refusal is typed data.
   */
  sendSource(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: Pick<EgressOptions, "bodyMode" | "signal"> = {},
  ): Operation<CesrPostResult> {
    return attemptPostCesr(this.url, source, this.http, { ...this.options, ...options });
  }
}
