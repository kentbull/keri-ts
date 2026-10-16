import { call, type Operation, resource, type Stream } from "npm:effection@^3.6.0";
import type { CesrFrame } from "../core/types.ts";
import { parse, type ParseOptions } from "../parser/parser.ts";
/** One pull-only Effection subscription; consumption requests the next complete frame. */
export interface FrameChannel {
  /** Consume with `yield* each(...)`; each channel permits one subscription only. */
  readonly frames: Stream<CesrFrame, void>;
}
/**
 * Own a buffered parser in the caller's Effection scope.
 *
 * The source factory receives the same signal as the parser and must cancel its
 * pending I/O when that signal aborts. Scope exit aborts first, then joins the
 * pending read and iterator cleanup. No source reads or result queue run ahead
 * of the consumer. Import this optional integration from `cesr-ts/effection`.
 */
export function* toEffectionFrames(
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): Operation<FrameChannel> {
  return yield* resource<FrameChannel>(function*(provide) {
    // This resource owns cancellation; external aborts enter the same cleanup path.
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    // The factory is invoked lazily inside the parser so construction failures still close the resource.
    let sourceFailure: { error: unknown } | undefined;
    async function* input(): AsyncGenerator<Uint8Array> {
      try {
        yield* source(controller.signal);
      } catch (error) {
        sourceFailure = { error };
        throw error;
      }
    }
    const iterator = input(); // Retain source lifetime separately from the cursor's interruptible read.
    const parser = parse(iterator, { ...options, signal: controller.signal });
    let subscribed = false; // One source has one position; this stream is not a broadcast channel.
    let pending: Promise<IteratorResult<CesrFrame, void>> | undefined;
    let closing: Promise<void> | undefined;
    let reported: { error: unknown } | undefined;
    /** Abort before joining, allowing a blocked cooperative source to finish its finally block. */
    function close(): Promise<void> {
      return closing ??= (async () => {
        controller.abort();
        const errors: unknown[] = [];
        const reportedErrors = new Set<unknown>();
        const collectReported = (error: unknown): void => {
          if (reportedErrors.has(error)) return;
          reportedErrors.add(error);
          if (error instanceof AggregateError) {
            for (const child of error.errors) collectReported(child);
          }
        };
        if (reported) {
          collectReported(reported.error);
          if (reportedErrors.has(controller.signal.reason)) {
            for (const error of reportedErrors) {
              if (error !== controller.signal.reason && !(error instanceof AggregateError)) errors.push(error);
            }
          } else errors.push(reported.error);
        }
        const visited = new Set<unknown>();
        const note = (error: unknown) => {
          if (visited.has(error) || reportedErrors.has(error) || error === controller.signal.reason) return;
          visited.add(error);
          if (error instanceof AggregateError) {
            for (const child of error.errors) note(child);
          } else errors.push(error);
        };
        try {
          await pending;
        } catch (error) {
          note(error);
        }
        try {
          await parser.return(undefined);
        } catch (error) {
          note(error);
        }
        // Cursor abort wakes locally; the source may still be finishing its asynchronous cleanup.
        try {
          await iterator.return(undefined);
        } catch (error) {
          note(error);
        }
        if (sourceFailure) note(sourceFailure.error);
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, "Frame channel cleanup failed");
      })();
    }
    try {
      yield* provide({
        frames: {
          /** Subscribe once; no producer task or buffering queue is created. */
          *[Symbol.iterator]() {
            if (subscribed) throw new Error("Frame channel already has a subscriber");
            subscribed = true;
            return {
              /** Transfer one complete frame only after its input and framing checks finish. */
              next(): Operation<IteratorResult<CesrFrame, void>> {
                // Isolate teardown yields so halting next() cannot resume its caller with undefined.
                return call(function*() {
                  if (closing) throw new Error("Frame channel is closed");
                  if (pending) throw new Error("Frame channel cannot read concurrently");
                  pending = parser.next();
                  let delivered = false;
                  // Earlier resource teardown preserves late close failure even when this next() is halted.
                  yield* resource<void>(function*(hold) {
                    try {
                      yield* hold();
                    } finally {
                      if (!delivered) {
                        try {
                          yield* call(close);
                        } finally {
                          pending = undefined;
                        }
                      }
                    }
                  });
                  try {
                    const result = yield* call(() => pending!);
                    delivered = true;
                    return result;
                  } catch (error) {
                    reported = { error };
                    throw error;
                  } finally {
                    if (delivered) pending = undefined;
                  }
                });
              },
            };
          },
        },
      });
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      yield* call(close);
    }
  });
}
