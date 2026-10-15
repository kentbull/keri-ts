import type { CueQueueInput } from "./cue-publishing.ts";
/** Internal retryable KRAM handoff; borrowed shared credit covers scoped snapshot copies. */
import { bytesEqual, ResourceAdmissionError, type ResourcePolicy } from "cesr-ts";
import { call, type Operation, type Provide, resource } from "effection";
import type { Baser } from "../db/basing.ts";
import { removeKramFactors } from "../db/kram-factors.ts";
import { removeKramSnapshot } from "../db/kram-snapshots.ts";
import { makeNowIso8601, timestampMicros } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import type { KeriDispatchEnvelope } from "./dispatch.ts";
import type { KramPolicy } from "./kram-policy.ts";
import { type KramStageRefusal, stageKram } from "./kram-staging.ts";

/** Non-ready decisions remain typed; limits, contracts, storage and consumer failures throw. */
export type KramHandoffRefusal =
  | KramStageRefusal
  | { kind: "drop"; reason: "busy" }
  | { kind: "pending"; key: readonly string[] };

/** Maintenance exclusion counts live scopes sharing one Baser; admission remains per instance. */
const activeHandoffs = new WeakMap<Baser, number>();
/** A synchronous pruning batch must check this before reading and mutating without yielding. */
export function isKramHandoffActive(db: Baser): boolean {
  return (activeHandoffs.get(db) ?? 0) > 0;
}

/**
 * Hold one local permit through staging, callback consumption, disposal and acknowledgement.
 * Durable ready receipt makes failed deliveries explicitly retryable after reopen. Callbacks
 * and owner adoption are at least once: later cleanup/ack failures do not roll back side effects.
 * Callback results MUST NOT retain borrowed hydration/frame/payload owners. Consume or adopt
 * accepted plaintext within the callback and dispose every untransferred owner in its finally.
 * This per-instance guard does not provide a shared admission budget or cross-instance lock.
 */
export class KramHandoff {
  private active = false;
  readonly cues: CueQueueInput;
  private readonly now: () => number;
  readonly resources: ResourcePolicy;

  constructor(
    readonly db: Baser,
    readonly policy: KramPolicy,
    { cues = new Deck<AgentCue>(), now = Date.now, resources = db.resources }: {
      cues?: CueQueueInput;
      now?: () => number;
      resources?: ResourcePolicy;
    } = {},
  ) {
    if (policy.db !== db) throw new Error("KRAM handoff policy must use its backing store");
    if (resources !== db.resources) {
      throw new RangeError("KRAM handoff must borrow its backing store's resource policy");
    }
    this.cues = cues;
    this.now = now;
    this.resources = resources;
  }

  /** Local maintenance can defer while joined handoff work still owns evidence. */
  get busy(): boolean {
    return this.active;
  }

  /** Borrow input; only a successfully consumed and disposed ready message is acknowledged. */
  *intake<T>(
    incoming: KeriDispatchEnvelope,
    consume: (ready: KeriDispatchEnvelope, receiverTime: string) => Operation<T>,
  ): Operation<T | KramHandoffRefusal> {
    return yield* call(function*(this: KramHandoff) {
      if (this.active) return { kind: "drop", reason: "busy" } as const;
      // Acquire the passive permit before its work child so cancellation joins cleanup first.
      yield* resource<void>(function*(this: KramHandoff, provide: Provide<void>) {
        this.active = true;
        activeHandoffs.set(this.db, (activeHandoffs.get(this.db) ?? 0) + 1);
        try {
          yield* provide(undefined);
        } finally {
          this.active = false;
          const remaining = activeHandoffs.get(this.db)! - 1;
          if (remaining) activeHandoffs.set(this.db, remaining);
          else activeHandoffs.delete(this.db);
        }
      }.bind(this));
      return yield* call(function*(this: KramHandoff) {
        this.policy.reconcile();
        const clock = this.now();
        if (!Number.isSafeInteger(clock)) throw new Error("Invalid KRAM receiver clock");
        const receipt = makeNowIso8601(new Date(clock));
        if (timestampMicros(receipt) === null) throw new Error("Invalid KRAM receiver clock");
        if (this.policy.exempts(incoming.serder)) return yield* consume(incoming, receipt);
        const key = [incoming.serder.pre!, incoming.serder.said!];
        // This acknowledgement snapshot coexists with staged/hydrated evidence until cleanup and commit join.
        yield* resource<void>(function*(this: KramHandoff, provide: Provide<void>) {
          const credit = this.resources.reserve({ bytes: incoming.serder.raw.byteLength });
          if (credit.kind === "refuse") {
            throw new ResourceAdmissionError("KRAM acknowledgement copy admission refused", credit.reason);
          }
          try {
            yield* provide(undefined);
          } finally {
            credit.reservation.release();
          }
        }.bind(this));
        const body = incoming.serder.raw.slice();
        const result = yield* stageKram(
          this.db,
          this.policy,
          this.resources,
          incoming,
          receipt,
          (ready, _key, frozenReceipt) => consume(ready, frozenReceipt),
        );
        if (result.kind === "missing") {
          this.cues.push({
            kin: "query",
            pre: result.sender,
            route: "logs",
            q: result.sn === null ? {} : { s: result.sn.toString(16) },
          });
        }
        if (result.kind !== "ready") return result;
        const env = this.db.env;
        if (!env) throw new Error("KRAM acknowledgement database is closed");
        env.transactionSync(() => {
          const stored = this.db.pmkm.get(key);
          if (
            result.key.length !== 2 || result.key.some((part, i) => part !== key[i])
            || this.db.kready.get(key) !== result.receiverTime || !stored
            || stored.pre !== key[0] || stored.said !== key[1] || !bytesEqual(stored.raw, body)
          ) {
            throw new Error("KRAM ready state changed before acknowledgement");
          }
          this.db.kready.rem(key);
          removeKramFactors(this.db, key);
          removeKramSnapshot(this.db, key);
        });
        return result.value;
      }.bind(this));
    }.bind(this));
  }
}
