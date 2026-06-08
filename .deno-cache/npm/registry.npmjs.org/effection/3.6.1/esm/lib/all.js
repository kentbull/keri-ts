import { spawn } from "./instructions.js";
import { call } from "./call.js";
/**
 * Block and wait for all of the given operations to complete. Returns
 * an array of values that the given operations evaluated to. This has
 * the same purpose as
 * [Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all).
 *
 * If any of the operations become errored, then `all` will also become errored.
 *
 * ### Example
 *
 * ``` javascript
 * import { all, expect, main } from 'effection';
 *
 * await main(function*() {
 *  let [google, bing] = yield* all([
 *    expect(fetch('http://google.com')),
 *    expect(fetch('http://bing.com')),
 *   ]);
 *  // ...
 * });
 * ```
 *
 * @param ops a list of operations to wait for
 * @returns the list of values that the operations evaluate to, in the order they were given
 */
export function all(ops) {
    return call(function* () {
        let tasks = [];
        for (let operation of ops) {
            tasks.push(yield* spawn(() => operation));
        }
        let results = [];
        for (let task of tasks) {
            results.push(yield* task);
        }
        return results;
    });
}
//# sourceMappingURL=all.js.map