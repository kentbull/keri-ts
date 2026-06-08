"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.call = call;
exports.until = until;
const instructions_js_1 = require("./instructions.js");
const pause_js_1 = require("./pause.js");
function call(callable) {
    return (0, instructions_js_1.action)(function* (resolve, reject) {
        try {
            if (typeof callable === "function") {
                let fn = callable;
                resolve(yield* toop(fn()));
            }
            else {
                resolve(yield* toop(callable));
            }
        }
        catch (error) {
            reject(error);
        }
    });
}
function toop(op) {
    if (isPromise(op)) {
        return expect(op);
    }
    else if (isIterable(op)) {
        let iter = op[Symbol.iterator]();
        if (isInstructionIterator(iter)) {
            // operation
            return op;
        }
        else {
            // We are assuming that if an iterator does *not* have `.throw` then
            // it must be a built-in iterator and we should return the value as-is.
            return bare(op);
        }
    }
    else {
        return bare(op);
    }
}
function bare(val) {
    return {
        [Symbol.iterator]() {
            return { next: () => ({ done: true, value: val }) };
        },
    };
}
function expect(promise) {
    return (0, pause_js_1.pause)((resolve, reject) => {
        promise.then(resolve, reject);
        return () => { };
    });
}
function isFunc(f) {
    return typeof f === "function";
}
function isPromise(p) {
    if (!p)
        return false;
    return isFunc(p.then);
}
// iterator must implement both `.next` and `.throw`
// built-in iterators are not considered iterators to `call()`
function isInstructionIterator(it) {
    if (!it)
        return false;
    return isFunc(it.next) &&
        isFunc(it.throw);
}
function isIterable(it) {
    if (!it)
        return false;
    return typeof it[Symbol.iterator] === "function";
}
/**
 * It can be used to treat a promise as an operation. This function
 * is a replacement to the deprecated `call(promise)` function form.
 *
 * @example
 * ```js
 * let response = yield* until(fetch('https://google.com'));
 * ```
 * @template {T}
 * @param promise
 * @returns {Operation<T>}
 */
function until(promise) {
    return call(async () => await promise);
}
//# sourceMappingURL=call.js.map