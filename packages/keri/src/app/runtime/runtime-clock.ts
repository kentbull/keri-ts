/** Opaque timer handle returned by the selected clock implementation. */
export type RuntimeTimer = unknown;

/** Wall time and timers shared by timeout-sensitive operations; timestamps use epoch milliseconds and delays use elapsed milliseconds. */
export interface RuntimeClock {
  /**
   * Read the current epoch time in milliseconds.
   *
   * @returns Current epoch wall time in milliseconds; persistence consumers must not substitute a process-relative timer.
   */
  now(): number;
  /**
   * Schedule one callback after the requested elapsed milliseconds.
   *
   * @param callback One-shot callback invoked after the delay; cancellation prevents a still-pending invocation.
   * @param ms Elapsed delay in milliseconds, not an epoch timestamp.
   * @returns Opaque handle that must be cancelled through this same clock.
   */
  setTimeout(callback: () => void, ms: number): RuntimeTimer;
  /**
   * Cancel a timer acquired from this clock.
   *
   * @param timer Handle returned by this clock's setTimeout.
   */
  clearTimeout(timer: RuntimeTimer): void;
}

/** Production clock; application composition supplies it to its consumers. */
export const systemClock: RuntimeClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (timer: RuntimeTimer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
