import type { Operation } from "./types.js";
/**
 * The return type of {@link withResolvers}. It contains an operation bundled with
 * synchronous functions that determine its outcome.
 */
export interface WithResolvers<T> {
    operation: Operation<T>;
    /**
     * Cause {@link operation} to produce `value`. If either `resolve`
     * or`reject` has been called before, this will have no effect.
     *
     * @param value - the value to produce
     */
    resolve(value: T): void;
    /**
     * Cause {@link operation} to raise `Error`. Any calling operation
     * waiting on `operation` will. Yielding to `operation` subsequently
     * will also raise the same error. * If either `resolve` or`reject`
     * has been called before, this will have no effect.
     *
     * @param error - the error to raise
     */
    reject(error: Error): void;
}
/**
 * Create an {link @Operation} and two functions to resolve or reject
 * it, corresponding to the two parameters passed to the executor of
 * the {@link action} constructor. This is the Effection equivalent of
 * [Promise.withResolvers()]{@link
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers}
 *
 * @returns an operation and its resolvers.
 */
export declare function withResolvers<T>(): WithResolvers<T>;
//# sourceMappingURL=with-resolvers.d.ts.map