/** Internal atomic KRAM staging; the handoff owner supplies capacity, queries and acknowledgement. */
import { Dater, DigDex, Diger, NumberPrimitive, ResourceLimitError, type Siger } from "cesr-ts";
import type { Operation } from "effection";
import type { Baser } from "../db/basing.ts";
import { MAX_NESTED_WIRE_BYTES } from "../db/exchange-nests.ts";
import { rehydrateKramFactors, removeKramFactors, storeKramFactors, validateKramFactors } from "../db/kram-factors.ts";
import { removeKramSnapshot, snapshotKram, storeKramSnapshot, withKramHydration } from "../db/kram-snapshots.ts";
import { encodeDateTimeToDater, timestampMicros } from "../time/mod.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup } from "./dispatch.ts";
import type { Kever } from "./kever.ts";
import { authenticateKramSource } from "./kram-auth.ts";
import type { KramPolicy } from "./kram-policy.ts";
import { normalizeKramSenderFactors, verifyKramSignatures } from "./kram-signatures.ts";
import { evaluateKramTime, inspectKramReplay, type KramTimePlan, type KramTimeRefusal } from "./kram-time.ts";
import { TxnMsgCacheRecord } from "./records.ts";

/** Normal refusals retain their cause; infrastructure, corruption and finite-limit errors propagate. */
export type KramStageRefusal =
  | KramTimeRefusal
  | { kind: "drop"; reason: "authentication" | "changed" }
  | { kind: "missing"; sender: string; sn: bigint | null };
/** Only non-owning callback results and receipt metadata may escape joined hydration. */
export type KramStageResult<T> = KramStageRefusal | { kind: "pending"; key: readonly string[] } | {
  kind: "ready";
  key: readonly string[];
  receiverTime: string;
  value: T;
};
/** A stale sender pool must be removed atomically while retaining the replay cache. */
type RotatedPartial = { kind: "rotated"; key: readonly string[] };
/** Synchronous authentication/time facts must be recomputed after asynchronous acquisition. */
interface Candidate {
  kind: "candidate";
  plan: KramTimePlan;
  envelope: KeriDispatchEnvelope;
  pool: Siger[];
  kever: Kever;
  establishment: string;
  complete: boolean;
  multi: boolean;
  receipt: string | null;
}

/** Validate the private first-ready timestamp before enabling trusted replay resumption. */
function readyReceipt(db: Baser, key: readonly string[]): string | null {
  const receipt = db.kready.get(key);
  if (receipt !== null && timestampMicros(receipt) === null) throw new Error("Corrupt KRAM ready receipt");
  return receipt;
}
/** Bind verified or foreign factors to one accepted establishment tuple. */
function establishmentGroup(kever: Kever, sigers: readonly Siger[]): TransIdxSigGroup {
  return new TransIdxSigGroup(
    kever.prefixer,
    NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
    new Diger({ qb64: kever.lastEst.d }),
    sigers,
  );
}
/** Freeze foreign known last groups at receipt, leaving unknown groups borrowed for downstream use. */
function receivedFactors(db: Baser, incoming: KeriDispatchEnvelope): KeriDispatchEnvelope {
  const received = normalizeKramSenderFactors(incoming);
  const pending = received.ssgs.filter((group) => {
    const kever = db.getKever(group.pre, { refresh: true });
    if (!kever) return true;
    received.tsgs.push(establishmentGroup(kever, group.sigers));
    return false;
  });
  received.ssgs.splice(0, received.ssgs.length, ...pending);
  return received;
}
/** Fingerprint private wire so a concurrent replacement cannot be overwritten by an older prepared tree. */
function snapshotIdentity(db: Baser, key: readonly string[]): string | null {
  const wire = db.kpnd.get(key);
  if (!wire) return null;
  if (wire.length > MAX_NESTED_WIRE_BYTES) throw new Error("Oversized stored KRAM snapshot");
  return new Diger({ raw: Diger.digest(wire, DigDex.Blake3_256), code: DigDex.Blake3_256 }).qb64;
}
/** Recheck replay, source precedence, sender rotation, verified factors and the selected cache windows. */
function candidate(
  db: Baser,
  policy: KramPolicy,
  incoming: KeriDispatchEnvelope,
  receiverTime: string,
): Candidate | RotatedPartial | KramStageRefusal {
  const body = incoming.serder, sender = body.pre, said = body.said;
  if (!sender || !said) throw new Error("KRAM staging requires sender and message SAID");
  const key = [sender, said], receipt = readyReceipt(db, key);
  const inspection = inspectKramReplay(db, body, { resumingReady: receipt !== null });
  if (inspection.kind === "drop") return inspection;
  const envelope = normalizeKramSenderFactors(incoming);
  const hasSeal = envelope.sscs.length > 0;
  const hasSigs = envelope.sigers.length > 0 || envelope.tsgs.some((group) => group.pre === sender)
    || envelope.cigars.some((cigar) => cigar.verfer?.qb64 === sender);
  if (!hasSeal && !hasSigs) return { kind: "drop", reason: "authentication" };
  if (inspection.cache && hasSeal && !hasSigs && !receipt) return { kind: "drop", reason: "replay" };
  const source = authenticateKramSource(db, envelope);
  if (source.kind === "missing") return source;
  const kever = db.getKever(sender, { refresh: true });
  if (!kever) return { kind: "missing", sender, sn: null };
  const establishment = `${kever.lastEst.s}.${kever.lastEst.d}`;
  const saved: Siger[] = [];
  if (inspection.partial) {
    for (const sig of db.pmks.getIter(key)) {
      if (saved.length >= 4096) throw new ResourceLimitError("KRAM signature pool exceeds finite limits");
      saved.push(sig);
    }
  }
  const state = db.pmsk.get(key);
  if (saved.length && (!state || state[0].num !== BigInt(kever.lastEst.s) || state[1].qb64 !== kever.lastEst.d)) {
    if (!state) throw new Error("Stored KRAM signature pool lacks establishment state");
    return { kind: "rotated", key };
  }
  const seal = source.kind === "valid";
  if (!seal && !hasSigs) return { kind: "drop", reason: "authentication" };
  const verified = !seal || (hasSigs && body.ilk === "exn") ? verifyKramSignatures(db, envelope, kever) : null;
  if (!seal && verified?.kind !== "verified") return { kind: "drop", reason: "authentication" };
  const pool = saved.length
    ? verifyKramSignatures(
      db,
      new KeriDispatchEnvelope({ serder: body, sigers: saved, attachmentGroups: [], local: false }),
      kever,
    ).sigers
    : [];
  if (pool.length !== saved.length) throw new Error("Stored KRAM signature pool is inconsistent");
  // Preserve distinct verified encodings at one index in the first receipt, as frozen KERIpy does.
  const indices = new Set(pool.map((sig) => sig.index));
  pool.push(...(verified?.sigers ?? []).filter((sig) => !indices.has(sig.index)));
  const multi = !seal && kever.verfers.length !== 1;
  if (multi && !kever.tholder) throw new Error("Accepted KRAM sender has no signature threshold");
  const complete = !multi || kever.tholder!.satisfy([...new Set(pool.map((sig) => sig.index))]);
  const plan = evaluateKramTime(
    db,
    policy,
    inspection,
    seal ? { kind: "seal" } : multi ? { kind: "multi", complete } : { kind: "single" },
    receipt ?? receiverTime,
  );
  if (plan.kind === "drop") return plan;
  if (receipt && plan.receiverTime !== receipt) throw new Error("KRAM cache and ready receipt disagree");
  return {
    kind: "candidate",
    plan,
    envelope: verified?.envelope ?? envelope,
    pool,
    kever,
    establishment,
    complete,
    multi,
    receipt,
  };
}
/** Remove stale partial ownership only; replay cache and shared opener remain independent. */
function discardPartial(db: Baser, key: readonly string[]): void {
  removeKramFactors(db, key);
  removeKramSnapshot(db, key);
  db.kready.rem(key);
}

/**
 * Stage one parent while borrowing fresh input and owning hydrated snapshots through consume.
 * Recheck KEL establishment, current policy/cache and original ready receipt after async reads.
 * Publish cache, factors, private wire and first-ready timestamp in one transaction.
 * No acknowledgement occurs here. Consumer results MUST NOT retain hydration/frame/payload owners;
 * the generic result type cannot enforce that contract. Consumer/cleanup failures propagate,
 * retaining durable ready state for at-least-once handoff. No public Kramer intake is installed.
 */
export function* stageKram<T>(
  db: Baser,
  policy: KramPolicy,
  incoming: KeriDispatchEnvelope,
  receiverTime: string,
  consume: (ready: KeriDispatchEnvelope, key: readonly string[], receiverTime: string) => Operation<T>,
): Operation<KramStageResult<T>> {
  if (!db.env) throw new Error("KRAM staging database is closed");
  const initial = candidate(db, policy, incoming, receiverTime);
  if (initial.kind === "rotated") {
    return db.env.transactionSync(() => {
      const fresh = candidate(db, policy, incoming, receiverTime);
      if (fresh.kind === "rotated") {
        discardPartial(db, fresh.key);
        return { kind: "drop", reason: "replay" } as const;
      }
      return fresh.kind === "candidate" ? { kind: "drop", reason: "changed" } as const : fresh;
    });
  }
  if (initial.kind !== "candidate") return initial;
  const received = receivedFactors(db, initial.envelope);
  const key = initial.plan.key, snapshotBefore = snapshotIdentity(db, key);
  return yield* withKramHydration(db, key, received, function*(hydrated) {
    const snapshot = yield* snapshotKram(hydrated);
    const staged = db.env!.transactionSync(() => {
      const fresh = candidate(db, policy, received, receiverTime);
      if (fresh.kind === "rotated") {
        discardPartial(db, fresh.key);
        return { kind: "drop", reason: "replay" } as const;
      }
      if (fresh.kind !== "candidate") return fresh;
      if (initial.receipt && fresh.receipt !== initial.receipt) {
        throw new Error("KRAM ready receipt changed during staging");
      }
      if (fresh.establishment !== initial.establishment || snapshotIdentity(db, key) !== snapshotBefore) {
        return { kind: "drop", reason: "changed" } as const;
      }
      const { plan } = fresh;
      if (plan.record instanceof TxnMsgCacheRecord) {
        db.tmsc.pin(plan.cacheKey, plan.record);
        db.xdt.pin(plan.xid, new Dater({ qb64: encodeDateTimeToDater(plan.record.xdt!) }));
      } else db.msgc.pin(key, plan.record);
      db.pmkm.pin(key, incoming.serder);
      for (const sig of fresh.pool) db.pmks.add(key, sig);
      if (fresh.pool.length) {
        db.pmsk.pin(key, [
          NumberPrimitive.fromNum(BigInt(fresh.kever.lastEst.s)),
          new Diger({ qb64: fresh.kever.lastEst.d }),
        ]);
      }
      // Unknown foreign last groups were unknown at receipt; preserve their markers without later reinterpretation.
      const factors = new KeriDispatchEnvelope({
        ...fresh.envelope,
        attachmentGroups: [...fresh.envelope.attachmentGroups],
        ssgs: [],
        unresolvedLast: [...fresh.envelope.unresolvedLast, ...fresh.envelope.ssgs.map((group) => group.prefixer)],
      });
      storeKramFactors(db, key, factors);
      validateKramFactors(db, key);
      storeKramSnapshot(db, key, snapshot);
      if (fresh.complete) db.kready.pin(key, fresh.receipt ?? plan.receiverTime);
      const delivery = rehydrateKramFactors(db, key, fresh.envelope);
      if (fresh.multi) {
        delivery.sigers.splice(0, delivery.sigers.length, ...[...fresh.pool].sort((a, b) => a.index - b.index));
        if (incoming.serder.ilk === "exn") {
          delivery.tsgs.splice(
            0,
            delivery.tsgs.length,
            establishmentGroup(fresh.kever, fresh.pool),
            ...delivery.tsgs.filter((group) => group.pre !== incoming.serder.pre),
          );
        }
      }
      return { kind: "staged", fresh, delivery } as const;
    });
    if (staged.kind !== "staged") return staged;
    if (!staged.fresh.complete) return { kind: "pending", key } as const;
    const receipt = staged.fresh.receipt ?? staged.fresh.plan.receiverTime;
    const ready = new KeriDispatchEnvelope({
      ...staged.delivery,
      attachmentGroups: [...hydrated.attachmentGroups],
      nests: [...hydrated.nests],
      essr: hydrated.essr,
    });
    return { kind: "ready", key, receiverTime: receipt, value: yield* consume(ready, key, receipt) } as const;
  });
}
