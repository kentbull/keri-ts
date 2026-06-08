"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribe = subscribe;
exports.stream = stream;
const call_js_1 = require("./call.js");
/**
 * Convert any [`AsyncIterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) into an effection {@link Subscription}
 *
 * This allows you to consume any `AsyncIterator` as a {@link Subscription}.
 *
 * @param iter - the iterator to convert
 * @returns a subscription that will produce each item of `iter`
 */
function subscribe(iter) {
    return {
        next: () => (0, call_js_1.call)(() => iter.next()),
    };
}
/**
 * Convert any [`AsyncIterable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols) into an Effection {@link Stream}.
 *
 * This allows you to consume any `AsyncIterable` as a {@link Stream}.
 *
 * @param iterable - the async iterable to convert
 * @returns a stream that will produce each item of `iterable`
 */
function stream(iterable) {
    return {
        *[Symbol.iterator]() {
            return subscribe(iterable[Symbol.asyncIterator]());
        },
    };
}
//# sourceMappingURL=async.js.map