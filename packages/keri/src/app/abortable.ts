import { call, type Operation, type Scope, useScope } from "npm:effection@^3.6.0";

/**
 * Own one cancellable Promise leaf inside an Effection operation.
 * The leaf must observe its signal; teardown aborts it and joins its cleanup before returning.
 * An isolated call scope keeps cancellation abrupt even while finalization yields.
 * Register dependent owner resources before this leaf so reverse teardown joins it before disposal.
 * Owned concurrent work uses the supplied leaf scope, so its signal aborts before child cleanup joins.
 * Borrow that scope only for work joined within the leaf, never for later operations.
 */
export function abortable<T>(
  start: (signal: AbortSignal, scope: Scope) => Promise<T>,
  upstream?: AbortSignal,
): Operation<T> {
  return call(function*() {
    const controller = new AbortController();
    const signal = upstream ? AbortSignal.any([controller.signal, upstream]) : controller.signal;
    let pending: Promise<T> | undefined;
    try {
      signal.throwIfAborted();
      pending = start(signal, yield* useScope());
      return yield* call(() => pending!);
    } finally {
      controller.abort();
      // Cancellation stops waiting at the yield, but the leaf still owns I/O until its Promise settles.
      if (pending) yield* call(() => pending!.then(() => {}, () => {}));
    }
  });
}
