export interface Computation<T = any> {
    [Symbol.iterator](): Iterator<Control, T, any>;
}
export interface Continuation<T = any, R = any> {
    (value: T): R;
    tail(value: T): void;
}
export declare function reset<T>(block: () => Computation): Computation<T>;
export declare function shift<T>(block: (resolve: Continuation<T>, reject: Continuation<Error>) => Computation): Computation<T>;
export declare function evaluate<T>(iterator: () => Computation): T;
export type K<T = any, R = any> = Continuation<T, R>;
export type Control = {
    type: "shift";
    block(resolve: Continuation, reject: Continuation<Error>): Computation;
} | {
    type: "reset";
    block(): Computation;
};
//# sourceMappingURL=mod.d.ts.map