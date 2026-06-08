import type { Operation, Yielded } from "./types.js";
/**
 * Race the given operations against each other and return the value of
 * whichever operation returns first. This has the same purpose as
 * [Promise.race](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race).
 *
 * If an operation become errored first, then `race` will fail with this error.
 * After the first operation wins the race, all other operations will become
 * halted and therefore cannot throw any further errors.
 *
 * @example
 *
 * ```typescript
 * import { main, race, fetch } from 'effection';
 *
 * await main(function*() {
 *  let fastest = yield* race([fetch('http://google.com'), fetch('http://bing.com')]);
 *  // ...
 * });
 * ```
 *
 * @param operations a list of operations to race against each other
 * @returns the value of the fastest operation
 */
export declare function race<T extends Operation<unknown>>(operations: readonly T[]): Operation<Yielded<T>>;
//# sourceMappingURL=race.d.ts.map