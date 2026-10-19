import { type Operation } from "effection";
import { type AgentCue, type AgentRuntime, type Deck, type Hab, processCuesOnce } from "keri-ts/runtime";

/** Route the HTTP source batch through concrete cue owners, then join its finite output passes. */
export function* drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Deck<AgentCue>,
): Operation<void> {
  if (cues !== runtime.cues) throw new RangeError("HTTP cue drain requires the runtime source deck");
  yield* processCuesOnce(runtime, { hab: serviceHab });
  yield* runtime.querying.deliverOnce();
  yield* runtime.poster.process();
}
