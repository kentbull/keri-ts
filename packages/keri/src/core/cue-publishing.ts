import type { ResourcePolicy } from "cesr-ts";
import { CueDeck, type PreparedCueBatch } from "./cue-admission.ts";
import type { AgentCue } from "./cues.ts";
import type { Deck } from "./deck.ts";

/** Producers prepare publication before effects without depending on queue consumption or concrete ownership. */
export interface CuePublisher {
  /** Held-retention policy when the queue owns credit; standalone queues keep caller-owned retention. */
  readonly resourcePolicy: ResourcePolicy | undefined;
  /** Preserve standalone queues' conservative count guard; owned queues admit the concrete batch instead. */
  preflight(count: number): void;
  /** Hold the batch's publication contract until publish or release. */
  prepare(cues: readonly AgentCue[]): PreparedCueBatch;
}

/** Adapt the existing queue once per producer; the composition migration removes concrete dispatch in slice 08. */
export function cuePublisher(queue: Deck<AgentCue>): CuePublisher {
  if (queue instanceof CueDeck) {
    return {
      resourcePolicy: queue.resourcePolicy,
      preflight() {},
      prepare: (cues) => queue.prepare(cues),
    };
  }
  return {
    resourcePolicy: undefined,
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
