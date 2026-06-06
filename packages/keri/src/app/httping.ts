import { action, type Operation } from "npm:effection@^3.6.0";

/** One live HTTP response plus the controller that can still abort its body. */
export interface HttpResponseHandle {
  response: Response;
  controller: AbortController;
}

/**
 * Fetch one HTTP response under Effection cancellation control.
 *
 * This is the shared request-lifecycle seam:
 * - create one local `AbortController`
 * - abort when the enclosing operation is canceled
 * - hand the caller both the `Response` and the controller when body policy
 *   needs later abort access, such as mailbox SSE long-poll reads
 */
export function* fetchResponseHandle(
  url: string,
  init: RequestInit = {},
): Operation<HttpResponseHandle> {
  const handle = yield* fetchResponseHandleInternal(url, init);
  if (!handle) {
    throw new Error("HTTP response handle unexpectedly resolved to null.");
  }
  return handle;
}

/**
 * Fetch one HTTP response handle with an abort-to-null policy.
 *
 * This is for callers such as mailbox polling that treat request timeout as a
 * normal "no response yet" outcome instead of as an exception.
 */
export function* fetchResponseHandleOrNull(
  url: string,
  init: RequestInit = {},
  {
    timeoutMs,
  }: {
    timeoutMs?: number;
  } = {},
): Operation<HttpResponseHandle | null> {
  return yield* fetchResponseHandleInternal(url, init, {
    timeoutMs,
    nullOnAbort: true,
  });
}

/**
 * Close one response body under Effection control.
 *
 * Callers should use this instead of open-coding `body.cancel()` so response
 * cleanup policy stays consistent across mailbox, OOBI, auth, and exchange
 * flows.
 */
export function* closeResponseBody(response: Response): Operation<void> {
  if (!response.body) {
    return;
  }

  yield* action((resolve, reject) => {
    response.body!.cancel().then(() => resolve(undefined)).catch(reject);
    return () => {};
  });
}

function* fetchResponseHandleInternal(
  url: string,
  init: RequestInit,
  {
    timeoutMs,
    nullOnAbort = false,
  }: {
    timeoutMs?: number;
    nullOnAbort?: boolean;
  } = {},
): Operation<HttpResponseHandle | null> {
  return yield* action<HttpResponseHandle | null>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timedOut = false;
    const timeoutId = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const clearTimer = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };

    fetch(url, { ...init, signal: controller.signal }).then((response) => {
      settled = true;
      clearTimer();
      resolve({ response, controller });
    }).catch((error) => {
      settled = true;
      clearTimer();
      if (
        nullOnAbort
        && error instanceof DOMException
        && error.name === "AbortError"
        && timedOut
      ) {
        resolve(null);
        return;
      }
      reject(error);
    });

    return () => {
      clearTimer();
      if (!settled) {
        controller.abort();
      }
    };
  });
}
