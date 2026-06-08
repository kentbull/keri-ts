import type { Operation } from "./types.js";
/**
 * A uniform integration type representing anything that can be evaluated
 * as a the parameter to {@link call}.
 *
 * {@link call} converts a `Callable` into an `Operation` which can then be used
 * anywhere within Effection.
 *
 * APIs that accept `Callable` values allow end developers to pass simple
 * functions without necessarily needing to know anything about Operations.
 *
 * ```javascript
 * function hello(to: Callable<string>): Operation<string> {
 *   return function*() {
 *     return `hello ${yield* call(to)}`;
 *   }
 * }
 *
 * await run(() => hello(() => "world!")); // => "hello world!"
 * await run(() => hello(async () => "world!")); // => "hello world!"
 * await run(() => hello(function*() { return "world!" })); "hello world!";
 * ```
 */
export type Callable<T> = Operation<T> | Promise<T> | (() => Operation<T>) | (() => Promise<T>) | (() => T);
/**
 * Pause the current operation, then run an async function, or operation function in a new scope. The calling operation will be resumed (or errored)
 * once call is completed.
 *
 * `call()` is a uniform integration point for calling async functions,
 * and generator functions.
 *
 * It can be used to invoke an async function:
 *
 * @example
 * ```typescript
 * async function* googleSlowly() {
 *   return yield* call(async function() {
 *     await new Promise(resolve => setTimeout(resolve, 2000));
 *     return await fetch("https://google.com");
 *   });
 * }
 * ```
 *
 * It can be used to run an operation in a separate scope to ensure that any
 * resources allocated will be cleaned up:
 *
 * @example
 * ```javascript
 * yield* call(function*() {
 *   let socket = yield* useSocket();
 *   return yield* socket.read();
 * }); // => socket is destroyed before returning
 * ```
 *
 * Because `call()` runs within its own {@link Scope}, it can also be used to
 * establish [error boundaries](https://frontside.com/effection/docs/errors).
 *
 * @example
 * ```javascript
 * function* myop() {
 *   let task = yield* spawn(function*() {
 *     throw new Error("boom!");
 *   });
 *   yield* task;
 * }
 *
 * function* runner() {
 *   try {
 *     yield* myop();
 *   } catch (err) {
 *     // this will never get hit!
 *   }
 * }
 *
 * function* runner() {
 *   try {
 *     yield* call(myop);
 *   } catch(err) {
 *     // properly catches `spawn` errors!
 *   }
 * }
 * ```
 *
 * @param callable the operation, promise, async function, generator funnction, or plain function to call as part of this operation
 */
export declare function call<T>(callable: () => Operation<T>): Operation<T>;
export declare function call<T>(callable: () => Promise<T>): Operation<T>;
/**
 * @deprecated Using call with simple functions will be removed in v4.
 * To convert simple functions into operations, use @{link lift}.
 */
export declare function call<T>(callable: () => T): Operation<T>;
/**
 * @deprecated calling bare promises, operations, and constants will
 * be removed in v4 use {@link until} instead
 *
 * before: call(operation);
 * after:  until(operation);
 */
export declare function call<T>(callable: Operation<T>): Operation<T>;
/**
 * @deprecated calling bare promises, operations, and constants will
 * be removed in v4, always pass a function to call()
 *
 * before: call(promise);
 * after:  call(() => promise);
 */
export declare function call<T>(callable: Promise<T>): Operation<T>;
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
export declare function until<T>(promise: PromiseLike<T>): Operation<T>;
//# sourceMappingURL=call.d.ts.map