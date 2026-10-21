import { action, type Operation, type Task } from "effection";
import { collectBytes } from "../src/app/transport/byte-source.ts";
import type { HttpStreamResponse } from "../src/app/transport/http-client.ts";

/** Wrap `fetch()` as an Effection operation with cancellation-aware cleanup. */
export function* fetchOp(url: string, init?: RequestInit): Operation<Response> {
  return yield* action((resolve, reject) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortUpstream = () => controller.abort(upstreamSignal?.reason);
    let settled = false;

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener("abort", abortUpstream, { once: true });
      }
    }

    fetch(url, { ...init, signal: controller.signal }).then((response) => {
      settled = true;
      resolve(response);
    }).catch(reject);

    return () => {
      upstreamSignal?.removeEventListener("abort", abortUpstream);
      if (!settled) {
        controller.abort();
      }
    };
  });
}

/** Await one Promise inside the Effection task tree. */
export function* promiseOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve).catch(reject);
    return () => {};
  });
}

/** Wrap `Response.text()` as an Effection operation for test assertions. */
export function* textOp(response: Response | HttpStreamResponse): Operation<string> {
  return yield* action((resolve, reject) => {
    const text = typeof response.body === "function"
      ? collectBytes(response.body()).then((bytes) => new TextDecoder().decode(bytes))
      : (response as Response).text();
    text.then(resolve, reject);
    return () => {};
  });
}

/** Sleep for a short interval inside the Effection task tree. */
export function* sleepOp(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}

/** Poll the local HTTP health endpoint until the server is ready or time out. */
export function* waitForServer(
  port: number,
  {
    host = "127.0.0.1",
    maxAttempts = 20,
    attemptTimeoutMs = 100,
    retryDelayMs = 50,
  }: {
    host?: string;
    maxAttempts?: number;
    attemptTimeoutMs?: number;
    retryDelayMs?: number;
  } = {},
): Operation<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = yield* fetchOp(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (response.ok) {
        yield* textOp(response);
        return;
      }
      yield* textOp(response);
    } catch {
      // Wait and retry until the server is reachable.
    }
    yield* sleepOp(retryDelayMs);
  }

  throw new Error(
    `Server on port ${port} did not become ready within ${maxAttempts} attempts.`,
  );
}

/** Halt a spawned task and wait briefly for cleanup to settle in tests. */
export function* waitForTaskHalt(
  task: Task<void>,
  settleMs = 50,
): Operation<void> {
  yield* task.halt();
  yield* sleepOp(settleMs);
}
