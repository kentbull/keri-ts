"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.each = each;
const context_js_1 = require("./context.js");
const scope_js_1 = require("./run/scope.js");
const instructions_js_1 = require("./instructions.js");
const with_resolvers_js_1 = require("./with-resolvers.js");
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
function each(stream) {
    return {
        *[Symbol.iterator]() {
            let scope = yield* (0, scope_js_1.useScope)();
            let stack = scope.hasOwn(EachStack)
                ? scope.expect(EachStack)
                : yield* EachStack.set([]);
            let loop = yield* (0, instructions_js_1.resource)(function* (provide) {
                let subscription = yield* stream;
                let current = yield* subscription.next();
                let { operation: finished, resolve: finish } = (0, with_resolvers_js_1.withResolvers)();
                yield* (0, instructions_js_1.spawn)(() => provide({ current, subscription, finish }));
                yield* finished;
            });
            stack.push(loop);
            let iterator = {
                next() {
                    if (loop.stale) {
                        let error = new Error(`for each loop did not use each.next() operation before continuing`);
                        error.name = "IterationError";
                        throw error;
                    }
                    else {
                        loop.stale = true;
                        return loop.current;
                    }
                },
                return() {
                    stack.pop();
                    loop.finish();
                    return { done: true, value: void 0 };
                },
            };
            return {
                [Symbol.iterator]: () => iterator,
            };
        },
    };
}
each.next = function next() {
    return {
        name: "each.next()",
        *[Symbol.iterator]() {
            let stack = yield* EachStack.expect();
            let context = stack[stack.length - 1];
            if (!context) {
                let error = new Error(`cannot call next() outside of an iteration`);
                error.name = "IterationError";
                throw error;
            }
            let current = yield* context.subscription.next();
            delete context.stale;
            context.current = current;
            if (current.done) {
                stack.pop();
            }
        },
    };
};
const EachStack = (0, context_js_1.createContext)("each");
//# sourceMappingURL=each.js.map