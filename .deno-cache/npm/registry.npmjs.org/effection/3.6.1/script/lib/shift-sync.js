"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftSync = shiftSync;
const deps_js_1 = require("./deps.js");
/**
 * Create a shift computation where the body of the shift can be resolved
 * in a single step.
 *
 * before:
 * ```ts
 * yield* shift(function*(k) { return k; });
 * ```
 * after:
 * yield* shiftSync(k => k);
 */
function shiftSync(block) {
    return (0, deps_js_1.shift)((resolve, reject) => {
        return {
            [Symbol.iterator]: () => ({
                next() {
                    let value = block(resolve, reject);
                    return { done: true, value };
                },
            }),
        };
    });
}
//# sourceMappingURL=shift-sync.js.map