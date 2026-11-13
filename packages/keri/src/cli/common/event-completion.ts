import type { Operation } from "npm:effection@^3.6.0";
import type { DelegationWorkflowStatus } from "../../app/identity/delegating.ts";
import { completeEvent, type EventCompletionDeps } from "../../app/identity/event-completion.ts";
import type { Habery } from "../../app/identity/habbing.ts";
import { KelPublisher } from "../../app/mailbox/kel-publisher.ts";
import { createProtocolProcessor } from "../../app/protocol/protocol-processing.ts";
import { createAgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { systemClock } from "../../app/runtime/runtime-clock.ts";
import type { HttpClient } from "../../app/transport/http-client.ts";
import { withRuntimeWorkers } from "./runtime-workers.ts";

/** Event-completion dependencies of a command, with the publisher that tells mailboxes after a rotation. */
export interface CliEventCompletionDeps extends EventCompletionDeps {
  readonly publisher: KelPublisher;
}

/**
 * Compose event-completion dependencies for one CLI command.
 *
 * A short-lived runtime is created only when a delegated event needs workers.
 * It is lent to the library for that one scope with its workers running around
 * the library's observe-only wait, and closed on every exit path.
 */
export function cliEventCompletionDeps(hby: Habery, http: HttpClient): CliEventCompletionDeps {
  // A command has no running runtime, so it carries the publisher whose pass `completeEventOrThrow` runs.
  const publisher = new KelPublisher({ hby, http, clock: systemClock });
  return {
    hby,
    publisher,
    rotated: publisher.rotated,
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
  deps: CliEventCompletionDeps,
  ...args: Parameters<typeof completeEvent> extends [unknown, ...infer Rest] ? Rest : never
): Operation<{ delegationPhase: DelegationWorkflowStatus["phase"] | null }> {
  const completion = yield* completeEvent(deps, ...args);
  if (completion.outcome === "timed-out") {
    throw new Error(`Runtime did not converge within ${completion.timeoutMs}ms.`);
  }
  // No fiber runs the publisher in a one-shot command: tell the mailboxes of a completed rotation now. A
  // mailbox that cannot be reached stays owed in the marker and the poller repairs it.
  if (!deps.publisher.rotated.empty) yield* deps.publisher.processOnce();
  return completion;
}
