"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Err = exports.Ok = void 0;
/**
 * @ignore
 */
const Ok = (value) => ({ ok: true, value });
exports.Ok = Ok;
/**
 * @ignore
 */
const Err = (error) => ({ ok: false, error });
exports.Err = Err;
//# sourceMappingURL=result.js.map