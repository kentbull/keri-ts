import type { Frame, Operation } from "../types.js";
export interface FrameOptions<T> {
    operation(): Operation<T>;
    parent?: Frame["context"];
}
export declare function createFrame<T>(options: FrameOptions<T>): Frame<T>;
//# sourceMappingURL=frame.d.ts.map