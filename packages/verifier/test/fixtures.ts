/** Small application-owned peers and clocks; protocol intake uses public keri-ts APIs. */
import { concatBytes } from "cesr-ts";
import { call, resource, scoped } from "effection";
import type { HttpClient, HttpRequestInit, HttpStreamResponse } from "keri-ts/runtime";

/** Status-only webhook peer with joined unread-body cleanup and exact injected failures. */
export function httpClient(respond: (url: string, init: HttpRequestInit) => Response | Promise<Response>): HttpClient {
  return {
    request(url, init = {}) {
      const open = this.open.bind(this);
      return scoped(function*() {
        const response = yield* open(url, init);
        const bytes = yield* call(async () => {
          const chunks: Uint8Array[] = [];
          for await (const chunk of response.body()) chunks.push(chunk);
          return concatBytes(...chunks);
        });
        return { status: response.status, ok: response.ok, headers: response.headers, body: bytes };
      });
    },
    open(url, init = {}) {
      return resource<HttpStreamResponse>(function*(provide) {
        const response = yield* call(async () => await respond(url, init));
        try {
          yield* provide({
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            async *body() {
              const bytes = new Uint8Array(await response.arrayBuffer());
              if (bytes.length) yield bytes;
            },
          });
        } finally {
          yield* call(async () => await response.body?.cancel());
        }
      });
    },
  };
}

/** Advance the wall-clock samples used by admission/expiry; these finite tests run no host timers. */
export function manualClock(epoch: number) {
  let now = epoch;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
}
