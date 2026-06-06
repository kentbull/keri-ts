import { action, type Operation } from "npm:effection@^3.6.0";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";

/** One live HTTP response plus the controller that can still abort its body. */
export interface HttpResponseHandle {
  response: Response;
  controller: AbortController;
}

interface FetchResponseHandleOptions {
  services?: RuntimeServices;
}

interface FetchResponseHandleOrNullOptions extends FetchResponseHandleOptions {
  timeoutMs?: number;
}

interface FetchResponseHandleInternalOptions extends FetchResponseHandleOrNullOptions {
  nullOnAbort?: boolean;
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
  options: FetchResponseHandleOptions = {},
): Operation<HttpResponseHandle> {
  const { services = defaultRuntimeServices } = options;
  const handle = yield* fetchResponseHandleInternal(url, init, { services });
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
  options: FetchResponseHandleOrNullOptions = {},
): Operation<HttpResponseHandle | null> {
  const { timeoutMs, services = defaultRuntimeServices } = options;
  return yield* fetchResponseHandleInternal(url, init, {
    timeoutMs,
    nullOnAbort: true,
    services,
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
  options: FetchResponseHandleInternalOptions = {},
): Operation<HttpResponseHandle | null> {
  const {
    timeoutMs,
    nullOnAbort = false,
    services = defaultRuntimeServices,
  } = options;
  return yield* action<HttpResponseHandle | null>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timedOut = false;
    const timeoutId = timeoutMs === undefined ? undefined : services.clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const clearTimer = () => {
      if (timeoutId !== undefined) {
        services.clock.clearTimeout(timeoutId);
      }
    };

    services.http.fetch(url, { ...init, signal: controller.signal }).then((response) => {
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
