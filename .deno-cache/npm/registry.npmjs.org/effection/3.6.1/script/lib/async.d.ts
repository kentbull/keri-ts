import type { Stream, Subscription } from "./types.js";
/**
 * Convert any [`AsyncIterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) into an effection {@link Subscription}
 *
 * This allows you to consume any `AsyncIterator` as a {@link Subscription}.
 *
 * @param iter - the iterator to convert
 * @returns a subscription that will produce each item of `iter`
 */
export declare function subscribe<T, R>(iter: AsyncIterator<T, R>): Subscription<T, R>;
/**
 * Convert any [`AsyncIterable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols) into an Effection {@link Stream}.
 *
 * This allows you to consume any `AsyncIterable` as a {@link Stream}.
 *
 * @param iterable - the async iterable to convert
 * @returns a stream that will produce each item of `iterable`
 */
export declare function stream<T, R>(iterable: AsyncIterable<T, R>): Stream<T, R>;
interface AsyncIterable<T, TReturn = unknown> {
    [Symbol.asyncIterator](): AsyncIterator<T, TReturn>;
}
export {};
//# sourceMappingURL=async.d.ts.map