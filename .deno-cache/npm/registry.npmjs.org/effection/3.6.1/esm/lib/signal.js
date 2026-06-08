import { createQueue } from "./queue.js";
import { resource } from "./instructions.js";
import { createContext } from "./context.js";
/**
 * @ignore
 * {@link Context} that contains a {@link Queue} factory to be used when creating a {@link Signal}.
 *
 * This allows end-users to customize a Signal's Queue.
 *
 * @example
 * ```javascript
 * export function useActions(pattern: ActionPattern): Stream<AnyAction, void> {
 *  return {
 *    *[Symbol.iterator]() {
 *      const actions = yield* ActionContext;
 *      yield* QueueFactory.set(() => createFilterQueue(matcher(pattern));
 *      return yield* actions;
 *    }
 *  }
 * }
 *
 * function createFilterQueue(predicate: Predicate) {
 *  let queue = createQueue();
 *
 *  return {
 *    ...queue,
 *    add(value) {
 *      if (predicate(value)) {
 *        queue.add(value);
 *      }
 *    }
 *  }
 * }
 * ```
 */
export const SignalQueueFactory = createContext("Signal.createQueue", createQueue);
/**
 * Create a new {@link Signal}
 *
 * Signal should be used when you need to send messages to a stream
 * from _outside_ of an operation. The most common case of this is to
 * connect a plain, synchronous JavaScript callback to an operation.
 *
 * @example
 * ```javascript
 * function* logClicks(button) {
 *   let clicks = createSignal<MouseEvent>();
 *   try {
 *     button.addEventListener("click", clicks.send);
 *
 *     for (let click of yield* each(clicks)) {
 *       console.log("click", click);
 *     }
 *    } finally {
 *      button.removeEventListener("click", clicks.send);
 *    }
 * }
 * ```
 *
 * Do not use a signal to send messages from within an operation as it could
 * result in out-of-scope code being executed. In those cases, you should use a
 * {@link Channel}.
 */
export function createSignal() {
    let subscribers = new Set();
    let subscribe = resource(function* (provide) {
        let newQueue = yield* SignalQueueFactory.expect();
        let queue = newQueue();
        subscribers.add(queue);
        try {
            yield* provide({ next: queue.next });
        }
        finally {
            subscribers.delete(queue);
        }
    });
    function send(value) {
        for (let queue of [...subscribers]) {
            queue.add(value);
        }
    }
    function close(value) {
        for (let queue of [...subscribers]) {
            queue.close(value);
        }
    }
    return { ...subscribe, send, close };
}
//# sourceMappingURL=signal.js.map