import { type Operation } from "effection";
import { type AgentCue, type AgentRuntime, type Deck, type Hab, processCuesOnce } from "keri-ts/runtime";

/**
 * Route HTTP cues and finish the existing query-delivery pass.
 * Poster work is only admitted here; its independent worker owns network delivery.
 * Request-owned direct replies remain with the HTTP request lifetime.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Optional hosted signer for cue production.
 * @param cues Exact runtime source Deck; foreign Decks are rejected.
 */
export function* drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Deck<AgentCue>,
): Operation<void> {
  if (cues !== runtime.cues) throw new RangeError("HTTP cue drain requires the runtime source deck");
  yield* processCuesOnce(runtime, { hab: serviceHab });
  yield* runtime.querying.deliverOnce();
}
