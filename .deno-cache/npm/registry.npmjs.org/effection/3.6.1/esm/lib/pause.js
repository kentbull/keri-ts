import { Err, Ok } from "./result.js";
import { shift } from "./deps.js";
export function* pause(install) {
    let uninstall = () => { };
    try {
        return yield function pause_i() {
            return shift(function* (k) {
                let resolve = (value) => k.tail(Ok(value));
                let reject = (error) => k.tail(Err(error));
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