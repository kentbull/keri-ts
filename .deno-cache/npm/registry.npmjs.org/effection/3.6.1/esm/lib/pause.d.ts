import type { Operation, Reject, Resolve } from "./types.js";
export declare function pause<T>(install: (resolve: Resolve<T>, reject: Reject) => Resolve<void>): Operation<T>;
//# sourceMappingURL=pause.d.ts.map