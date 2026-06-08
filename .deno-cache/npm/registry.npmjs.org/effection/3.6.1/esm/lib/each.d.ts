import type { Operation, Stream } from "./types.js";
/**
 * Consume an effection stream using a simple for-of loop.
 *
 * Given any stream, you can access its values sequentially using the `each()`
 * operation just as you would use `for await of` loop with an async iterable:
 *
 * ```javascript
 * function* logvalues(stream) {
 *   for (let value of yield* each(stream)) {
 *     console.log(value);
 *     yield* each.next()
 *   }
 * }
 * ```
 * You must always invoke `each.next` at the end of each iteration of the loop,
 * including if the interation ends with a `continue` statement.
 *
 * Note that just as with async iterators, there is no way to consume the
 * `TClose` value of a stream using the `for-each` loop.
 *
 * @typeParam T - the type of each value in the stream.
 * @param stream - the stream to iterate
 * @returns an operation to iterate `stream`
 */
export declare function each<T>(stream: Stream<T, unknown>): Operation<Iterable<T>>;
export declare namespace each {
    var next: () => Operation<void>;
}
//# sourceMappingURL=each.d.ts.map