import { pause } from "./pause.js";
/**
 * Creates a new queue. Queues are unlimited in size and sending a message to a
 * queue is always synchronous.
 *
 * @example
 *
 * ```javascript
 * import { each, main, createQueue } from 'effection';
 *
 * await main(function*() {
 *   let queue = createQueue<number>();
 *   queue.send(1);
 *   queue.send(2);
 *   queue.send(3);
 *
 *   let next = yield* queue.subscription.next();
 *   while (!next.done) {
 *     console.log("got number", next.value);
 *     next = yield* queue.subscription.next();
 *   }
 * });
 * ```
 *
 * @typeParam T the type of the items in the queue
 * @typeParam TClose the type of the value that the queue is closed with
 */
export function createQueue() {
    let items = [];
    let consumers = new Set();
    function enqueue(item) {
        items.unshift(item);
        while (items.length > 0 && consumers.size > 0) {
            let [consume] = consumers;
            let top = items.pop();
            consume(top);
        }
    }
    return {
        add: (value) => enqueue({ done: false, value }),
        close: (value) => enqueue({ done: true, value }),
        *next() {
            let item = items.pop();
            if (item) {
                return item;
            }
            else {
                return yield* pause((resolve) => {
                    consumers.add(resolve);
                    return () => consumers.delete(resolve);
                });
            }
        },
    };
}
//# sourceMappingURL=queue.js.map