import { type Operation, spawn } from "npm:effection@^3.6.0";
import type { Hab } from "../../app/identity/habbing.ts";
import { type AgentRuntime, runAgentRuntime } from "../../app/runtime/agent-runtime.ts";
import type { AgentCue } from "../../core/cues.ts";
import type { Deck } from "../../core/deck.ts";

/**
 * Run the runtime workers around one observe-only library call.
 *
 * Library workflows only observe (see `app/runtime/workflow-contract.ts`); a
 * one-shot CLI command has no running runtime, so it supplies the workers here.
 * The worker is halted and joined on success, failure and cancellation before
 * the caller can release stores.
 *
 * @param runtime Borrowed composed runtime; the command owns its lifetime.
 * @param options Signer, mailbox polling and command-owned query cue Deck.
 * @param use Observe-only operation that depends on the workers' progress.
 */
export function* withRuntimeWorkers<T>(
  runtime: AgentRuntime,
  options: { hab?: Hab; pollMailbox?: boolean; queryCues?: Deck<AgentCue> },
  use: () => Operation<T>,
): Operation<T> {
  const worker = yield* spawn(() => runAgentRuntime(runtime, options));
  try {
    return yield* use();
  } finally {
    yield* worker.halt();
  }
}
