import type { ResourcePolicy } from "cesr-ts";
import type { OwnedCue, PreparedCueBatch } from "./cue-admission.ts";
import type { AgentCue } from "./cues.ts";
import type { Deck } from "./deck.ts";

/** Admitted queue operations; removal transfers actual retained ownership. */
export interface CueQueue extends CueReader, Iterable<AgentCue> {
  /** Reserve actual batch retention before effects; publish or release at the owner boundary. */
  prepare(cues: readonly AgentCue[]): PreparedCueBatch;
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

/** Consumers transfer cue handles without depending on the producer or general deque mutation API. */
export interface CueReader {
  /** Queued references only; active transferred handles are not queued. */
  readonly length: number;
  /** Policy backing the actual retained cue credit. Plain Decks are read directly. */
  readonly resourcePolicy: ResourcePolicy;
  /** Borrow the next cue without changing its queue or ownership. */
  peekHead(): AgentCue | undefined;
  /** Retained source credit available to downstream combined admission. */
  headRetentionBytes(): number;
  /** Remove one reference while retaining any existing credit until release. */
  takeOwned(): OwnedCue | undefined;
  /** Restore unconsumed work without a new admission. */
  requeue(owner: OwnedCue): void;
}
