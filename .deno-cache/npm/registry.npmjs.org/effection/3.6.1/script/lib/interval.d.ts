import type { Stream } from "./types.js";
/**
 * Consume an interval as an infinite stream.
 *
 * ```ts
 * let startTime = Date.now();
 *
 * for (let _ of yield* each(interval(10))) {
 *   let elapsed = Date.now() - startTime;
 *   console.log(`elapsed time: ${elapsed} ms`);
 *   yield* each.next();
 * }
 * ```
 * @param milliseconds - how long to delay between each item in the stream
 */
export declare function interval(milliseconds: number): Stream<void, never>;
//# sourceMappingURL=interval.d.ts.map