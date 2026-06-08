import type { Operation } from "./types.js";
/**
 * Convert a simple function into an {@link Operation}
 *
 * @example
 * ```javascript
 * let log = lift((message) => console.log(message));
 *
 * export function* run() {
 *   yield* log("hello world");
 *   yield* log("done");
 * }
 * ```
 *
 * @returns a function returning an operation that invokes `fn` when evaluated
 */
export declare function lift<TArgs extends unknown[], TReturn>(fn: (...args: TArgs) => TReturn): (...args: TArgs) => Operation<TReturn>;
//# sourceMappingURL=lift.d.ts.map