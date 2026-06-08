"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoped = scoped;
const call_js_1 = require("./call.js");
/**
 * Encapsulate an operation so that no effects will persist outside of
 * it. All active effects such as concurrent tasks and resources will be
 * shut down, and all contexts will be restored to their values outside
 * of the scope.
 *
 * @example
 * ```js
 * import { useAbortSignal } from "effection";

 * function* example() {
 *   let signal = yield* scoped(function*() {
 *     return yield* useAbortSignal();
 *   });
 *   return signal.aborted; //=> true
 * }
 * ```
 *
 * @param operation - the operation to be encapsulated
 *
 * @returns the scoped operation
 */
function scoped(operation) {
    return (0, call_js_1.call)(operation);
}
//# sourceMappingURL=scoped.js.map