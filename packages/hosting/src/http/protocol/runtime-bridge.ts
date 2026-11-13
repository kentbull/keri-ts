import { type Operation } from "effection";
import { type AgentCue, type AgentRuntime, type Deck, type Hab, processCuesOnce } from "keri-ts/runtime";

/**
 * Route HTTP cues to their owners without starting any outbound network work.
 * Poster and query work are only admitted here; the runtime's Poster and query-sender workers own network delivery
 * on their tocks, so a request never waits on, or fails from, this host's own outbound sends (a relaying agent's
 * refresh query, a KRAM recovery query). Request-owned direct replies remain with the HTTP request lifetime.
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
}
