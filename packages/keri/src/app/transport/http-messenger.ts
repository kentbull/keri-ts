/** Ordinary signed-message HTTP delivery, independent of query receive processing. */
import type { Operation } from "effection";
import { chunkBytes } from "./byte-source.ts";
import { attemptPostCesr, type CesrPostResult, type EgressOptions } from "./cesr-egress.ts";
import type { HttpClient } from "./http-client.ts";

/** Fixed request metadata; transport construction does not select a framing preference. */
export type HTTPMessengerOptions = Pick<EgressOptions, "destination" | "headers">;

/**
 * Send ordinary signed messages as ordered HTTP requests and finish response cleanup.
 * Producers own preparation and Poster owns queued work. This component needs no
 * Habery, protocol processor, parser state, timer or response history.
 *
 * Corresponds to KERIpy HTTPMessenger. Each complete CESR frame is one request,
 * shaped by its body: a JSON/CBOR/MGPK frame is a POST with the original signed
 * body in the request body and text attachments in CESR-ATTACHMENT, where only
 * the recognized pre-intake media refusal permits a second attempt with legacy
 * media metadata; a native CESR frame (counter-prefixed body) is one whole PUT of
 * the serialized frame with Content-Length and CESR-DESTINATION, matching KERIpy
 * since PR 1751 and without detached headers or media fallback. Successful response
 * bytes are drained and discarded; protocol receiving belongs to independent intake.
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
   * Iterate messages into one request each; this is not whole-stream PUT delivery.
   * A multi-message native stream becomes successive per-frame PUTs, not KERIpy's
   * single bulk PUT. A later malformed message cannot prevent an earlier valid
   * request. Parser, transport, source and cleanup failures propagate; HTTP
   * refusal is typed data.
   */
  sendSource(
    source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
    options: Pick<EgressOptions, "signal"> = {},
  ): Operation<CesrPostResult> {
    return attemptPostCesr(this.url, source, this.http, { ...this.options, ...options });
  }
}
