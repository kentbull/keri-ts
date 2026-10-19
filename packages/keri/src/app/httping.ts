/** HTTP caller policies; the composed client owns native requests, readers and cleanup. */
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { HttpClient, HttpRequestInit, HttpStreamResponse } from "./http-client.ts";
import type { RuntimeClock, RuntimeTimer } from "./runtime-clock.ts";

/**
 * Acquire headers under the mailbox's existing timeout-as-no-response policy.
 * The timer ends at headers, while the client resource remains live in this
 * caller scope for body consumption. Only this timer's exact abort becomes null;
 * external abort, native I/O and cleanup failures remain visible.
 */
export function requestWithHeaderTimeout(
  http: HttpClient,
  clock: RuntimeClock,
  url: string,
  init: HttpRequestInit,
  timeoutMs: number,
): Operation<HttpStreamResponse | null> {
  return resource<HttpStreamResponse | null>(function*(provide) {
    const controller = new AbortController();
    const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    let timer: RuntimeTimer | undefined;
    let timedOut = false;
    /** Header acquisition clears its timer without ending the owning request scope. */
    const clearTimer = () => {
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
    };
    try {
      signal.throwIfAborted();
      timer = clock.setTimeout(() => {
        if (!signal.aborted) {
          timedOut = true;
          controller.abort();
        }
      }, timeoutMs);
      try {
        // Keep acquisition failure inside an error boundary without closing a successful body early.
        yield* call(function*() {
          const response = yield* http.open(url, { ...init, signal });
          clearTimer();
          yield* provide(response);
        });
      } catch (error) {
        if (!timedOut || error !== controller.signal.reason) throw error;
        clearTimer();
        yield* provide(null);
        return;
      }
    } finally {
      clearTimer();
      controller.abort();
    }
  });
}
