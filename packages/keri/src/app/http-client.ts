/** Native HTTP request construction, byte I/O and joined attempt cleanup. */
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { TransportError } from "./transport-error.ts";

/** A request-owned upload, opened lazily only when fetch requests its first bytes. */
export type HttpBodySource = (signal: AbortSignal) => AsyncIterable<Uint8Array>;

/** Existing HTTP request choices; protocol framing and retry policy belong to callers. */
export interface HttpRequestInit {
  /** HTTP method, validated by Request before any network execution. */
  method?: string;
  /** Actual request headers, including protocol framing and optional Authorization. */
  headers?: HeadersInit;
  /** Resident platform body or a cancellable pull source for streaming upload. */
  body?: BodyInit | HttpBodySource | null;
  /** Caller-selected redirect behavior; the HTTP owner adds no retry policy. */
  redirect?: RequestRedirect;
  /** Caller cancellation/deadline, forwarded into the request and its body. */
  signal?: AbortSignal | null;
}

/** Response metadata and one request-owned byte source, valid only inside its request scope. */
export interface HttpResponse {
  /** HTTP status; non-success statuses remain application/protocol decisions. */
  readonly status: number;
  /** Success derived from the HTTP status, independent of body/protocol acceptance. */
  readonly ok: boolean;
  /** Received headers; consumers interpret their protocol meaning. */
  readonly headers: Headers;
  /** Borrow the body once; consumer cancellation interrupts its pending native read. */
  body(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/** A scoped HTTP implementation supplied by composition, with an explicit transport-error contract. */
export interface HttpClient {
  /** Construct and execute one request; enclosing scope exit joins all native I/O. */
  request(url: string, init?: HttpRequestInit): Operation<HttpResponse>;
}

/** Throw distinct failures without losing an undefined rejection or hiding cleanup behind an I/O error. */
function throwFailures(errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "HTTP request and cleanup failed", { cause: errors[0] });
}

/**
 * Own the native Request, fetch, upload and response reader for one attempt.
 * Construction errors remain outside network classification. Native fetch/read
 * errors retain their causes as TransportError; source and genuine cleanup errors
 * retain their identity. Protocol consumers never receive the native Response.
 */
export class FetchHttpClient implements HttpClient {
  /** Acquire a response whose body and active upload remain owned by the caller's request scope. */
  request(url: string, init: HttpRequestInit = {}): Operation<HttpResponse> {
    return resource<HttpResponse>(function*(provide) {
      const controller = new AbortController();
      const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
      // An early response may cancel upload while the response itself remains readable.
      const uploadController = new AbortController();
      const uploadSignal = AbortSignal.any([signal, uploadController.signal]);
      let response: Response | undefined;
      let fetching: Promise<Response> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let reading: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
      let closing: Promise<void> | undefined;
      let closedResponse: Response | undefined;
      let upload: AsyncIterator<Uint8Array> | undefined;
      let uploading: Promise<IteratorResult<Uint8Array>> | undefined;
      let uploadClosing: Promise<void> | undefined;
      let uploadFailure: { error: unknown } | undefined;
      let readFailure: { raw: unknown; error: unknown } | undefined;
      let requestFailure: { error: unknown } | undefined;
      const reported: unknown[] = [];
      let bodySignal: AbortSignal | undefined;
      let acquired = false;
      let ended = false;

      /** Abort the actual request when the borrowing consumer stops, even during a blocked read. */
      const abortBody = () => controller.abort(bodySignal!.reason);
      /** Preserve native error provenance; source failures and exact cancellation remain distinct. */
      const transportFailure = (cause: unknown, message = "HTTP request failed"): unknown => {
        if (uploadFailure) return uploadFailure.error;
        if (signal.aborted && cause === signal.reason) return cause;
        return new TransportError(`${message} for ${url}`, { cause });
      };
      /** Join the original upload before returning its iterator; never race next() with return(). */
      const closeUpload = () => {
        uploadController.abort();
        return uploadClosing ??= (async () => {
          await uploading?.catch(() => undefined);
          await upload?.return?.();
        })();
      };
      /** Cancel before joining a pending read, then unlock; retain distinct cleanup failures. */
      const closeBody = () =>
        closing ??= (async () => {
          closedResponse = response;
          const errors: unknown[] = [];
          let cancellation: { error: unknown } | undefined;
          try {
            if (reader) await reader.cancel(signal.reason);
            else if (response?.body) await response.body.cancel(signal.reason);
          } catch (error) {
            cancellation = { error };
          }
          await reading?.catch(() => undefined);
          if (
            cancellation && cancellation.error !== signal.reason
            && !(readFailure && cancellation.error === readFailure.raw)
          ) errors.push(cancellation.error);
          try {
            reader?.releaseLock();
          } catch (error) {
            if (!errors.includes(error)) errors.push(error);
          }
          bodySignal?.removeEventListener("abort", abortBody);
          throwFailures(errors);
        })();
      /** Scope abort wakes injected/native readers too; finalization joins this same cancellation. */
      const cancel = () => {
        void closeBody().catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        signal.throwIfAborted();
        const endpoint = new URL(url);
        if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
          throw new ValidationError("HTTP output requires an HTTP(S) URL without credentials");
        }
        const source = typeof init.body === "function" ? init.body : undefined;
        const body = source
          ? new ReadableStream<Uint8Array>({
            /** Fetch demand opens the source; Request construction itself starts no source work. */
            async pull(stream) {
              try {
                uploadSignal.throwIfAborted();
                upload ??= source(uploadSignal)[Symbol.asyncIterator]();
                uploading = upload.next();
                const result = await uploading;
                if (result.done) stream.close();
                else stream.enqueue(result.value);
              } catch (error) {
                if (!(uploadSignal.aborted && error === uploadSignal.reason)) uploadFailure = { error };
                throw error;
              } finally {
                uploading = undefined;
              }
            },
            /** Platform upload cancellation still joins the source's original cleanup. */
            cancel: closeUpload,
          }, { highWaterMark: 0 })
          : init.body as BodyInit | null | undefined;
        // Construction is deliberately outside the catch that labels native execution failures.
        const request = new Request(url, {
          ...init,
          signal,
          body,
          ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
        });
        fetching = (async () => {
          try {
            return response = await fetch(request);
          } catch (cause) {
            throw transportFailure(cause);
          }
        })();
        response = yield* call(() => fetching!);
        signal.throwIfAborted();
        yield* provide({
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          /** Acquire one native reader and forward the consumer's cancellation into this request. */
          body(consumerSignal) {
            if (acquired) throw new Error("HTTP response body already acquired");
            acquired = true;
            bodySignal = consumerSignal;
            bodySignal?.addEventListener("abort", abortBody, { once: true });
            if (bodySignal?.aborted) abortBody();
            reader = response!.body?.getReader();
            return {
              /** The single consumer borrows this iterator; transport cleanup remains with the request. */
              [Symbol.asyncIterator]() {
                return {
                  /** Classify only native reader failure, outside all protocol/consumer execution. */
                  async next(): Promise<IteratorResult<Uint8Array>> {
                    signal.throwIfAborted();
                    if (ended || !reader) return { done: true, value: undefined };
                    try {
                      reading = reader.read();
                      const result = await reading;
                      signal.throwIfAborted();
                      if (result.done) ended = true;
                      return result.done ? { done: true, value: undefined } : { done: false, value: result.value };
                    } catch (raw) {
                      const error = transportFailure(raw, "HTTP response body failed");
                      readFailure = { raw, error };
                      reported.push(error);
                      throw error;
                    } finally {
                      reading = undefined;
                    }
                  },
                  /** Early consumer exit also closes an otherwise never-read body. */
                  async return(): Promise<IteratorResult<Uint8Array>> {
                    ended = true;
                    controller.abort();
                    await closeBody();
                    return { done: true, value: undefined };
                  },
                };
              },
            };
          },
        });
      } catch (error) {
        requestFailure = { error };
        reported.push(error);
        throw error;
      } finally {
        controller.abort();
        const errors: unknown[] = [];
        yield* call(async () => {
          /** Only the exact already-reported error or owned abort may be consumed during joining. */
          const remember = (error: unknown) => {
            if (error !== signal.reason && !reported.includes(error) && !errors.includes(error)) errors.push(error);
          };
          try {
            await fetching;
          } catch (error) {
            remember(error);
          }
          // A late response may arrive after the abort notification observed no response yet.
          if (response && closedResponse !== response) closing = undefined;
          try {
            await closeBody();
          } catch (error) {
            remember(error);
          }
          try {
            await closeUpload();
          } catch (error) {
            remember(error);
          }
          signal.removeEventListener("abort", cancel);
          // A canceled consumer can lose its pending read result. The request still owns that failure.
          if (readFailure && readFailure.raw !== signal.reason && !errors.includes(readFailure.error)) {
            errors.unshift(readFailure.error);
          }
        });
        if (
          errors.length && requestFailure && requestFailure.error !== signal.reason
          && !errors.includes(requestFailure.error)
        ) {
          errors.unshift(requestFailure.error);
        }
        throwFailures(errors);
      }
    });
  }
}
