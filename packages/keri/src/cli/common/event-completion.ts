import type { EventCompletionDeps } from "../../app/identity/event-completion.ts";
import type { Habery } from "../../app/identity/habbing.ts";
import { createProtocolProcessor } from "../../app/protocol/protocol-processing.ts";
import { createAgentRuntime, runAgentRuntimeUntil } from "../../app/runtime/agent-runtime.ts";
import { systemClock } from "../../app/runtime/runtime-clock.ts";
import type { HttpClient } from "../../app/transport/http-client.ts";

/**
 * Compose event-completion dependencies for one CLI command.
 *
 * A short-lived runtime is created only when a delegated event needs workers,
 * lent to the library for that one scope, and closed on every exit path.
 */
export function cliEventCompletionDeps(hby: Habery, http: HttpClient): EventCompletionDeps {
  return {
    hby,
    protocol: createProtocolProcessor(hby),
    http,
    clock: systemClock,
    *withDelegation(use) {
      const runtime = yield* createAgentRuntime(hby, http, systemClock);
      try {
        return yield* use({
          anchorer: runtime.delegating,
          runUntil: (done, options) => runAgentRuntimeUntil(runtime, done, options),
        });
      } finally {
        yield* runtime.close();
      }
    },
  };
}
