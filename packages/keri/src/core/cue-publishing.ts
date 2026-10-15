import type { ResourcePolicy } from "cesr-ts";
import { OwnedCue, type PreparedCueBatch } from "./cue-admission.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";

/** Producers prepare publication before effects without depending on queue consumption or concrete ownership. */
export interface CuePublisher {
  /** Held-retention policy when the queue owns credit; standalone queues keep caller-owned retention. */
  readonly resourcePolicy: ResourcePolicy | undefined;
  /** Preserve standalone queues' conservative count guard; owned queues admit the concrete batch instead. */
  preflight(count: number): void;
  /** Hold the batch's publication contract until publish or release. */
  prepare(cues: readonly AgentCue[]): PreparedCueBatch;
}

/** Legal queue operations shared by standalone and admitted cue sources; removal transfers ownership. */
export interface CueQueue extends CuePublisher, CueReader, Iterable<AgentCue> {
  capacity: number;
  readonly empty: boolean;
  checkSpace(count?: number): void;
  append(cue: AgentCue): number;
  push(cue: AgentCue): number;
  extend(cues: Iterable<AgentCue>): number;
  clear(): void;
  peekTail(): AgentCue | undefined;
  toArray(): AgentCue[];
}

/** Standalone processors may still borrow a plain caller-owned queue. */
export type CueQueueInput = Deck<AgentCue> | CueQueue;

/** Normalize the publication boundary without inspecting an owned queue's implementation. */
export function cuePublisher(queue: CueQueueInput): CuePublisher {
  if (!(queue instanceof Deck)) return queue;
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
export function cueReader(queue: CueQueueInput): CueReader {
  if (!(queue instanceof Deck)) return queue;
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
