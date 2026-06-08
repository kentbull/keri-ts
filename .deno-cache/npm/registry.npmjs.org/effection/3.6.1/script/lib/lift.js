"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lift = lift;
const deps_js_1 = require("./deps.js");
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
function lift(fn) {
    return (...args) => {
        return ({
            *[Symbol.iterator]() {
                return yield () => {
                    return (0, deps_js_1.shift)(function* (k) {
                        k.tail({ ok: true, value: fn(...args) });
                    });
                };
            },
        });
    };
}
//# sourceMappingURL=lift.js.map