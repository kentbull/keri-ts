import { call, type Operation, resource } from "npm:effection@^3.6.0";
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
 * - keep the request and response body owned through enclosing scope exit
 * - abort and join late fetch completion when the enclosing operation is canceled
 * - consume each response inside a finite `call`/`scoped` operation in continuous workers
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

  yield* call(function*() {
    let pending: Promise<void> | undefined;
    yield* resource<void>(function*(provide) {
      try {
        yield* provide();
      } finally {
        // Register before starting cleanup; cancellation joins it and preserves later failure.
        if (pending) yield* call(() => pending!);
      }
    });
    pending = response.body!.cancel();
    yield* call(() => pending!);
  });
}

/** Own fetch completion and the returned body until the enclosing request scope closes. */
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
  return yield* resource<HttpResponseHandle | null>(function*(provide) {
    // The response body remains owned after headers settle and until this resource's scope exits.
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = timeoutMs === undefined ? undefined : services.clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    /** A header timeout ends when fetch settles; body limits belong to its consumer. */
    const clearTimer = () => {
      if (timeoutId !== undefined) services.clock.clearTimeout(timeoutId);
    };
    let pending: Promise<Response> | undefined;
    try {
      pending = services.http.fetch(url, { ...init, signal: controller.signal });
      let response: Response;
      try {
        response = yield* call(() => pending!);
      } catch (error) {
        if (nullOnAbort && error instanceof DOMException && error.name === "AbortError" && timedOut) {
          clearTimer();
          yield* provide(null);
          return;
        }
        throw error;
      }
      clearTimer();
      yield* provide({ response, controller });
    } finally {
      clearTimer();
      controller.abort();
      if (pending) {
        yield* call(async () => {
          // A fetch completing during cancellation still transfers its response to this owner.
          const response = await pending!.catch(() => undefined);
          if (response?.body && !response.body.locked) await response.body.cancel();
        });
      }
    }
  });
}
