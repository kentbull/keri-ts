/**
 * Output barrier for browser compositions (ADR-0015 durability rule 6).
 *
 * A browser store acknowledges a commit before it is durable, so a response,
 * receipt or query that depends on that commit must not leave the page until
 * the composition's persistence queue has flushed. Otherwise a crash or tab
 * close could leave a peer holding evidence of state this wallet then forgot.
 */

import { call, type Operation } from "npm:effection@^3.6.0";
import type { HttpClient, HttpRequestInit, HttpResponse, HttpStreamResponse } from "../../app/transport/http-client.ts";
import { AppError } from "../../core/errors.ts";

/** The persistence queue failed, so the request was not sent. The queue's failure is the cause. */
export class OutputBarrierError extends AppError {
  override readonly name: string = "OutputBarrierError";
}

/**
 * Wrap `inner` so no request, finite or streaming, reaches it before `flushed` resolves.
 *
 * `flushed` is evaluated per request, so each request waits for everything
 * committed before it was made. Pass `() => opener.queue.flushed()` from the
 * composition's `WebStoreOpener`: the queue is shared by every store family, so
 * it covers all commits, which one store's `flushed()` would not.
 *
 * A rejected flush fails the call with `OutputBarrierError` and sends nothing.
 * Cancelling the caller cancels only the wait.
 *
 * The wrapper has no `tcp` dialer: a dialer would be a network path around the
 * barrier, and browsers have none.
 */
export function barrierHttpClient(
  inner: HttpClient,
  flushed: () => Operation<void> | Promise<void>,
): HttpClient {
  function* barrier(): Operation<void> {
    try {
      yield* call(() => flushed());
    } catch (error) {
      throw new OutputBarrierError("Persistence did not flush; the request was not sent", { cause: error });
    }
  }
  return {
    *request(url: string, init?: HttpRequestInit): Operation<HttpResponse> {
      yield* barrier();
      return yield* inner.request(url, init);
    },
    *open(url: string, init?: HttpRequestInit): Operation<HttpStreamResponse> {
      yield* barrier();
      return yield* inner.open(url, init);
    },
  };
}
