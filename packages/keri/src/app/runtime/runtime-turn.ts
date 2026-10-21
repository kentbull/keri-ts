import { action, type Operation } from "npm:effection@^3.6.0";

/**
 * Yield cooperatively back to the host scheduler between runtime turns.
 *
 * This is the shared fairness boundary used by the long-running runtime
 * operations. It keeps the message, escrow, and OOBI loops from monopolizing
 * the host process while still retrying work on the next available turn.
 */
export function* runtimeTurn(): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), 0);
    return () => clearTimeout(timeoutId);
  });
}
