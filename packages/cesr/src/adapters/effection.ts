import { call, type Operation, resource, type Stream } from "npm:effection@^3.6.0";
import type { CesrFrame } from "../core/types.ts";
import { parse, type ParseOptions } from "../parser/progressive.ts";

/** One pull-only Effection subscription; frame consumption supplies the next input credit. */
export interface FrameChannel {
  /** Consume with `yield* each(...)`; each channel permits one subscription only. */
  readonly frames: Stream<CesrFrame, void>;
}

/**
 * Own a progressive parser in the caller's Effection scope.
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
    async function* input(): AsyncGenerator<Uint8Array> {
      yield* source(controller.signal);
    }
    const parser = parse(input(), { ...options, signal: controller.signal });
    let subscribed = false; // One source has one position; this stream is not a broadcast channel.
    let pending: Promise<IteratorResult<CesrFrame, void>> | undefined;
    let closing: Promise<void> | undefined;

    /** Abort before joining, allowing a blocked cooperative source to finish its finally block. */
    function close(): Promise<void> {
      return closing ??= (async () => {
        controller.abort();
        const unclaimed = await pending?.catch(() => undefined);
        // Cancellation may win after parsing completes but before next() hands
        // ownership to its Operation caller. Dispose that one undelivered frame.
        try {
          if (unclaimed && !unclaimed.done) await unclaimed.value.essr?.discard();
        } finally {
          await parser.return(undefined);
        }
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
                  try {
                    const result = yield* call(() => pending!);
                    delivered = true;
                    return result;
                  } finally {
                    // Halting only this next() must also cancel the in-flight parser read.
                    if (!delivered) yield* call(close);
                    pending = undefined;
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
