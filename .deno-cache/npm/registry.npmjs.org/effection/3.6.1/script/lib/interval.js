"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interval = interval;
const instructions_js_1 = require("./instructions.js");
const signal_js_1 = require("./signal.js");
/**
 * Consume an interval as an infinite stream.
 *
 * ```ts
 * let startTime = Date.now();
 *
 * for (let _ of yield* each(interval(10))) {
 *   let elapsed = Date.now() - startTime;
 *   console.log(`elapsed time: ${elapsed} ms`);
 *   yield* each.next();
 * }
 * ```
 * @param milliseconds - how long to delay between each item in the stream
 */
function interval(milliseconds) {
    return (0, instructions_js_1.resource)(function* (provide) {
        let signal = (0, signal_js_1.createSignal)();
        let id = setInterval(signal.send, milliseconds);
        try {
            yield* provide(yield* signal);
        }
        finally {
            clearInterval(id);
        }
    });
}
//# sourceMappingURL=interval.js.map