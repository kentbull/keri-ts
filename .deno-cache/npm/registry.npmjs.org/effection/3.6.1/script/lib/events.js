"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.once = once;
exports.on = on;
// deno-lint-ignore-file no-explicit-any ban-types
const signal_js_1 = require("./signal.js");
const instructions_js_1 = require("./instructions.js");
/**
 * Create an {@link Operation} that yields the next event to be emitted by an
 * [EventTarget](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget).
 *
 * @param target - the event target to be watched
 * @param name - the name of the event to watch. E.g. "click"
 * @returns an Operation that yields the next emitted event
 */
function once(target, name) {
    return {
        *[Symbol.iterator]() {
            let subscription = yield* on(target, name);
            let next = yield* subscription.next();
            return next.value;
        },
    };
}
/**
 * Create a {@link Stream} of events from any
 * [EventTarget](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget).
 *
 * See the guide on [Streams and Subscriptions](https://frontside.com/effection/docs/collections)
 * for details on how to use streams.
 *
 * @param target - the event target whose events will be streamed
 * @param name - the name of the event to stream. E.g. "click"
 * @returns a stream that will see one item for each event
 */
function on(target, name) {
    return (0, instructions_js_1.resource)(function* (provide) {
        let signal = (0, signal_js_1.createSignal)();
        target.addEventListener(name, signal.send);
        try {
            yield* provide(yield* signal);
        }
        finally {
            target.removeEventListener(name, signal.send);
        }
    });
}
//# sourceMappingURL=events.js.map