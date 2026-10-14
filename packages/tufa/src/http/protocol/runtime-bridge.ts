import { type Operation } from "effection";
import { type AgentCue, type AgentRuntime, type CueEmission, type Hab } from "keri-ts/runtime";

/**
 * Consume explicit cues under Reactor.settle through one service habitat and mailbox side effects.
 *
 * `Hab.processCuesIter(...)` remains the cue-to-wire interpreter; the request
 * layer owns mailbox publication side effects needed before HTTP responses are
 * finalized.
 */
export function* drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Iterable<AgentCue>,
): Operation<CueEmission[]> {
  const habitats = [...runtime.hby.habs.values()];
  const hab = serviceHab
    ?? (habitats.length === 1 ? habitats[0] ?? null : null);
  if (!hab) {
    return [];
  }

  const emissions: CueEmission[] = [];
  for (const emission of hab.processCuesIter(cues)) {
    if (emission.cue.kin === "query" && emission.kind !== "wire") runtime.querying.enqueueCue(emission.cue);
    else yield* runtime.respondant.sendWithHab(emission, hab);
    emissions.push(emission);
  }
  return emissions;
}
