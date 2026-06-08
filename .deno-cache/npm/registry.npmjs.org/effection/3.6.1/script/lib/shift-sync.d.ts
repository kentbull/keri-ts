import { type Computation, type Continuation } from "./deps.js";
/**
 * Create a shift computation where the body of the shift can be resolved
 * in a single step.
 *
 * before:
 * ```ts
 * yield* shift(function*(k) { return k; });
 * ```
 * after:
 * yield* shiftSync(k => k);
 */
export declare function shiftSync<T>(block: (resolve: Continuation<T>, reject: Continuation<Error>) => void): Computation<T>;
//# sourceMappingURL=shift-sync.d.ts.map