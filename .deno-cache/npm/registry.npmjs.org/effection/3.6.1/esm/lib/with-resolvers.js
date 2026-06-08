import { Err, Ok } from "./result.js";
import { action } from "./instructions.js";
/**
 * Create an {link @Operation} and two functions to resolve or reject
 * it, corresponding to the two parameters passed to the executor of
 * the {@link action} constructor. This is the Effection equivalent of
 * [Promise.withResolvers()]{@link
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers}
 *
 * @returns an operation and its resolvers.
 */
export function withResolvers() {
    let continuations = new Set();
    let result = undefined;
    let operation = action((resolve, reject) => {
        let settle = (outcome) => {
            if (outcome.ok) {
                resolve(outcome.value);
            }
            else {
                reject(outcome.error);
            }
        };
        if (result) {
            settle(result);
            return () => { };
        }
        else {
            continuations.add(settle);
            return () => continuations.delete(settle);
        }
    });
    let settle = (outcome) => {
        if (!result) {
            result = outcome;
        }
        for (let continuation of continuations) {
            continuation(result);
        }
    };
    let resolve = (value) => settle(Ok(value));
    let reject = (error) => settle(Err(error));
    return { operation, resolve, reject };
}
//# sourceMappingURL=with-resolvers.js.map