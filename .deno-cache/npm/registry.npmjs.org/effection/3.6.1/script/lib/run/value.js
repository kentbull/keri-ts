"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createValue = createValue;
exports.sync = sync;
const deps_js_1 = require("../deps.js");
const shift_sync_js_1 = require("../shift-sync.js");
function* createValue() {
    let result = void 0;
    let listeners = new Set();
    let resolve = yield* (0, deps_js_1.reset)(function* () {
        let value = yield* (0, shift_sync_js_1.shiftSync)((k) => k.tail);
        result = { value };
        for (let listener of listeners) {
            listeners.delete(listener);
            listener(value);
        }
    });
    let event = {
        [Symbol.iterator]() {
            if (result) {
                return sync(result.value);
            }
            else {
                return (0, shift_sync_js_1.shiftSync)((k) => {
                    listeners.add(k.tail);
                })[Symbol.iterator]();
            }
        },
    };
    return [resolve, event];
}
function sync(value) {
    return {
        next() {
            return { done: true, value };
        },
    };
}
//# sourceMappingURL=value.js.map