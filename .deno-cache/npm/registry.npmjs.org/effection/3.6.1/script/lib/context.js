"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContext = createContext;
const create_js_1 = require("./run/create.js");
const scope_js_1 = require("./run/scope.js");
function createContext(key, defaultValue) {
    let context = (0, create_js_1.create)(`Context`, { key }, {
        defaultValue,
        *get() {
            let scope = yield* (0, scope_js_1.useScope)();
            return scope.get(context);
        },
        *set(value) {
            let scope = yield* (0, scope_js_1.useScope)();
            return scope.set(context, value);
        },
        expect,
        *with(value, operation) {
            let scope = yield* (0, scope_js_1.useScope)();
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