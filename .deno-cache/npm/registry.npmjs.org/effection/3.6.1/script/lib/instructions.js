"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suspend = suspend;
exports.action = action;
exports.spawn = spawn;
exports.resource = resource;
exports.getframe = getframe;
const deps_js_1 = require("./deps.js");
const shift_sync_js_1 = require("./shift-sync.js");
const result_js_1 = require("./result.js");
/**
 * Indefinitely pause execution of the current operation. It is typically
 * used in conjunction with an {@link action} to mark the boundary
 * between setup and teardown.
 *
 * ```js
 * function onEvent(listener, name) {
 *   return action(function* (resolve) {
 *     try {
 *       listener.addEventListener(name, resolve);
 *       yield* suspend();
 *     } finally {
 *       listener.removeEventListener(name, resolve);
 *     }
 *   });
 * }
 * ```
 *
 * An operation will remain suspended until its enclosing scope is destroyed,
 * at which point it proceeds as though return had been called from the point
 * of suspension. Once an operation suspends once, further suspend operations
 * are ignored.
 *
 * @returns an operation that suspends the current operation
 */
function suspend() {
    return instruction(Suspend);
}
function Suspend(frame) {
    return (0, shift_sync_js_1.shiftSync)((k) => {
        if (frame.aborted) {
            k.tail((0, result_js_1.Ok)(void 0));
        }
    });
}
function action(operation) {
    return instruction(function Action(frame) {
        return (0, deps_js_1.shift)(function* (k) {
            let settle = yield* (0, deps_js_1.reset)(function* () {
                let result = yield* (0, shift_sync_js_1.shiftSync)((k) => k.tail);
                let destruction = yield* child.destroy();
                if (!destruction.ok) {
                    k.tail(destruction);
                }
                else {
                    k.tail(result);
                }
            });
            let resolve = (value) => settle((0, result_js_1.Ok)(value));
            let reject = (error) => settle((0, result_js_1.Err)(error));
            let child = frame.createChild(function* () {
                let iterable = operation(resolve, reject);
                if (typeof iterable === "function") {
                    try {
                        yield* suspend();
                    }
                    finally {
                        iterable();
                    }
                }
                else {
                    yield* iterable;
                    yield* suspend();
                }
            });
            yield* (0, deps_js_1.reset)(function* () {
                let result = yield* child;
                if (!result.ok) {
                    k.tail(result);
                }
            });
            child.enter();
        });
    });
}
/**
 * Run another operation concurrently as a child of the current one.
 *
 * The spawned operation will begin executing immediately and control will
 * return to the caller when it reaches its first suspend point.
 *
 * ### Example
 *
 * ```typescript
 * import { main, sleep, suspend, spawn } from 'effection';
 *
 * await main(function*() {
 *   yield* spawn(function*() {
 *     yield* sleep(1000);
 *     console.log("hello");
 *   });
 *   yield* spawn(function*() {
 *     yield* sleep(2000);
 *     console.log("world");
 *   });
 *   yield* suspend();
 * });
 * ```
 *
 * You should prefer using the spawn operation over calling
 * {@link Scope.run} from within Effection code. The reason being that a
 * synchronous failure in the spawned operation will not be caught
 * until the next yield point when using `run`, which results in lines
 * being executed that should not.
 *
 * ### Example
 *
 * ```typescript
 * import { main, suspend, spawn, useScope } from 'effection';
 *
 * await main(function*() {
 *   yield* useScope();
 *
 *   scope.run(function*() {
 *    throw new Error('boom!');
 *   });
 *
 *   console.log('this code will run and probably should not');
 *
 *   yield* suspend(); // <- error is thrown after this.
 * });
 * ```
 * @param operation the operation to run as a child of the current task
 * @typeParam T the type that the spawned task evaluates to
 * @returns a {@link Task} representing a handle to the running operation
 */
function spawn(operation) {
    return instruction(function Spawn(frame) {
        return (0, deps_js_1.shift)(function (k) {
            let child = frame.createChild(operation);
            child.enter();
            k.tail((0, result_js_1.Ok)(child.getTask()));
            return (0, deps_js_1.reset)(function* () {
                let result = yield* child;
                if (!result.ok) {
                    yield* frame.crash(result.error);
                }
            });
        });
    });
}
/**
 * Define an Effection [resource](https://frontside.com/effection/docs/resources)
 *
 * Resources are a type of operation that passes a value back to its caller
 * while still allowing that operation to run in the background. It does this
 * by invoking the special `provide()` operation. The caller pauses until the
 * resource operation invokes `provide()` at which point the caller resumes with
 * passed value.
 *
 * `provide()` suspends the resource operation until the caller passes out of
 * scope.
 *
 * @example
 * ```javascript
 * function useWebSocket(url) {
 *   return resource(function*(provide) {
 *     let socket = new WebSocket(url);
 *     yield* once(socket, 'open');
 *
 *     try {
 *       yield* provide(socket);
 *     } finally {
 *       socket.close();
 *       yield* once(socket, 'close');
 *     }
 *   })
 * }
 *
 * await main(function*() {
 *   let socket = yield* useWebSocket("wss://example.com");
 *   socket.send("hello world");
 * });
 * ```
 *
 * @param operation the operation defining the lifecycle of the resource
 * @returns an operation yielding the resource
 */
function resource(operation) {
    return instruction((frame) => (0, deps_js_1.shift)(function (k) {
        function provide(value) {
            k.tail((0, result_js_1.Ok)(value));
            return suspend();
        }
        let child = frame.createChild(() => operation(provide));
        child.enter();
        return (0, deps_js_1.reset)(function* () {
            let result = yield* child;
            if (!result.ok) {
                k.tail(result);
                yield* frame.crash(result.error);
            }
        });
    }));
}
/**
 * @ignore
 */
function getframe() {
    return instruction((frame) => (0, shift_sync_js_1.shiftSync)((k) => k.tail((0, result_js_1.Ok)(frame))));
}
// An optimized iterator that yields the instruction on the first call
// to next, then returns its value on the second. Equivalent to:
// {
//  *[Symbol.iterator]() { return yield instruction; }
// }
function instruction(i) {
    return {
        [Symbol.iterator]() {
            let entered = false;
            return {
                next(value) {
                    if (!entered) {
                        entered = true;
                        return { done: false, value: i };
                    }
                    else {
                        return { done: true, value };
                    }
                },
                throw(error) {
                    throw error;
                },
            };
        },
    };
}
//# sourceMappingURL=instructions.js.map