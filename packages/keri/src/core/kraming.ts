import type { CueQueueInput } from "./cue-publishing.ts";
/** Optional receiver-owned KRAM intake composed from qualified policy, handoff and pruning. */
import type { ResourcePolicy } from "cesr-ts";
import type { Operation } from "effection";
import type { Baser } from "../db/basing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import type { Deck } from "./deck.ts";
import type { KeriDispatchEnvelope } from "./dispatch.ts";
import { KramHandoff, type KramHandoffRefusal } from "./kram-handoff.ts";
import { type KramConfig, KramPolicy } from "./kram-policy.ts";
import { KramPruner, type KramPruneResult } from "./kram-pruning.ts";

declare const receiptBrand: unique symbol;
/** Private, scoped authority for one ready envelope's receiver-observed receipt. */
export interface KramReceipt {
  readonly [receiptBrand]: true;
}
const activeReceipts = new WeakMap<KeriDispatchEnvelope, KramReceipt>();
const receiptTimes = new WeakMap<KramReceipt, { envelope: KeriDispatchEnvelope; said: string; time: string }>();

/** Dispatch may borrow receipt authority only while the ready consumer is active. */
export function kramReceipt(envelope: KeriDispatchEnvelope): KramReceipt | undefined {
  return activeReceipts.get(envelope);
}
/** Reject forged, expired or differently bound authority as caller misuse. */
export function kramReceiptTime(receipt: KramReceipt, serder: KeriDispatchEnvelope["serder"]): string {
  const bound = receiptTimes.get(receipt);
  if (!bound || bound.envelope.serder !== serder || bound.said !== serder.said) {
    throw new Error("Invalid scoped KRAM receipt");
  }
  return bound.time;
}

/** Expected pending/refusal outcomes; cancellation, corruption and infrastructure failures throw. */
export type KramRefusal = KramHandoffRefusal;
/** Explicit receiver-owned cache and exemption configuration. */
export type { KramConfig } from "./kram-policy.ts";

/** Complete optional intake; void callbacks consume/adopt evidence before the owning scope ends. */
export class Kramer {
  /** Shared runtime cues, or the standalone caller's drainable receiver-state notifications. */
  readonly cues: CueQueueInput;
  private readonly policy: KramPolicy;
  private readonly handoff: KramHandoff;
  private readonly pruner: KramPruner;
  private readonly now: () => number;

  constructor(
    private readonly db: Baser,
    { config = {}, cues, now = Date.now, resources = db.resources }: {
      config?: KramConfig;
      cues?: CueQueueInput;
      now?: () => number;
      resources?: ResourcePolicy;
    } = {},
  ) {
    if (resources !== db.resources) throw new RangeError("Kramer must borrow its backing store's resource policy");
    this.now = now;
    this.policy = new KramPolicy(db, config, now);
    this.handoff = new KramHandoff(db, this.policy, { cues, now, resources });
    this.cues = this.handoff.cues;
    this.pruner = new KramPruner(db, this.policy);
  }

  /** Consume ready evidence before joined disposal/acknowledgement; borrowed input remains caller-owned. */
  intake(
    envelope: KeriDispatchEnvelope,
    consume: (ready: KeriDispatchEnvelope, receiverTime: string) => Operation<void>,
  ): Operation<void | KramRefusal> {
    const db = this.db, policy = this.policy;
    return this.handoff.intake(envelope, function*(ready, receiverTime) {
      // Disabled/exempt forwarding is not completed KRAM acceptance.
      if (policy.exempts(ready.serder) || db.kready.get([ready.serder.pre!, ready.serder.said!]) !== receiverTime) {
        yield* consume(ready, receiverTime);
        return;
      }
      const receipt = Object.freeze({}) as KramReceipt;
      activeReceipts.set(ready, receipt);
      receiptTimes.set(receipt, { envelope: ready, said: ready.serder.said!, time: receiverTime });
      try {
        yield* consume(ready, receiverTime);
      } finally {
        activeReceipts.delete(ready);
        receiptTimes.delete(receipt);
      }
    });
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
