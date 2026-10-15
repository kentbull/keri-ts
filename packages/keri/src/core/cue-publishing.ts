import { CueDeck, type PreparedCueBatch } from "./cue-admission.ts";
import type { AgentCue } from "./cues.ts";
import type { Deck } from "./deck.ts";

/** Producers prepare publication before effects without depending on queue consumption or concrete ownership. */
export interface CuePublisher {
  /** Preserve standalone queues' conservative count guard; owned queues admit the concrete batch instead. */
  preflight(count: number): void;
  /** Hold the batch's publication contract until publish or release. */
  prepare(cues: readonly AgentCue[]): PreparedCueBatch;
}

/** Adapt the existing queue once per producer; the composition migration removes concrete dispatch in slice 08. */
export function cuePublisher(queue: Deck<AgentCue>): CuePublisher {
  if (queue instanceof CueDeck) {
    return {
      preflight() {},
      prepare: (cues) => queue.prepare(cues),
    };
  }
  return {
    preflight: (count) => queue.checkSpace(count),
    prepare(cues) {
      queue.checkSpace(cues.length);
      return {
        publish: () => {
          queue.extend(cues);
        },
        release() {},
      };
    },
  };
}
