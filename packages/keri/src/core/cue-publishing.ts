import type { ResourcePolicy } from "cesr-ts";
import { CueDeck, OwnedCue, type PreparedCueBatch } from "./cue-admission.ts";
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

/** Consumers transfer cue handles without depending on the producer or general deque mutation API. */
export interface CueReader {
  /** Queued references only; active transferred handles are not queued. */
  readonly length: number;
  /** Existing source credit, absent for a standalone caller-owned queue. */
  readonly resourcePolicy: ResourcePolicy | undefined;
  /** Borrow the next cue without changing its queue or ownership. */
  peekHead(): AgentCue | undefined;
  /** Retained source credit available to downstream combined admission. */
  headRetentionBytes(): number;
  /** Remove one reference while retaining any existing credit until release. */
  takeOwned(): OwnedCue | undefined;
  /** Restore unconsumed work without a new admission. */
  requeue(owner: OwnedCue): void;
}

/** A standalone caller-owned cue has no queue byte credit; this handle controls only its borrowed reference. */
function borrowedCue(cue: AgentCue): OwnedCue {
  return new OwnedCue(cue, () => {}, () => borrowedCue(cue), 0);
}

/** Adapt the existing source; owned queues transfer existing credit and plain queues retain caller-owned accounting. */
export function cueReader(queue: Deck<AgentCue>): CueReader {
  if (queue instanceof CueDeck) return queue;
  return {
    get length() {
      return queue.length;
    },
    resourcePolicy: undefined,
    peekHead: () => queue.peekHead(),
    headRetentionBytes: () => 0,
    takeOwned() {
      const cue = queue.pull();
      return cue ? borrowedCue(cue) : undefined;
    },
    requeue(owner) {
      queue.prepend(owner.cue);
      owner.release();
    },
  };
}
