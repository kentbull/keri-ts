/**
 * Helpers the page-side steps of every browser wallet lane share: assertions, error text with causes, and a
 * polling wait whose timeout message says why the step is stuck.
 */

/** Fail the step with `message` unless `condition` holds. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Error text including causes, for the report. */
export function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.name}: ${error.message}${error.cause ? ` <- ${describe(error.cause)}` : ""}`;
}

/** Explains a stuck wait: the wallet's health, and anything else the lane knows. Empty when there is nothing to add. */
export type Explain = () => string;

/** Wait until `read` returns a value, polling a library status; fail at the deadline with `explain`'s text. */
export async function waitUntil<T>(
  label: string,
  read: () => T | undefined,
  explain: Explain,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = read();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} not reached in ${timeoutMs} ms${last ? `: ${describe(last)}` : ""}${explain()}`);
}
