export function lazy(create) {
    let thunk = () => {
        let value = create();
        thunk = () => value;
        return value;
    };
    return () => thunk();
}
//# sourceMappingURL=lazy.js.map