import type { Operation } from "npm:effection@^3.6.0";
import type { DelegationWorkflowStatus } from "../../app/identity/delegating.ts";
import { completeEvent, type EventCompletionDeps } from "../../app/identity/event-completion.ts";
import type { Habery } from "../../app/identity/habbing.ts";
import { createProtocolProcessor } from "../../app/protocol/protocol-processing.ts";
import { createAgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { systemClock } from "../../app/runtime/runtime-clock.ts";
import type { HttpClient } from "../../app/transport/http-client.ts";
import { withRuntimeWorkers } from "./runtime-workers.ts";

/**
 * Compose event-completion dependencies for one CLI command.
 *
 * A short-lived runtime is created only when a delegated event needs workers.
 * It is lent to the library for that one scope with its workers running around
 * the library's observe-only wait, and closed on every exit path.
 */
export function cliEventCompletionDeps(hby: Habery, http: HttpClient): EventCompletionDeps {
  return {
    hby,
    protocol: createProtocolProcessor(hby),
    http,
    clock: systemClock,
    *withDelegation(hab, use) {
      const runtime = yield* createAgentRuntime(hby, http, systemClock);
      try {
        return yield* withRuntimeWorkers(
          runtime,
          { hab, pollMailbox: true },
          () => use({ anchorer: runtime.delegating }),
        );
      } finally {
        yield* runtime.close();
      }
    },
  };
}

/**
 * `completeEvent` for commands: an expired delegation wait fails the command with
 * the text the CLI has always printed, then the caller sees the usual result.
 */
export function* completeEventOrThrow(
  ...args: Parameters<typeof completeEvent>
): Operation<{ delegationPhase: DelegationWorkflowStatus["phase"] | null }> {
  const completion = yield* completeEvent(...args);
  if (completion.outcome === "timed-out") {
    throw new Error(`Runtime did not converge within ${completion.timeoutMs}ms.`);
  }
  return completion;
}
