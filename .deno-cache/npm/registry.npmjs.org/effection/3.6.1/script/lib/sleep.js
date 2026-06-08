"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
const instructions_js_1 = require("./instructions.js");
/**
 * Sleep for the given amount of milliseconds.
 *
 * @example
 * ```typescript
 * import { main, sleep } from 'effection';
 *
 * await main(function*() {
 *   yield* sleep(2000);
 *   console.log("Hello lazy world!");
 * });
 * ```
 *
 * @param duration - the number of milliseconds to sleep
 */
function sleep(duration) {
    return (0, instructions_js_1.action)((resolve) => {
        let timeoutId = setTimeout(resolve, duration);
        return () => clearTimeout(timeoutId);
    });
}
//# sourceMappingURL=sleep.js.map