/** One finite, opaque HTTP PUT following KERIpy HTTPStreamMessenger. */
import type { Operation } from "effection";
import { buildCesrStreamRequest, CESR_ATTACHMENT_HEADER, CESR_DESTINATION_HEADER } from "./cesr-http.ts";
import type { HttpClient, HttpResponse } from "./http-client.ts";
import type { HTTPMessengerOptions } from "./http-messenger.ts";

/**
 * Bind one complete prepared payload to KERIpy-style HTTPStreamMessenger PUT.
 * This component does not inspect CESR frames or own a producer queue. The
 * producer prepares introductions, genus transitions and any sealing before
 * construction; send owns only the actual request and joined response cleanup.
 */
export class HTTPStreamMessenger {
  /** Construction borrows a finite payload; its producer must not mutate it during delivery. */
  constructor(
    readonly url: string,
    private readonly http: HttpClient,
    private readonly payload: Uint8Array,
    private readonly options: HTTPMessengerOptions = {},
  ) {}

  /**
   * Send exactly one PUT without parsing, re-encoding or fallback to POST.
   * Return ordinary owned response bytes after request cleanup; HTTP success
   * alone does not establish protocol acceptance. Cancellation/failures propagate.
   * Non-success status is returned to the caller as HttpResponse for interpretation.
   * The complete payload is the body with explicit length; CESR-ATTACHMENT is
   * removed because this is not ordinary detached-attachment POST framing.
   */
  send(options: { signal?: AbortSignal } = {}): Operation<HttpResponse> {
    const prepared = buildCesrStreamRequest(this.payload, this.options);
    const headers = new Headers(this.options.headers);
    headers.delete(CESR_DESTINATION_HEADER);
    for (const [key, value] of Object.entries(prepared.headers)) headers.set(key, value);
    headers.delete(CESR_ATTACHMENT_HEADER);
    headers.set("Content-Length", String(this.payload.byteLength));
    return this.http.request(this.url, {
      method: "PUT",
      headers,
      body: prepared.body,
      redirect: "manual",
      signal: options.signal,
    });
  }
}
