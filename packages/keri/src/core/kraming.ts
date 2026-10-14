/** Optional receiver-owned KRAM intake composed from qualified policy, handoff and pruning. */
import type { Operation } from "effection";
import type { Baser } from "../db/basing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import type { Deck } from "./deck.ts";
import type { KeriDispatchEnvelope } from "./dispatch.ts";
import { KramHandoff, type KramHandoffRefusal } from "./kram-handoff.ts";
import { type KramConfig, KramPolicy } from "./kram-policy.ts";
import { KramPruner, type KramPruneResult } from "./kram-pruning.ts";

/** Expected pending/refusal outcomes; cancellation, corruption and infrastructure failures throw. */
export type KramRefusal = KramHandoffRefusal;
/** Explicit receiver-owned cache and exemption configuration. */
export type { KramConfig } from "./kram-policy.ts";

/** Complete optional intake; void callbacks consume/adopt evidence before the owning scope ends. */
export class Kramer {
  /** Shared runtime cues, or the standalone caller's drainable receiver-state notifications. */
  readonly cues: Deck<AgentCue>;
  private readonly policy: KramPolicy;
  private readonly handoff: KramHandoff;
  private readonly pruner: KramPruner;
  private readonly now: () => number;

  constructor(
    db: Baser,
    { config = {}, cues, now = Date.now }: { config?: KramConfig; cues?: Deck<AgentCue>; now?: () => number } = {},
  ) {
    this.now = now;
    this.policy = new KramPolicy(db, config, now);
    this.handoff = new KramHandoff(db, this.policy, { cues, now });
    this.cues = this.handoff.cues;
    this.pruner = new KramPruner(db, this.policy);
  }

  /** Consume ready evidence before joined disposal/acknowledgement; borrowed input remains caller-owned. */
  intake(
    envelope: KeriDispatchEnvelope,
    consume: (ready: KeriDispatchEnvelope, receiverTime: string) => Operation<void>,
  ): Operation<void | KramRefusal> {
    return this.handoff.intake(envelope, consume);
  }

  /** Reconfigure cache windows through the durable policy transition facility. */
  changeConfig(caches: NonNullable<KramConfig["caches"]>, delay?: number): void {
    this.policy.change(caches, delay);
  }

  /** Schedule one finite maintenance batch, deferring during active handoff ownership. */
  prune(maxRows = 128): KramPruneResult {
    const now = this.now();
    if (!Number.isSafeInteger(now)) throw new Error("Invalid KRAM receiver clock");
    return this.pruner.prune(makeNowIso8601(new Date(now)), maxRows);
  }
}
