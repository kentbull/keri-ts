import type { AgentCue, CueEmission } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import type { Hab } from "./habbing.ts";

/**
 * Interpret and synchronously publish one source head before removing it.
 * Failed interpretation or publication preserves the record for retry. Replay
 * iterators remain unopened; the consumer owns any actual I/O it later starts.
 */
export function prepareCueEmission(
  hab: Hab | null,
  cues: Deck<AgentCue>,
  accept: (emission: CueEmission | undefined) => undefined,
  transform?: (emission: CueEmission) => CueEmission,
): boolean {
  const cue = cues.peekHead();
  if (!cue) return false;
  let emission = hab ? hab.interpretCue(cue) : {
    cue,
    messages: [],
    kind: cue.kin === "stream" ? "transport" as const : "notify" as const,
  };
  if (emission && transform) emission = transform(emission);
  const result: unknown = accept(emission);
  if (result !== undefined) throw new TypeError("Cue publication must be synchronous");
  if (cues.peekHead() !== cue) throw new Error("Cue head changed during publication");
  cues.pull();
  return true;
}
