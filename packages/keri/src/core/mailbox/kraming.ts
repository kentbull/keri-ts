/** Optional receiver-owned KRAM intake composed from policy, atomic staging and pruning. */
import type { Baser } from "../../db/basing.ts";
import { makeNowIso8601, timestampMicros } from "../../time/mod.ts";
import type { AgentCue } from "../cues.ts";
import { Deck } from "../deck.ts";
import type { KeriDispatchEnvelope } from "../dispatch.ts";
import { type KramConfig, KramPolicy } from "./kram-policy.ts";
import { KramPruner, type KramPruneResult } from "./kram-pruning.ts";
import { type KramStageRefusal, stageKram } from "./kram-staging.ts";

/** Expected pending/refusal outcomes; cancellation, corruption and infrastructure failures throw. */
export type KramRefusal = KramStageRefusal | { kind: "pending"; key: readonly string[] };
/** Accepted input carries ordinary buffered evidence, including combined threshold proofs. */
export type KramIntakeResult = KramRefusal | { kind: "ready"; envelope: KeriDispatchEnvelope; receiverTime?: string };
/** Explicit receiver-owned cache and exemption configuration. */
export type { KramConfig } from "./kram-policy.ts";

/** Optional receiver intake returns ordinary decisions without owning parser input. */
export class Kramer {
  /** Shared runtime cues, or the standalone caller's drainable receiver-state notifications. */
  readonly cues: Deck<AgentCue>;
  private readonly policy: KramPolicy;
  private readonly pruner: KramPruner;
  private readonly now: () => number;

  constructor(
    private readonly db: Baser,
    { config = {}, cues = new Deck<AgentCue>(), now = Date.now }: {
      config?: KramConfig;
      cues?: Deck<AgentCue>;
      now?: () => number;
    } = {},
  ) {
    this.now = now;
    this.policy = new KramPolicy(db, config, now);
    this.cues = cues;
    this.pruner = new KramPruner(db, this.policy);
  }

  /** Decide intake synchronously; protocol dispatch consumes the returned evidence. */
  intake(envelope: KeriDispatchEnvelope): KramIntakeResult {
    this.policy.reconcile();
    if (this.policy.exempts(envelope.serder)) return { kind: "ready", envelope };
    const clock = this.now();
    if (!Number.isSafeInteger(clock)) throw new Error("Invalid KRAM receiver clock");
    const receipt = makeNowIso8601(new Date(clock));
    if (timestampMicros(receipt) === null) throw new Error("Invalid KRAM receiver clock");
    const result = stageKram(this.db, this.policy, envelope, receipt);
    if (result.kind === "missing") {
      this.cues.push({
        kin: "query",
        pre: result.sender,
        route: "logs",
        q: result.sn === null ? {} : { s: result.sn.toString(16) },
      });
    }
    return result;
  }

  /** Reconfigure cache windows through the durable policy transition facility. */
  changeConfig(caches: NonNullable<KramConfig["caches"]>, delay?: number): void {
    this.policy.change(caches, delay);
  }

  /** Run one finite synchronous maintenance batch. */
  prune(maxRows = 128): KramPruneResult {
    const now = this.now();
    if (!Number.isSafeInteger(now)) throw new Error("Invalid KRAM receiver clock");
    return this.pruner.prune(makeNowIso8601(new Date(now)), maxRows);
  }
}
