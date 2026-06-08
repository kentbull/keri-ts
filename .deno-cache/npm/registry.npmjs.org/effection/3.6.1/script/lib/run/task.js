"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTask = createTask;
const deps_js_1 = require("../deps.js");
const result_js_1 = require("../result.js");
const instructions_js_1 = require("../instructions.js");
const create_js_1 = require("./create.js");
function createTask(frame) {
    let promise;
    let awaitResult = (resolve, reject) => {
        (0, deps_js_1.evaluate)(function* () {
            let result = getResult(yield* frame);
            if (result.ok) {
                resolve(result.value);
            }
            else {
                reject(result.error);
            }
        });
    };
    let getPromise = () => {
        promise = new Promise((resolve, reject) => {
            awaitResult(resolve, reject);
        });
        getPromise = () => promise;
        return promise;
    };
    let task = (0, create_js_1.create)("Task", {}, {
        *[Symbol.iterator]() {
            let frameResult = (0, deps_js_1.evaluate)(() => frame);
            if (frameResult) {
                let result = getResult(frameResult);
                if (result.ok) {
                    return result.value;
                }
                else {
                    throw result.error;
                }
            }
            else {
                return yield* (0, instructions_js_1.action)(function* (resolve, reject) {
                    awaitResult(resolve, reject);
                });
            }
        },
        then: (...args) => getPromise().then(...args),
        catch: (...args) => getPromise().catch(...args),
        finally: (...args) => getPromise().finally(...args),
        halt() {
            let haltPromise;
            let getHaltPromise = () => {
                haltPromise = new Promise((resolve, reject) => {
                    awaitHaltResult(resolve, reject);
                });
                getHaltPromise = () => haltPromise;
                frame.destroy();
                return haltPromise;
            };
            let awaitHaltResult = (resolve, reject) => {
                (0, deps_js_1.evaluate)(function* () {
                    let { destruction } = yield* frame;
                    if (destruction.ok) {
                        resolve();
                    }
                    else {
                        reject(destruction.error);
                    }
                });
            };
            return (0, create_js_1.create)("Future", {}, {
                *[Symbol.iterator]() {
                    let result = (0, deps_js_1.evaluate)(() => frame);
                    if (result) {
                        if (!result.ok) {
                            throw result.error;
                        }
                    }
                    else {
                        yield* (0, instructions_js_1.action)(function* (resolve, reject) {
                            awaitHaltResult(resolve, reject);
                            frame.destroy();
                        });
                    }
                },
                then: (...args) => getHaltPromise().then(...args),
                catch: (...args) => getHaltPromise().catch(...args),
                finally: (...args) => getHaltPromise().finally(...args),
            });
        },
    });
    return task;
}
function getResult(result) {
    if (!result.ok) {
        return result;
    }
    else if (result.exit.type === "aborted") {
        return (0, result_js_1.Err)(Error("halted"));
    }
    else if (result.exit.type === "crashed") {
        return (0, result_js_1.Err)(result.exit.error);
    }
    else {
        return result.exit.result;
    }
}
//# sourceMappingURL=task.js.map