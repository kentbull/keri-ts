import { shift } from "./deps.js";
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
export function shiftSync(block) {
    return shift((resolve, reject) => {
        return {
            [Symbol.iterator]: () => ({
                next() {
                    let value = block(resolve, reject);
                    return { done: true, value };
                },
            }),
        };
    });
}
//# sourceMappingURL=shift-sync.js.map