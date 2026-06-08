import { createSignal } from "./signal.js";
import { lift } from "./lift.js";
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
export function createChannel() {
    let signal = createSignal();
    return {
        send: lift(signal.send),
        close: lift(signal.close),
        [Symbol.iterator]: signal[Symbol.iterator],
    };
}
//# sourceMappingURL=channel.js.map