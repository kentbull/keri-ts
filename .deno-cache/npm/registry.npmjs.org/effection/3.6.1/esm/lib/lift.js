import { shift } from "./deps.js";
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
export function lift(fn) {
    return (...args) => {
        return ({
            *[Symbol.iterator]() {
                return yield () => {
                    return shift(function* (k) {
                        k.tail({ ok: true, value: fn(...args) });
                    });
                };
            },
        });
    };
}
//# sourceMappingURL=lift.js.map