/** Test HTTP peers implementing the scoped client contract without classifying arbitrary injected failures. */
import { call, resource, scoped } from "effection";
import { abortable } from "../../src/app/abortable.ts";
import { collectBytes, streamBytes } from "../../src/app/byte-source.ts";
import type { HttpClient, HttpResponse, HttpStreamResponse } from "../../src/app/http-client.ts";

/** Existing test peers describe HTTP response bytes and exact exceptional outcomes. */
export type TestHttpResponder = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Adapt a test response into one owned byte source; protocol tests do not need native network classification. */
export function httpResponse(response: Response, ownerSignal?: AbortSignal): HttpStreamResponse {
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body(signal) {
      const source = streamBytes(response.body, {
        signal: ownerSignal && signal ? AbortSignal.any([ownerSignal, signal]) : ownerSignal ?? signal,
      });
      let started = false;
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              started = true;
              return source.next();
            },
            async return() {
              if (!started) await response.body?.cancel();
              return await source.return(undefined);
            },
          };
        },
      };
    },
  };
}

/** Supply a deterministic peer through the actual request contract; preserve deliberately injected error identity. */
export function httpClient(respond: TestHttpResponder): HttpClient {
  return {
    request(url, init = {}): import("effection").Operation<HttpResponse> {
      const open = this.open.bind(this);
      return scoped(function*() {
        const response = yield* open(url, init);
        const body = yield* abortable((signal) => collectBytes(response.body(signal)), init.signal ?? undefined);
        return { status: response.status, ok: response.ok, headers: response.headers, body };
      });
    },
    open(url, init = {}) {
      return resource<HttpStreamResponse>(function*(provide) {
        const controller = new AbortController();
        const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
        let response: Response | undefined;
        let pending: Promise<Response> | undefined;
        let reported: { error: unknown } | undefined;
        let bytes: AsyncIterator<Uint8Array> | undefined;
        try {
          signal.throwIfAborted();
          pending = Promise.resolve(respond(url, { ...init, signal, body: init.body as BodyInit | null | undefined }));
          response = yield* call(() => pending!);
          const owned = httpResponse(response, signal);
          yield* provide({
            ...owned,
            body(consumerSignal) {
              const body = owned.body(consumerSignal);
              bytes = body[Symbol.asyncIterator]();
              return {
                [Symbol.asyncIterator]() {
                  return bytes!;
                },
              };
            },
          });
        } catch (error) {
          reported = { error };
          throw error;
        } finally {
          controller.abort();
          const errors: unknown[] = [];
          yield* call(async () => {
            const remember = (error: unknown) => {
              if (error !== signal.reason && !(reported && error === reported.error) && !errors.includes(error)) {
                errors.push(error);
              }
            };
            try {
              response = await pending;
            } catch (error) {
              remember(error);
            }
            try {
              await bytes?.return?.();
            } catch (error) {
              remember(error);
            }
            try {
              if (response?.body && !response.body.locked) await response.body.cancel();
            } catch (error) {
              remember(error);
            }
          });
          // deno-lint-ignore no-unsafe-finally -- Joined cleanup failures must remain visible during teardown.
          if (errors.length === 1) throw errors[0];
          // deno-lint-ignore no-unsafe-finally -- Preserve distinct peer cleanup failures together.
          if (errors.length) throw new AggregateError(errors, "Test HTTP peer cleanup failed");
        }
      });
    },
  };
}
