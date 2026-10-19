/** Scoped CESR HTTP output with streamed payloads and joined cancellation. */
import { attachmentPayload, byteString, type CesrFrame, collectPayload, framePayload, parse } from "cesr-ts";
import { call, ensure, on, type Operation, race, resource, scoped } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable, rethrowCleanupFailure } from "./abortable.ts";
import {
  CESR_ATTACHMENT_HEADER,
  CESR_CONTENT_TYPE,
  CESR_DESTINATION_HEADER,
  type CesrBodyMode,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "./cesr-http.ts";
import type { HttpClient, HttpRequestInit, HttpStreamResponse } from "./http-client.ts";

/** Positive remote HTTP refusal, distinct from source, transport, storage and cleanup failure. */
export class CesrHttpRefusal extends ValidationError {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Expected remote HTTP refusal; infrastructure and cleanup failures still throw. */
export type CesrPostResult = { kind: "complete" } | { kind: "refuse"; error: CesrHttpRefusal };
type FrameResponse = { kind: "response"; response: HttpStreamResponse } | Extract<CesrPostResult, { kind: "refuse" }>;

/** Transport choices for one CESR frame. */
export interface EgressOptions {
  /** Header mode matches KERIpy; body mode streams the complete qualified frame. */
  bodyMode?: CesrBodyMode;
  /** Additional transport headers, such as witness Authorization; CESR framing is set by the sender. */
  headers?: HeadersInit;
  /** Optional endpoint AID carried in CESR-DESTINATION. */
  destination?: string;
  /** Upstream cancellation joins the same request lifetime as Effection cancellation. */
  signal?: AbortSignal;
}

/** Drain successful response bytes; retain refusal text for reporting and media negotiation. */
async function readResponseBody(response: HttpStreamResponse, signal: AbortSignal): Promise<string> {
  const decoder = response.ok ? undefined : new TextDecoder();
  const text: string[] = [];
  for await (const chunk of response.body(signal)) {
    if (decoder) text.push(decoder.decode(chunk, { stream: true }));
  }
  if (decoder) text.push(decoder.decode());
  return text.join("");
}

/** Open a CESR frame response under the caller's scope; the supplied HTTP client owns native I/O. */
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

/** Frame one message and apply only the existing CESR media negotiation, closing each attempt before another. */
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
        const detail = yield* abortable((signal) => readResponseBody(response, signal), options.signal);
        if (mediaRejection(request, response.status, detail)) return true;
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
/** Prepare each finite wire body once; only header-mode media negotiation has a second choice. */
function* frameRequests(frame: CesrFrame, options: EgressOptions): Operation<HttpRequestInit[]> {
  const mode = options.bodyMode ?? "header";
  const header = mode === "header"
    ? byteString(
      yield* abortable((signal) => collectPayload(attachmentPayload(frame, { domain: "txt" }), signal), options.signal),
    )
    : undefined;
  const body = mode === "body"
    ? yield* abortable((signal) => collectPayload(framePayload(frame), signal), options.signal)
    : frame.body.raw;
  const types = mode === "header" ? [CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE] : [CESR_CONTENT_TYPE];
  const prepared = body.slice().buffer as ArrayBuffer;
  return types.map((contentType) => {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", contentType);
    headers.delete(CESR_DESTINATION_HEADER);
    headers.delete(CESR_ATTACHMENT_HEADER);
    if (options.destination) headers.set(CESR_DESTINATION_HEADER, options.destination);
    if (header !== undefined) headers.set(CESR_ATTACHMENT_HEADER, header);
    return {
      method: "POST",
      redirect: "manual",
      headers,
      signal: options.signal,
      body: prepared,
    };
  });
}

/** Preserve the existing header-media fallback, rather than retrying arbitrary refusals. */
function mediaRejection(request: HttpRequestInit, status: number, detail: string): boolean {
  const headers = new Headers(request.headers);
  return headers.has(CESR_ATTACHMENT_HEADER) && status === 406
    && headers.get("Content-Type") === CESR_CONTENT_TYPE && detail.toLowerCase().includes("content type");
}

/** Send one prepared frame and inspect only a completed finite response. */
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
    if (mediaRejection(request, response.status, detail)) continue;
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

/** Strict source sender; callers wanting retry/refusal policy use the joined attempt result. */
export function* postCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  http: HttpClient,
  options: EgressOptions = {},
  consume?: (response: HttpStreamResponse) => Operation<void>,
): Operation<void> {
  const result = yield* attemptPostCesr(url, source, http, options, consume);
  if (result.kind === "refuse") throw result.error;
}
/** Post through the same lifetime owner, returning only this invocation's expected refusal after joined cleanup. */
export function attemptPostCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  http: HttpClient,
  options: EgressOptions = {},
  consume?: (response: HttpStreamResponse) => Operation<void>,
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
        const noteCleanup = (error: unknown) => {
          try {
            rethrowCleanupFailure(error, signal);
          } catch (remaining) {
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
        const posted = yield* scoped(function*(): Operation<CesrPostResult> {
          if (!consume) return yield* sendFrame(url, frame, http, options);
          const response = yield* openFrameResponse(url, frame, http, options);
          if (response.kind === "refuse") return response;
          yield* consume(response.response);
          return { kind: "complete" };
        });
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
  const signal = options.signal;
  const attempt = signal
    ? race([
      posting,
      call(function*(): Operation<never> {
        const abort = yield* on(signal, "abort");
        signal.throwIfAborted();
        yield* abort.next();
        throw signal.reason;
      }),
    ])
    : posting;
  return attempt;
}
