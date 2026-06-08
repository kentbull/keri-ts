import { evaluate, shift } from "../deps.js";
import { shiftSync } from "../shift-sync.js";
import { lazy } from "../lazy.js";
import { Err, Ok } from "../result.js";
import { createValue } from "./value.js";
import { createTask } from "./task.js";
import { create } from "./create.js";
let ids = 0;
export function createFrame(options) {
    return evaluate(function* () {
        let { operation, parent } = options;
        let children = new Set();
        let context = Object.create(parent ?? {});
        let thunks = [{
                done: false,
                value: $next(void 0),
            }];
        let crash = void 0;
        let interrupt = () => { };
        let [setResults, results] = yield* createValue();
        let frame = yield* shiftSync((k) => {
            let self = create("Frame", { id: ids++, context }, {
                createChild(operation) {
                    let child = createFrame({ operation, parent: self.context });
                    children.add(child);
                    evaluate(function* () {
                        yield* child;
                        children.delete(child);
                    });
                    return child;
                },
                getTask() {
                    let task = createTask(self);
                    self.getTask = () => task;
                    return task;
                },
                enter() {
                    k.tail(self);
                },
                crash(error) {
                    abort(error);
                    return results;
                },
                destroy() {
                    abort();
                    return results;
                },
                [Symbol.iterator]: results[Symbol.iterator],
            });
            let abort = (reason) => {
                if (!self.aborted) {
                    self.aborted = true;
                    crash = reason;
                    thunks.unshift({ done: false, value: $abort() });
                    interrupt();
                }
            };
            return self;
        });
        let iterator = lazy(() => operation()[Symbol.iterator]());
        let thunk = thunks.pop();
        while (!thunk.done) {
            let getNext = thunk.value;
            try {
                let next = getNext(iterator());
                if (next.done) {
                    thunks.unshift({ done: true, value: Ok(next.value) });
                }
                else {
                    let instruction = next.value;
                    let outcome = yield* shift(function* (k) {
                        interrupt = () => k.tail({ type: "interrupted" });
                        try {
                            k.tail({
                                type: "settled",
                                result: yield* instruction(frame),
                            });
                        }
                        catch (error) {
                            k.tail({ type: "settled", result: Err(error) });
                        }
                    });
                    if (outcome.type === "settled") {
                        if (outcome.result.ok) {
                            thunks.unshift({
                                done: false,
                                value: $next(outcome.result.value),
                            });
                        }
                        else {
                            thunks.unshift({
                                done: false,
                                value: $throw(outcome.result.error),
                            });
                        }
                    }
                }
            }
            catch (error) {
                thunks.unshift({ done: true, value: Err(error) });
            }
            thunk = thunks.pop();
        }
        frame.exited = true;
        let result = thunk.value;
        let exit;
        if (!result.ok) {
            exit = { type: "result", result };
        }
        else if (crash) {
            exit = { type: "crashed", error: crash };
        }
        else if (frame.aborted) {
            exit = { type: "aborted" };
        }
        else {
            exit = { type: "result", result };
        }
        let destruction = Ok(void 0);
        while (children.size !== 0) {
            for (let child of [...children].reverse()) {
                let teardown = yield* child.destroy();
                if (!teardown.ok) {
                    destruction = teardown;
                }
            }
        }
        if (!destruction.ok) {
            setResults({ ok: false, error: destruction.error, exit, destruction });
        }
        else {
            if (exit.type === "aborted") {
                setResults({ ok: true, value: void 0, exit, destruction });
            }
            else if (exit.type === "result") {
                let { result } = exit;
                if (result.ok) {
                    setResults({ ok: true, value: void 0, exit, destruction });
                }
                else {
                    setResults({ ok: false, error: result.error, exit, destruction });
                }
            }
            else {
                setResults({ ok: false, error: exit.error, exit, destruction });
            }
        }
    });
}
// deno-lint-ignore no-explicit-any
const $next = (value) => function $next(i) {
    return i.next(value);
};
const $throw = (error) => function $throw(i) {
    if (i.throw) {
        return i.throw(error);
    }
    else {
        throw error;
    }
};
const $abort = (value) => function $abort(i) {
    if (i.return) {
        return i.return(value);
    }
    else {
        return { done: true, value };
    }
};
//# sourceMappingURL=frame.js.map