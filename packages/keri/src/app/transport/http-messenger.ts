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
 *
 * Corresponds to the ordinary POST role of KERIpy HTTPMessenger. Complete CESR
 * frames become separate POSTs: original signed body in the request body, text
 * attachments in CESR-ATTACHMENT. Only the recognized pre-intake media refusal
 * permits a second attempt with legacy media metadata. Successful response bytes
 * are drained and discarded; protocol receiving belongs to independent intake.
 */
export class HTTPMessenger {
  /** Bind one endpoint and request metadata; construction performs no I/O. */
  constructor(
    readonly url: string,
    private readonly http: HttpClient,
    private readonly options: HTTPMessengerOptions = {},
  ) {}

  /**
   * Send resident signed bytes through the same parser/request path as sendSource.
   * Keep the input unchanged until completion. A complete result proves transport
   * completion, not remote verification, storage, approval or a processed reply.
   */
  send(msg: Uint8Array, options: Pick<EgressOptions, "signal"> = {}): Operation<CesrPostResult> {
    return this.sendSource((signal) => chunkBytes(msg, { signal }), options);
  }

  /**
   * Iterate ordinary messages into POSTs; this is not whole-stream PUT delivery.
   * A later malformed message cannot prevent an earlier valid POST. Parser,
   * transport, source and cleanup failures propagate; HTTP refusal is typed data.
   */
  sendSource(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: Pick<EgressOptions, "signal"> = {},
  ): Operation<CesrPostResult> {
    return attemptPostCesr(this.url, source, this.http, { ...this.options, ...options });
  }
}
