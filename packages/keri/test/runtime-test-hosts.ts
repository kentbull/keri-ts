import { type Operation, spawn, type Task } from "effection";
import type { AgentRuntime } from "../src/app/agent-runtime.ts";
import { type RuntimeServerOptions, startServer } from "../src/app/server.ts";
import { promiseOp, waitForServer } from "./effection-http.ts";
import type { TestListenAddress } from "./http-test-support.ts";

export interface StartedRuntimeServer {
  address: TestListenAddress;
  task: Task<void>;
}

/**
 * Start one protocol host on an ephemeral port and wait until `/health` is ready.
 *
 * This keeps test files focused on protocol assertions instead of duplicating
 * the "spawn server, capture actual port, then wait for health" sequence.
 */
export function* startTestServer(
  runtime?: AgentRuntime,
  options: RuntimeServerOptions = {},
): Operation<StartedRuntimeServer> {
  const listening = Promise.withResolvers<TestListenAddress>();
  const task = yield* spawn(function*() {
    yield* startServer(0, undefined, runtime, {
      ...options,
      onListen: ({ hostname, port }) => {
        options.onListen?.({ hostname, port });
        listening.resolve({ hostname, port });
      },
    });
  });

  const address = yield* promiseOp(listening.promise);
  yield* waitForServer(address.port, {
    host: address.hostname,
    maxAttempts: 30,
  });
  return { address, task };
}
