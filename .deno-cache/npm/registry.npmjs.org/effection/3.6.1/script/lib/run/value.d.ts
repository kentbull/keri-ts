import { type Computation } from "../deps.js";
import type { Resolve } from "../types.js";
export declare function createValue<T>(): Computation<[Resolve<T>, Computation<T>]>;
export interface Queue<T> {
    add(item: T): void;
    next(): Computation<T>;
}
export declare function sync<T>(value: T): {
    next(): {
        readonly done: true;
        readonly value: T;
    };
};
//# sourceMappingURL=value.d.ts.map