"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChannel = createChannel;
const signal_js_1 = require("./signal.js");
const lift_js_1 = require("./lift.js");
/**
 * Create a new {@link Channel}. Use channels to communicate between operations.
 * In order to dispatch messages from outside an operation such as from a
 * callback, use {@link Signal}.
 *
 * See [the guide on Streams and
 * Subscriptions](https://frontside.com/effection/docs/guides/collections)
 * for more details.
 *
 * @example
 *
 * ``` javascript
 * import { main, createChannel } from 'effection';
 *
 * await main(function*() {
 *   let channel = createChannel();
 *
 *   yield* channel.send('too early'); // the channel has no subscribers yet!
 *
 *   let subscription1 = yield* channel;
 *   let subscription2 = yield* channel;
 *
 *   yield* channel.send('hello');
 *   yield* channel.send('world');
 *
 *   console.log(yield* subscription1.next()); //=> { done: false, value: 'hello' }
 *   console.log(yield* subscription1.next()); //=> { done: false, value: 'world' }
 *   console.log(yield* subscription2.next()); //=> { done: false, value: 'hello' }
 *   console.log(yield* subscription2.next()); //=> { done: false, value: 'world' }
 * });
 * ```
 */
function createChannel() {
    let signal = (0, signal_js_1.createSignal)();
    return {
        send: (0, lift_js_1.lift)(signal.send),
        close: (0, lift_js_1.lift)(signal.close),
        [Symbol.iterator]: signal[Symbol.iterator],
    };
}
//# sourceMappingURL=channel.js.map