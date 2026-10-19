/** Opaque timer handle returned by the selected clock implementation. */
export type RuntimeTimer = unknown;

/** Wall time and timers shared by timeout-sensitive operations. Times are epoch milliseconds. */
export interface RuntimeClock {
  /** Read the current epoch time in milliseconds. */
  now(): number;
  /** Schedule one callback after the requested elapsed milliseconds. */
  setTimeout(callback: () => void, ms: number): RuntimeTimer;
  /** Cancel a timer acquired from this clock. */
  clearTimeout(timer: RuntimeTimer): void;
}

/** Production clock; application composition supplies it to its consumers. */
export const systemClock: RuntimeClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (timer: RuntimeTimer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});
