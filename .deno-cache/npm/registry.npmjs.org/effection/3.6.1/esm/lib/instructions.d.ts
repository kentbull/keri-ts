import type { Frame, Operation, Provide, Reject, Resolve, Task } from "./types.js";
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
export declare function suspend(): Operation<void>;
/**
 * Create an {@link Operation} that can be either resolved (or rejected) with
 * a synchronous callback. This is the Effection equivalent of `new Promise()`.
 *
 * The action body is a function that enters the effect, and returns a function that
 * will be called to exit the action..
 *
 * For example:
 *
 * ```js
 * let five = yield* action((resolve, reject) => {
 *   let timeout = setTimeout(() => {
 *     if (Math.random() > 5) {
 *       resolve(5)
 *     } else {
 *       reject(new Error("bad luck!"));
 *     }
 *   }, 1000);
 *   return () => clearTimeout(timeout);
 * });
 * ```
 *
 * @typeParam T - type of the action's result.
 * @param body - enter and exit the action
 * @returns an operation producing the resolved value, or throwing the rejected error
 */
export declare function action<T>(enter: (resolve: Resolve<T>, reject: Reject) => () => void): Operation<T>;
/**
 * @deprecated `action()` used with an operation will be removed in v4.
 */
export declare function action<T>(operation: (resolve: Resolve<T>, reject: Reject) => Operation<void>): Operation<T>;
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
export declare function spawn<T>(operation: () => Operation<T>): Operation<Task<T>>;
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
export declare function resource<T>(operation: (provide: Provide<T>) => Operation<void>): Operation<T>;
/**
 * @ignore
 */
export declare function getframe(): Operation<Frame>;
//# sourceMappingURL=instructions.d.ts.map