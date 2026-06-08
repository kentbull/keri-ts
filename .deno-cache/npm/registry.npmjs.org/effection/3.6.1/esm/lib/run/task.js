import { evaluate } from "../deps.js";
import { Err } from "../result.js";
import { action } from "../instructions.js";
import { create } from "./create.js";
export function createTask(frame) {
    let promise;
    let awaitResult = (resolve, reject) => {
        evaluate(function* () {
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
    let task = create("Task", {}, {
        *[Symbol.iterator]() {
            let frameResult = evaluate(() => frame);
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
                return yield* action(function* (resolve, reject) {
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
                evaluate(function* () {
                    let { destruction } = yield* frame;
                    if (destruction.ok) {
                        resolve();
                    }
                    else {
                        reject(destruction.error);
                    }
                });
            };
            return create("Future", {}, {
                *[Symbol.iterator]() {
                    let result = evaluate(() => frame);
                    if (result) {
                        if (!result.ok) {
                            throw result.error;
                        }
                    }
                    else {
                        yield* action(function* (resolve, reject) {
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
        return Err(Error("halted"));
    }
    else if (result.exit.type === "crashed") {
        return Err(result.exit.error);
    }
    else {
        return result.exit.result;
    }
}
//# sourceMappingURL=task.js.map