import { evaluate } from "../deps.js";
import { create } from "./create.js";
import { createFrame } from "./frame.js";
import { getframe, suspend } from "../instructions.js";
/**
 * Get the scope of the currently running {@link Operation}.
 *
 * @returns an operation yielding the current scope
 */
export function* useScope() {
    let frame = yield* getframe();
    let [scope] = createScope(frame);
    return scope;
}
/* @ignore */
export function createScope(parent) {
    let frame = isScopeInternal(parent)
        ? parent.frame.createChild(suspend)
        : parent ?? createFrame({ operation: suspend });
    let scope = create("Scope", {}, {
        frame,
        run(operation) {
            if (frame.exited) {
                let error = new Error(`cannot call run() on a scope that has already been exited`);
                error.name = "InactiveScopeError";
                throw error;
            }
            let child = frame.createChild(operation);
            child.enter();
            evaluate(function* () {
                let result = yield* child;
                if (!result.ok) {
                    yield* frame.crash(result.error);
                }
            });
            return child.getTask();
        },
        get spawn() {
            let scope = this;
            return function spawn(operation) {
                return {
                    *[Symbol.iterator]() {
                        return scope.run(operation);
                    },
                };
            };
        },
        get(context) {
            let { key, defaultValue } = context;
            return (frame.context[key] ?? defaultValue);
        },
        set(context, value) {
            let { key } = context;
            frame.context[key] = value;
            return value;
        },
        expect(context) {
            let value = scope.get(context);
            if (typeof value === "undefined") {
                let error = new Error(context.key);
                error.name = `MissingContextError`;
                throw error;
            }
            return value;
        },
        delete(context) {
            let { key } = context;
            return delete frame.context[key];
        },
        hasOwn(context) {
            return !!Reflect.getOwnPropertyDescriptor(frame.context, context.key);
        },
    });
    frame.enter();
    return [scope, frame.getTask().halt];
}
function isScopeInternal(value) {
    return !!value && typeof value.run === "function";
}
//# sourceMappingURL=scope.js.map