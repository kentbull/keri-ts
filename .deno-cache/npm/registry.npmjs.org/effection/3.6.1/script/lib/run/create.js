"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
function create(tag, attrs, prototype) {
    let properties = {};
    for (let [key, value] of Object.entries(attrs)) {
        properties[key] = { enumerable: true, value };
    }
    return Object.create({
        ...prototype,
        [Symbol.toStringTag]: tag,
    }, properties);
}
//# sourceMappingURL=create.js.map