import { call, ensure, type Operation, type Scope, useScope } from "npm:effection@^3.6.0";

/**
 * Remove only this operation's cancellation from joined I/O failures.
 *
 * @param error Failure observed while joining work; may contain nested AggregateErrors.
 * @param cancellation Exact owned abort reason to remove by identity.
 * @returns Remaining foreign failures, preserving an unchanged aggregate when possible.
 */
function remainingFailures(error: unknown, cancellation: unknown): unknown[] {
  if (error === cancellation) return [];
  if (!(error instanceof AggregateError)) return [error];
  const remaining = error.errors.flatMap((child) => remainingFailures(child, cancellation));
  return remaining.length === error.errors.length && remaining.every((child, index) => child === error.errors[index])
    ? [error]
    : remaining;
}

/**
 * Preserve foreign cleanup failures, removing only this owner's exact abort reason.
 *
 * @param error Failure observed during joined cleanup.
 * @param signal Owner signal whose exact reason may be suppressed.
 * @throws The original foreign failure, or an AggregateError containing multiple remaining failures.
 */
export function rethrowCleanupFailure(error: unknown, signal: AbortSignal): void {
  const failures = remainingFailures(error, signal.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "I/O cleanup failed during cancellation");
}

/**
 * Own one cancellable Promise leaf inside an Effection operation.
 * The leaf must observe its signal; teardown aborts it and joins its cleanup before returning.
 * An isolated call scope keeps cancellation abrupt even while finalization yields.
 * Register dependent owner resources before this leaf so reverse teardown joins it before disposal.
 * Owned concurrent work uses the supplied leaf scope, so its signal aborts before child cleanup joins.
 * Borrow that scope only for work joined within the leaf, never for later operations.
 *
 * @param start Starts the Promise leaf with an owned signal and scope; must observe abort and join any work borrowed from that scope.
 * @param upstream Optional caller cancellation combined with the leaf's own signal.
 * @returns The leaf result after successful completion; scope teardown joins pending work.
 * @throws The leaf error or a foreign cleanup failure; exact owned cancellation is filtered during cleanup.
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
            rethrowCleanupFailure(error, signal);
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
