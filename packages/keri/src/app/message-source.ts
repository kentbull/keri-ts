/** Buffered input iteration and joined parser/source cleanup shared by concrete input owners. */
import { parse } from "cesr-ts";
import { call, ensure, on, type Operation, race } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import { rethrowCleanupFailure } from "./abortable.ts";
import type { DispatchOptions, ProtocolProcessor } from "./protocol-processing.ts";

/** Protocol choices plus cancellation of this concrete source/parser lifetime. */
export interface IngressOptions extends DispatchOptions {
  /** Stops source reads and dispatch waiting, joining active cleanup before return. */
  signal?: AbortSignal;
}

/**
 * Consume complete frames through the supplied input-owned Kevery and shared protocol owner.
 * A pending read is joined before iterator return; cancellation cannot resume the
 * caller after disposal. The owning input operation borrows processors and acquires
 * no stores, queues, transport services or background workers here.
 */
export function* processMessages(
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  protocol: ProtocolProcessor,
  kvy: Kevery,
  options: IngressOptions = {},
): Operation<void> {
  const input = call(function*() {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      signal.throwIfAborted();
      const frames = parse(source(signal));
      let pending: ReturnType<typeof frames.next> | undefined;
      // This earlier resource joins I/O after dispatch/read children have stopped.
      yield* ensure(function*() {
        try {
          if (pending) {
            try {
              yield* call(() => pending!);
            } catch (error) {
              rethrowCleanupFailure(error, signal);
            }
          }
        } finally {
          yield* call(() => frames.return());
        }
      });
      while (true) {
        signal.throwIfAborted();
        pending = frames.next();
        let result: Awaited<typeof pending>;
        try {
          result = yield* call(() => pending!);
        } catch (error) {
          pending = undefined; // Already reported; the parser has joined its source cleanup.
          throw error;
        }
        pending = undefined;
        signal.throwIfAborted();
        if (result.done) return;
        yield* protocol.dispatch(result.value, options, kvy);
      }
    } finally {
      controller.abort();
    }
  });
  if (options.signal) {
    const signal = options.signal;
    yield* race([
      input,
      call(function*(): Operation<never> {
        const abort = yield* on(signal, "abort");
        signal.throwIfAborted();
        yield* abort.next();
        throw signal.reason;
      }),
    ]);
  } else yield* input;
}
