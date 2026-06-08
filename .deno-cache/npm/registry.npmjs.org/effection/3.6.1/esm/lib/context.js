import { create } from "./run/create.js";
import { useScope } from "./run/scope.js";
export function createContext(key, defaultValue) {
    let context = create(`Context`, { key }, {
        defaultValue,
        *get() {
            let scope = yield* useScope();
            return scope.get(context);
        },
        *set(value) {
            let scope = yield* useScope();
            return scope.set(context, value);
        },
        expect,
        *with(value, operation) {
            let scope = yield* useScope();
            let original = scope.hasOwn(context) ? scope.get(context) : undefined;
            try {
                return yield* operation(scope.set(context, value));
            }
            finally {
                if (typeof original === "undefined") {
                    scope.delete(context);
                }
                else {
                    scope.set(context, original);
                }
            }
        },
        [Symbol.iterator]() {
            console.warn(`⚠️ using a context (${key}) directly as an operation is deprecated. Use context.expect() instead`);
            context[Symbol.iterator] = expect;
            return expect();
        },
    });
    function* expect() {
        let value = yield* context.get();
        if (typeof value === "undefined") {
            throw new MissingContextError(`missing required context: '${key}'`);
        }
        else {
            return value;
        }
    }
    return context;
}
class MissingContextError extends Error {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "name", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "MissingContextError"
        });
    }
}
//# sourceMappingURL=context.js.map