import { call, ensure, type Operation, type Scope, useScope } from "npm:effection@^3.6.0";

/** Remove only this operation's cancellation from joined I/O failures. */
function remainingFailures(error: unknown, cancellation: unknown): unknown[] {
  if (error === cancellation) return [];
  if (!(error instanceof AggregateError)) return [error];
  const remaining = error.errors.flatMap((child) => remainingFailures(child, cancellation));
  return remaining.length === error.errors.length && remaining.every((child, index) => child === error.errors[index])
    ? [error]
    : remaining;
}

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
    let reported = false;
    // Register joining before work children, so they halt before their pending Promise is joined.
    yield* ensure(function*() {
      if (pending) {
        yield* call(async () => {
          try {
            await pending;
          } catch (error) {
            if (reported) return;
            const failures = remainingFailures(error, signal.reason);
            if (failures.length === 1) throw failures[0];
            if (failures.length) throw new AggregateError(failures, "I/O cleanup failed during cancellation");
          }
        });
      }
    });
    try {
      signal.throwIfAborted();
      pending = start(signal, yield* useScope());
      return yield* call(() => pending!);
    } catch (error) {
      reported = true;
      throw error;
    } finally {
      // Abort before child teardown; joining is the registered resource's responsibility.
      controller.abort();
    }
  });
}
