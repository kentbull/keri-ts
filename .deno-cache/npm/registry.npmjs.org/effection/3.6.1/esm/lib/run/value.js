import { reset } from "../deps.js";
import { shiftSync } from "../shift-sync.js";
export function* createValue() {
    let result = void 0;
    let listeners = new Set();
    let resolve = yield* reset(function* () {
        let value = yield* shiftSync((k) => k.tail);
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
                return shiftSync((k) => {
                    listeners.add(k.tail);
                })[Symbol.iterator]();
            }
        },
    };
    return [resolve, event];
}
export function sync(value) {
    return {
        next() {
            return { done: true, value };
        },
    };
}
//# sourceMappingURL=value.js.map