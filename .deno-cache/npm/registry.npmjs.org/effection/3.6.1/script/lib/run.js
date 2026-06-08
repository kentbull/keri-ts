"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const frame_js_1 = require("./run/frame.js");
__exportStar(require("./run/scope.js"), exports);
/**
 * Execute an operation.
 *
 * Run is an entry point into Effection, and is especially useful when
 * embedding Effection code into existing code. However, If you are writing your
 * whole program using Effection, you should prefer {@link main}.
 *
 * @example
 * ```javascript
 * import { run, useAbortSignal } from 'effection';
 *
 * async function fetchExample() {
 *   await run(function*() {
 *     let signal = yield* useAbortSignal();
 *     let response = yield* call(() => fetch('http://www.example.com', { signal }));
 *     yield* call(() => response.text());
 *   });
 * });
 * ```
 *
 * Run will create a new top-level scope for the operation. However, to run an
 * operation in an existing scope, you can use {@link Scope.run}.
 *
 * @param operation the operation to run
 * @returns a task representing the running operation.
 */
function run(operation) {
    let frame = (0, frame_js_1.createFrame)({ operation });
    frame.enter();
    return frame.getTask();
}
//# sourceMappingURL=run.js.map