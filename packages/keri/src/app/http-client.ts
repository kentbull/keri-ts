/** Native HTTP request construction, byte I/O and joined attempt cleanup. */
import { call, type Operation, resource, scoped } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable } from "./abortable.ts";
import { collectBytes } from "./byte-source.ts";
import { TransportError } from "./transport-error.ts";

/** Existing HTTP request choices; protocol framing and retry policy belong to callers. */
export interface HttpRequestInit {
  /** HTTP method, validated by Request before any network execution. */
  method?: string;
  /** Actual request headers, including protocol framing and optional Authorization. */
  headers?: HeadersInit;
  /** Prepared request content; producers finish serialization before network execution. */
  body?: string | Uint8Array | ArrayBuffer | null;
  /** Caller-selected redirect behavior; the HTTP owner adds no retry policy. */
  redirect?: RequestRedirect;
  /** Caller cancellation/deadline, forwarded into the request and its body. */
  signal?: AbortSignal | null;
}

/** Completed finite response; its bytes remain usable after the request has closed. */
export interface HttpResponse {
  /** HTTP status, interpreted by the application or protocol owner. */
  readonly status: number;
  /** Whether the status is successful; full body consumption has already completed. */
  readonly ok: boolean;
  /** Received protocol metadata. */
  readonly headers: Headers;
  /** Complete resident response bytes. */
  readonly body: Uint8Array;
}

/** Response metadata and one request-owned byte source, valid only inside its request scope. */
export interface HttpStreamResponse {
  /** HTTP status; non-success statuses remain application/protocol decisions. */
  readonly status: number;
  /** Success derived from the HTTP status, independent of body/protocol acceptance. */
  readonly ok: boolean;
  /** Received headers; consumers interpret their protocol meaning. */
  readonly headers: Headers;
  /**
   * Borrow the response body for one consumer.
   * Finish iteration or return it before leaving the enclosing open scope. Metadata
   * success does not imply that this stream will reach EOF successfully.
   *
   * @param signal Optional consumer cancellation that interrupts the owned request/body read.
   * @returns The single borrowed body source; chunks are available only within the open request scope.
   */
  body(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/** A scoped HTTP implementation supplied by composition, with an explicit transport-error contract. */
export interface HttpClient {
  /**
   * Return finite response bytes after the owned request scope has closed.
   *
   * @param url Absolute HTTP(S) URL; invalid URL/request construction fails before fetch.
   * @param init Prepared method, headers, finite body and cancellation; omitted values use native Request defaults.
   * @returns Status, headers and complete owned bytes after request cleanup.
   * @throws Validation/construction errors remain caller errors; native fetch/body failures are TransportError with cause. Cancellation and cleanup failures remain visible.
   */
  request(url: string, init?: HttpRequestInit): Operation<HttpResponse>;
  /**
   * Acquire response headers and retain native I/O in the enclosing scope.
   * HTTP non-success status remains a response for the protocol caller to interpret.
   * Scope exit aborts unread or pending I/O, joins it, and releases the reader.
   * The consumer must not retain the response for use after that scope closes.
   *
   * @param url Absolute HTTP(S) URL without embedded credentials.
   * @param init Prepared request choices and optional upstream signal; no asynchronous upload producer.
   * @returns Response metadata and one body reader borrowed until the enclosing scope closes.
   * @throws Request validation errors precede network classification. Native fetch/read failures become TransportError; consumer and genuine cleanup failures propagate.
   */
  open(url: string, init?: HttpRequestInit): Operation<HttpStreamResponse>;
}

/**
 * Own the native Request, fetch and response reader for one attempt.
 * Construction errors remain outside network classification. Native fetch/read
 * errors retain their causes as TransportError. Consumer execution remains outside
 * those catches; scope exit aborts and joins I/O before releasing its reader.
 * Protocol consumers never receive the native Response.
 */
export class FetchHttpClient implements HttpClient {
  /**
   * Consume finite bytes and finish the request scope before returning a completed response.
   *
   * @param url Absolute HTTP(S) URL; invalid URL/request construction fails before fetch.
   * @param init Prepared method, headers, finite body and cancellation; omitted values use native Request defaults.
   * @returns Status, headers and complete owned bytes after request cleanup.
   * @throws Validation/construction errors remain caller errors; native fetch/body failures are TransportError with cause. Cancellation and cleanup failures remain visible.
   */
  request(url: string, init: HttpRequestInit = {}): Operation<HttpResponse> {
    const open = this.open.bind(this);
    return scoped(function*() {
      const response = yield* open(url, init);
      const body = yield* abortable((signal) => collectBytes(response.body(signal)), init.signal ?? undefined);
      return { status: response.status, ok: response.ok, headers: response.headers, body };
    });
  }

  /**
   * Acquire headers and lend response bytes until the enclosing Effection scope ends.
   * Validate Request before fetch; scope exit aborts unread I/O, joins pending
   * fetch/read work and releases the reader. Consumer failures stay outside the
   * transport catches. The response must not escape this scope.
   *
   * @param url Absolute HTTP(S) endpoint without embedded credentials.
   * @param init Prepared method, headers, finite body and optional upstream cancellation; native Request defaults apply.
   * @returns Metadata and one borrowed body source; status success does not prove body completion.
   * @throws Validation errors precede network execution. Native fetch/read failures retain their cause in TransportError; cancellation and distinct cleanup failures propagate.
   */
  open(url: string, init: HttpRequestInit = {}): Operation<HttpStreamResponse> {
    return resource<HttpStreamResponse>(function*(provide) {
      const controller = new AbortController();
      const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
      // These handles let scope teardown join native work before releasing the reader.
      let fetching: Promise<Response> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let reading: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
      let failure: { error: unknown } | undefined;
      let bodySignal: AbortSignal | undefined;
      /** A borrowing parser must interrupt its read before child teardown tries to join it. */
      const abortBody = () => controller.abort(bodySignal!.reason);
      /**
       * Classify only native fetch/read failures, preserving exact caller cancellation.
       * @param cause Native rejection; consumer/parser exceptions never enter this helper.
       * @param message Operation detail to combine with the endpoint URL.
       * @returns Original cancellation reason or a TransportError retaining cause.
       */
      const transportFailure = (cause: unknown, message: string): unknown =>
        signal.aborted && cause === signal.reason ? cause : new TransportError(`${message} for ${url}`, { cause });
      try {
        signal.throwIfAborted();
        const endpoint = new URL(url);
        if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
          throw new ValidationError("HTTP output requires an HTTP(S) URL without credentials");
        }
        // Construction errors are caller errors, before native network classification.
        const request = new Request(url, { ...init, signal, body: init.body as BodyInit | null | undefined });
        fetching = fetch(request).catch((cause) => {
          throw transportFailure(cause, "HTTP request failed");
        });
        const response = yield* call(() => fetching!);
        signal.throwIfAborted();
        yield* provide({
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          /**
           * Borrow the native response reader for this request scope.
           * Early iterator return aborts the request; the enclosing owner joins cleanup.
           *
           * @param consumerSignal Optional consumer cancellation; abort interrupts this request and any pending read.
           * @returns A single-consumer iterable of byte chunks, valid only while the request scope remains open.
           */
          body(consumerSignal) {
            if (reader) throw new Error("HTTP response body already acquired");
            bodySignal = consumerSignal;
            bodySignal?.addEventListener("abort", abortBody, { once: true });
            if (bodySignal?.aborted) abortBody();
            reader = response.body?.getReader();
            return {
              /** Pull ordinary chunks; consumer execution stays outside the transport catch. */
              async *[Symbol.asyncIterator]() {
                try {
                  signal.throwIfAborted();
                  while (reader) {
                    signal.throwIfAborted();
                    reading = reader.read().catch((cause) => {
                      // Node 20 Fetch replaces the supplied reason with a native AbortError during body reads.
                      if (signal.aborted && cause instanceof DOMException && cause.name === "AbortError") {
                        throw signal.reason;
                      }
                      throw transportFailure(cause, "HTTP response body failed");
                    });
                    let result: ReadableStreamReadResult<Uint8Array>;
                    try {
                      result = await reading;
                    } catch (error) {
                      failure = { error };
                      throw error;
                    } finally {
                      reading = undefined;
                    }
                    signal.throwIfAborted();
                    if (result.done) return;
                    yield result.value;
                  }
                } finally {
                  // Early iterator return stops the native response; the request scope joins it.
                  controller.abort();
                }
              },
            };
          },
        });
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        // Fetch abort also stops unread bodies. Do not create a second cancellation path.
        controller.abort();
        const cleanup: unknown[] = [];
        yield* call(async () => {
          for (const pending of [fetching, reading]) {
            try {
              await pending;
            } catch (error) {
              if (error !== signal.reason && error !== failure?.error) cleanup.push(error);
            }
          }
          try {
            reader?.releaseLock();
          } catch (error) {
            cleanup.push(error);
          }
          bodySignal?.removeEventListener("abort", abortBody);
        });
        // Throw outside the Promise leaf so Effection teardown preserves genuine cleanup failures.
        if (cleanup.length) {
          if (failure && failure.error !== signal.reason) cleanup.unshift(failure.error);
          // deno-lint-ignore no-unsafe-finally -- A joined cleanup failure must remain visible during halt.
          if (cleanup.length === 1) throw cleanup[0];
          // deno-lint-ignore no-unsafe-finally -- Preserve the primary failure alongside distinct cleanup failure.
          throw new AggregateError(cleanup, "HTTP request and cleanup failed", { cause: cleanup[0] });
        }
      }
    });
  }
}
