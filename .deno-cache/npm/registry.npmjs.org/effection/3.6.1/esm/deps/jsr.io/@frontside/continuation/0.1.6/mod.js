// deno-lint-ignore-file no-explicit-any
export function* reset(block) {
    return yield { type: "reset", block };
}
export function* shift(block) {
    return yield { type: "shift", block };
}
function createStack() {
    let list = [];
    return {
        reducing: false,
        push(...thunks) {
            return list.push(...thunks);
        },
        pop() {
            return list.pop();
        },
    };
}
export function evaluate(iterator) {
    let stack = createStack();
    stack.push({
        method: "next",
        iterator: iterator()[Symbol.iterator](),
    });
    return reduce(stack);
}
function reduce(stack) {
    try {
        stack.reducing = true;
        for (let current = stack.pop(); current; current = stack.pop()) {
            try {
                let next = getNext(current);
                stack.value = next.value;
                if (!next.done) {
                    let control = next.value;
                    if (control.type === "reset") {
                        stack.push({
                            ...current,
                            method: "next",
                            get value() {
                                return stack.value;
                            },
                        }, {
                            method: "next",
                            iterator: control.block()[Symbol.iterator](),
                        });
                    }
                    else {
                        let thunk = current;
                        let resolve = oneshot((value) => {
                            stack.push({
                                method: "next",
                                iterator: thunk.iterator,
                                value,
                            });
                            return reduce(stack);
                        });
                        resolve.tail = oneshot((value) => {
                            stack.push({
                                method: "next",
                                iterator: thunk.iterator,
                                value,
                            });
                            if (!stack.reducing) {
                                reduce(stack);
                            }
                        });
                        let reject = oneshot((error) => {
                            stack.push({
                                method: "throw",
                                iterator: thunk.iterator,
                                value: error,
                            });
                            return reduce(stack);
                        });
                        reject.tail = oneshot((error) => {
                            stack.push({
                                method: "throw",
                                iterator: thunk.iterator,
                                value: error,
                            });
                            if (!stack.reducing) {
                                reduce(stack);
                            }
                        });
                        stack.push({
                            method: "next",
                            iterator: control.block(resolve, reject)[Symbol.iterator](),
                            value: void 0,
                        });
                    }
                }
            }
            catch (error) {
                let top = stack.pop();
                if (top) {
                    stack.push({ ...top, method: "throw", value: error });
                }
                else {
                    throw error;
                }
            }
        }
    }
    finally {
        stack.reducing = false;
    }
    return stack.value;
}
function getNext(thunk) {
    let { iterator } = thunk;
    if (thunk.method === "next") {
        return iterator.next(thunk.value);
    }
    else {
        let value = thunk.value;
        if (iterator.throw) {
            return iterator.throw(value);
        }
        else {
            throw value;
        }
    }
}
function oneshot(fn) {
    let continued = false;
    let failure;
    let result;
    return ((value) => {
        if (!continued) {
            continued = true;
            try {
                return (result = fn(value));
            }
            catch (error) {
                failure = { error };
                throw error;
            }
        }
        else if (failure) {
            throw failure.error;
        }
        else {
            return result;
        }
    });
}
//# sourceMappingURL=mod.js.map