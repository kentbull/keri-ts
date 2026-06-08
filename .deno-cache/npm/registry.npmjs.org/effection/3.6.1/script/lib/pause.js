"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pause = pause;
const result_js_1 = require("./result.js");
const deps_js_1 = require("./deps.js");
function* pause(install) {
    let uninstall = () => { };
    try {
        return yield function pause_i() {
            return (0, deps_js_1.shift)(function* (k) {
                let resolve = (value) => k.tail((0, result_js_1.Ok)(value));
                let reject = (error) => k.tail((0, result_js_1.Err)(error));
                uninstall = install(resolve, reject);
            });
        };
    }
    finally {
        if (uninstall) {
            uninstall();
        }
    }
}
//# sourceMappingURL=pause.js.map