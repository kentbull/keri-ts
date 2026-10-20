/** CESR framing and media negotiation over prepared HTTP bodies and scoped response lifetimes. */
import {
  attachmentPayload,
  byteString,
  type CesrFrame,
  collectPayload,
  parse,
} from "cesr-ts";
import { call, ensure, type Operation, race, resource, scoped } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable, cleanupFailures, throwOnAbort } from "./abortable.ts";
import {
  CESR_ATTACHMENT_HEADER,
  CESR_CONTENT_TYPE,
  CESR_DESTINATION_HEADER,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "./cesr-http.ts";
import type { HttpClient, HttpRequestInit, HttpStreamResponse } from "./http-client.ts";

/** Positive remote HTTP refusal, distinct from source, transport, storage and cleanup failure. */
export class CesrHttpRefusal extends ValidationError {
  /**
   * Describe a completed HTTP refusal without classifying it as a network failure.
   *
   * @param message Endpoint/status detail for the observed peer refusal.
   * @param status Actual non-success HTTP status returned by the peer.
   */
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Expected remote HTTP refusal; infrastructure and cleanup failures still throw. */
export type CesrPostResult = {
  /** Complete means response EOF and cleanup finished; refuse is an observed non-success status. */
  kind: "complete";
} | {
  /** Complete means response EOF and cleanup finished; refuse is an observed non-success status. */
  kind: "refuse";
  /** Completed peer refusal, retaining its HTTP status and decoded detail. */
  error: CesrHttpRefusal;
};
/**
 * Internal result that either lends a successful scoped response or carries a completed peer refusal.
 */
type FrameResponse =
  | {
    /** Successful scoped response, still requiring consumption before its owner closes. */
    kind: "response";
    /** Borrowed response metadata/body; use only within the enclosing request scope. */
    response: HttpStreamResponse;
  }
  | Extract<CesrPostResult, {
    /** Successful scoped response, still requiring consumption before its owner closes. */
    kind: "refuse";
  }>;

/** Transport choices for one CESR frame. */
export interface EgressOptions {
  /** Additional transport headers, such as witness Authorization; CESR framing is set by the sender. */
  headers?: HeadersInit;
  /** Optional endpoint AID carried in CESR-DESTINATION. */
  destination?: string;
  /** Upstream cancellation joins the same request lifetime as Effection cancellation. */
  signal?: AbortSignal;
}

/**
 * Drain successful response bytes; retain refusal text for reporting and media negotiation.
 *
 * @param response Borrowed response; this function consumes its body once to EOF.
 * @param signal Cancels the pending body read through its HTTP owner.
 * @returns Decoded refusal text, or an empty string after draining a successful body.
 * @throws Body-read or cancellation errors propagate; an HTTP status alone does not throw.
 */
export async function readResponseDetail(response: HttpStreamResponse, signal: AbortSignal): Promise<string> {
  const decoder = response.ok ? undefined : new TextDecoder();
  const text: string[] = [];
  for await (const chunk of response.body(signal)) {
    if (decoder) text.push(decoder.decode(chunk, { stream: true }));
  }
  if (decoder) text.push(decoder.decode());
  return text.join("");
}

/**
 * Open one frame response for a caller that needs to consume its bytes.
 * The caller must keep its scope alive while reading; returning this handle from
 * a closing scope does not transfer response ownership. Media fallback closes the
 * rejected attempt before opening the legacy header-media attempt.
 *
 * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
 * @param frame Parsed signed body and attachments; framing preserves the signed body bytes.
 * @param http Borrowed HTTP implementation supplied by composition; owns native request/body I/O.
 * @param options Destination, extra headers and optional cancellation for ordinary signed-message POSTs.
 * @returns A successful response borrowed until the enclosing Effection scope ends.
 * @throws CesrHttpRefusal for a completed refusal; request, transport and cleanup failures propagate.
 */
export function* requestFrame(
  url: string,
  frame: CesrFrame,
  http: HttpClient,
  options: EgressOptions = {},
): Operation<HttpStreamResponse> {
  const result = yield* openFrameResponse(url, frame, http, options);
  if (result.kind === "refuse") throw result.error;
  return result.response;
}

/**
 * Own the response scope for one frame and the existing header-media fallback.
 * A successful response stays live while the borrowing consumer runs. A refused
 * response is drained for its detail, and its scope closes before another attempt.
 *
 * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
 * @param frame Parsed signed body and attachments; framing preserves the signed body bytes.
 * @param http Borrowed HTTP implementation supplied by composition; owns native request/body I/O.
 * @param options Destination, extra headers and optional cancellation for ordinary signed-message POSTs.
 * @returns A scoped successful response or completed refusal, after any permitted media fallback.
 */
function openFrameResponse(
  url: string,
  frame: CesrFrame,
  http: HttpClient,
  options: EgressOptions,
): Operation<FrameResponse> {
  return resource<FrameResponse>(function*(provide) {
    for (const request of yield* frameRequests(frame, options)) {
      const retry = yield* scoped(function*() {
        const response = yield* http.open(url, request);
        if (response.ok) {
          // Keep this request scope live throughout the borrowing consumer's response processing.
          yield* provide({ kind: "response", response });
          return false;
        }
        const detail = yield* abortable((signal) => readResponseDetail(response, signal), options.signal);
        if (isLegacyCesrMediaRejection(request, response.status, detail)) return true;
        yield* provide({
          kind: "refuse",
          error: new CesrHttpRefusal(
            `CESR delivery to ${url} failed with HTTP ${response.status}: ${detail}`,
            response.status,
          ),
        });
        return false;
      });
      if (!retry) return;
    }
  });
}
/**
 * Prepare finite request bytes before opening any network attempt.
 * Ordinary POSTs put normalized text attachments in CESR-ATTACHMENT and send the
 * original body. Requests retain
 * caller authentication headers; sender-owned framing/destination headers replace
 * conflicting caller values. The fallback shares the prepared bytes.
 *
 * @param frame Parsed signed body and attachments; framing preserves the signed body bytes.
 * @param options Destination, extra headers and optional cancellation for ordinary signed-message POSTs.
 * @returns Current and legacy media choices sharing the same signed body.
 */
function* frameRequests(frame: CesrFrame, options: EgressOptions): Operation<HttpRequestInit[]> {
  const header = byteString(
    yield* abortable((signal) => collectPayload(attachmentPayload(frame, { domain: "txt" }), signal), options.signal),
  );
  const body = frame.body.raw;
  const types = [CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE];
  const prepared = body.slice().buffer as ArrayBuffer;
  return types.map((contentType) => {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", contentType);
    headers.delete(CESR_DESTINATION_HEADER);
    headers.delete(CESR_ATTACHMENT_HEADER);
    if (options.destination) headers.set(CESR_DESTINATION_HEADER, options.destination);
    headers.set(CESR_ATTACHMENT_HEADER, header);
    return {
      method: "POST",
      redirect: "manual",
      headers,
      signal: options.signal,
      body: prepared,
    };
  });
}

/**
 * Recognize KERIpy v1's exact preprocessing media refusal, before protocol intake.
 * Attachment framing and the current media type are required. Authentication,
 * KRAM and application refusals cannot trigger a second submission merely by
 * mentioning content type in their diagnostic text.
 *
 * @param request Exact prepared request whose response is being classified.
 * @param status Observed peer HTTP status.
 * @param detail Fully consumed refusal body decoded as text.
 * @returns True only for the pinned Falcon content-type error representation.
 */
export function isLegacyCesrMediaRejection(request: HttpRequestInit, status: number, detail: string): boolean {
  const headers = new Headers(request.headers);
  if (!headers.has(CESR_ATTACHMENT_HEADER) || status !== 406 || headers.get("Content-Type") !== CESR_CONTENT_TYPE) {
    return false;
  }
  let refusal: unknown;
  try {
    refusal = JSON.parse(detail);
  } catch {
    return false;
  }
  return typeof refusal === "object" && refusal !== null
    && "title" in refusal && refusal.title === "Content type error"
    && "description" in refusal && refusal.description === "Unacceptable content type.";
}

/**
 * Send a frame whose caller needs delivery status rather than response content.
 * HttpClient.request has consumed the entire response before returning. Successful
 * bytes are intentionally discarded here; callers needing protocol intake use the
 * scoped response path. Completion proves HTTP delivery, not protocol acceptance.
 *
 * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
 * @param frame Parsed signed body and attachments; framing preserves the signed body bytes.
 * @param http Borrowed HTTP implementation supplied by composition; owns native request/body I/O.
 * @param options Destination, extra headers and optional cancellation for ordinary signed-message POSTs.
 * @returns Complete after finite response consumption/cleanup, or a typed peer refusal.
 * @throws Construction, native transport and cleanup failures propagate.
 */
function* sendFrame(
  url: string,
  frame: CesrFrame,
  http: HttpClient,
  options: EgressOptions,
): Operation<CesrPostResult> {
  for (const request of yield* frameRequests(frame, options)) {
    const response = yield* http.request(url, request);
    if (response.ok) return { kind: "complete" };
    const detail = new TextDecoder().decode(response.body);
    if (isLegacyCesrMediaRejection(request, response.status, detail)) continue;
    return {
      kind: "refuse",
      error: new CesrHttpRefusal(
        `CESR delivery to ${url} failed with HTTP ${response.status}: ${detail}`,
        response.status,
      ),
    };
  }
  throw new Error("CESR media negotiation exhausted its request choices");
}

/**
 * Send a CESR source and throw on a completed peer refusal.
 * One parsed frame becomes one POST, and its request scope closes before the next
 * source pull. A refusal stops the sequence; prior frames may already be delivered.
 * Cancellation aborts active work, joins any pending source pull and returns the
 * parser iterator before leaving. There is no automatic retry beyond media fallback.
 *
 * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
 * @param source Creates the CESR byte source for this invocation; it must observe the supplied abort signal.
 * @param http Borrowed HTTP implementation supplied by composition; owns native request/body I/O.
 * @param options Destination, extra headers and optional cancellation for ordinary signed-message POSTs.
 * @throws Source/parser, transport and cleanup failures propagate without becoming peer refusals. A completed refusal throws CesrHttpRefusal.
 */
export function* postCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  http: HttpClient,
  options: EgressOptions = {},
): Operation<void> {
  const result = yield* attemptPostCesr(url, source, http, options);
  if (result.kind === "refuse") throw result.error;
}
/**
 * Send frames sequentially and return a completed peer refusal as data.
 * One parsed frame becomes one POST, and its request scope closes before the next
 * source pull. A refusal stops the sequence; prior frames may already be delivered.
 * Cancellation aborts active work, joins any pending source pull and returns the
 * parser iterator before leaving. There is no automatic retry beyond media fallback.
 *
 * @param url HTTP(S) endpoint to receive the framed POST; redirect handling is manual.
 * @param source Creates the CESR byte source for this invocation; it must observe the supplied abort signal.
 * @param http Borrowed HTTP implementation supplied by composition; owns native request/body I/O.
 * @param options Destination, extra headers and optional cancellation for ordinary signed-message POSTs.
 * @returns The attempt result after all frames or the first refusal, with source/request cleanup joined.
 * @throws Source/parser, transport and cleanup failures propagate without becoming peer refusals.
 */
export function attemptPostCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  http: HttpClient,
  options: EgressOptions = {},
): Operation<CesrPostResult> {
  // Isolate joining cleanup so a halt cannot resume a delegated caller after payload disposal.
  const posting = call(function*(): Operation<CesrPostResult> {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    let failure: { error: unknown } | undefined;
    try {
      signal.throwIfAborted();
      const frames = parse(source(signal));
      let pending: ReturnType<typeof frames.next> | undefined;
      // The earlier resource joins the read after processing children stop.
      yield* ensure(function*() {
        const cleanup: unknown[] = [];
        /**
         * Retain distinct late failures without duplicating the primary rejection.
         * @param error Rejection from joining a pending pull or returning the parser.
         */
        const noteCleanup = (error: unknown) => {
          for (const remaining of cleanupFailures(error, signal)) {
            if (!(failure && remaining === failure.error) && !cleanup.includes(remaining)) cleanup.push(remaining);
          }
        };
        if (pending) {
          try {
            yield* call(() => pending!);
          } catch (error) {
            noteCleanup(error);
          }
        }
        try {
          yield* call(() => frames.return());
        } catch (error) {
          noteCleanup(error);
        }
        if (cleanup.length) {
          const errors = failure && failure.error !== signal.reason ? [failure.error, ...cleanup] : cleanup;
          if (errors.length === 1) throw errors[0];
          throw new AggregateError(errors, "CESR delivery and source cleanup failed", { cause: errors[0] });
        }
      });
      while (true) {
        signal.throwIfAborted();
        pending = frames.next();
        let result: Awaited<typeof pending>;
        try {
          result = yield* call(() => pending!);
        } catch (error) {
          pending = undefined;
          throw error;
        }
        pending = undefined;
        signal.throwIfAborted();
        if (result.done) break;
        const frame = result.value;
        // Each request closes before the next input frame; it owns its separate HTTP cancellation.
        const posted = yield* sendFrame(url, frame, http, { ...options, signal });
        if (posted.kind === "refuse") return posted;
      }
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      controller.abort();
    }
    return { kind: "complete" };
  });
  if (!options.signal) return posting;
  return race([posting, throwOnAbort(options.signal)]);
}
