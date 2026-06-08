import type { Frame, Future, Operation, Scope } from "../types.js";
/**
 * Get the scope of the currently running {@link Operation}.
 *
 * @returns an operation yielding the current scope
 */
export declare function useScope(): Operation<Scope>;
/**
 * Create a new {@link Scope} as a child of `parent`, inheriting all its contexts.
 * along with a method to destroy the scope. Whenever the scope is destroyd, all
 * tasks and resources it contains will be halted.
 *
 * This function is used mostly by frameworks as an intergration point to enter
 * Effection.
 *
 * @example
 * ```js
 * import { createScope, sleep, suspend } from "effection";
 *
 * let [scope, destroy] = createScope();
 *
 * let delay = scope.run(function*() {
 *   yield* sleep(1000);
 * });
 * scope.run(function*() {
 *   try {
 *     yield* suspend();
 *    } finally {
 *      console.log('done!');
 *    }
 * });
 * await delay;
 * await destroy(); // prints "done!";
 * ```
 *
 * @param parent scope. If no parent is specified it will be free standing.
 * @returns a tuple containing the freshly created scope, along with a function to
 *          destroy it.
 */
export declare function createScope(parent?: Scope): [Scope, () => Future<void>];
export declare function createScope(parent: Frame): [Scope, () => Future<void>];
//# sourceMappingURL=scope.d.ts.map