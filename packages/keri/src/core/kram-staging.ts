/** Internal atomic KRAM staging; the intake owner supplies queries and plain ready decisions. */
import { Dater, Diger, NumberPrimitive, type Prefixer, type Siger } from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { rehydrateKramFactors, removeKramFactors, storeKramFactors } from "../db/kram-factors.ts";
import { encodeDateTimeToDater } from "../time/mod.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup } from "./dispatch.ts";
import type { Kever } from "./kever.ts";
import { authenticateKramSource } from "./kram-auth.ts";
import type { KramPolicy } from "./kram-policy.ts";
import { normalizeKramSenderFactors, verifyKramSignatures } from "./kram-signatures.ts";
import { evaluateKramTime, inspectKramReplay, type KramTimePlan, type KramTimeRefusal } from "./kram-time.ts";
import { TxnMsgCacheRecord } from "./records.ts";

/** Normal refusals retain their cause; infrastructure and corruption errors propagate. */
export type KramStageRefusal =
  | KramTimeRefusal
  | { kind: "drop"; reason: "authentication" }
  | { kind: "missing"; sender: string; sn: bigint | null };
/** Ready evidence borrows children and payloads from the current parser input. */
export type KramStageResult = KramStageRefusal | { kind: "pending"; key: readonly string[] } | {
  kind: "ready";
  key: readonly string[];
  receiverTime: string;
  envelope: KeriDispatchEnvelope;
};
/** A stale sender pool must be removed atomically while retaining the replay cache. */
type RotatedPartial = { kind: "rotated"; key: readonly string[] };
/** Authentication, time and threshold facts for one synchronous transaction. */
interface Candidate {
  kind: "candidate";
  plan: KramTimePlan;
  envelope: KeriDispatchEnvelope;
  pool: Siger[];
  kever: Kever;
  complete: boolean;
  multi: boolean;
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
function receivedFactors(db: Baser, incoming: KeriDispatchEnvelope) {
  const received = normalizeKramSenderFactors(incoming);
  const resolvedLast: Prefixer[] = [];
  const pending = received.ssgs.filter((group) => {
    const kever = db.getKever(group.pre, { refresh: true });
    if (!kever) return true;
    received.tsgs.push(establishmentGroup(kever, group.sigers));
    resolvedLast.push(group.prefixer);
    return false;
  });
  received.ssgs.splice(0, received.ssgs.length, ...pending);
  return { received, resolvedLast };
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
  const key = [sender, said];
  const inspection = inspectKramReplay(db, body);
  if (inspection.kind === "drop") return inspection;
  const envelope = normalizeKramSenderFactors(incoming);
  const hasSeal = envelope.sscs.length > 0;
  const hasSigs = envelope.sigers.length > 0 || envelope.tsgs.some((group) => group.pre === sender)
    || envelope.cigars.some((cigar) => cigar.verfer?.qb64 === sender);
  if (!hasSeal && !hasSigs) return { kind: "drop", reason: "authentication" };
  if (inspection.cache && hasSeal && !hasSigs) return { kind: "drop", reason: "replay" };
  const source = authenticateKramSource(db, envelope);
  if (source.kind === "missing") return source;
  const kever = db.getKever(sender, { refresh: true });
  if (!kever) return { kind: "missing", sender, sn: null };
  const saved: Siger[] = [];
  if (inspection.partial) {
    for (const sig of db.pmks.getIter(key)) {
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
    receiverTime,
  );
  if (plan.kind === "drop") return plan;
  return {
    kind: "candidate",
    plan,
    envelope: verified?.envelope ?? envelope,
    pool,
    kever,
    complete,
    multi,
  };
}
/**
 * Authenticate and publish cache/factors atomically, retiring partial state on
 * threshold completion. Persist scalar proofs only; nested frames and ESSR remain
 * borrowed from the current input and are never read or disposed by KRAM.
 */
export function stageKram(
  db: Baser,
  policy: KramPolicy,
  incoming: KeriDispatchEnvelope,
  receiverTime: string,
): KramStageResult {
  if (!db.env) throw new Error("KRAM staging database is closed");
  return db.env.transactionSync(() => {
    const fresh = candidate(db, policy, incoming, receiverTime);
    if (fresh.kind === "rotated") {
      removeKramFactors(db, fresh.key);
      return { kind: "drop", reason: "replay" } as const;
    }
    if (fresh.kind !== "candidate") return fresh;
    const { received, resolvedLast } = receivedFactors(db, fresh.envelope);
    const { plan } = fresh, key = plan.key;
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
    // Unknown foreign last groups retain their receipt-time meaning across KEL recovery.
    storeKramFactors(
      db,
      key,
      new KeriDispatchEnvelope({
        ...received,
        attachmentGroups: [...received.attachmentGroups],
        ssgs: [],
        unresolvedLast: [...received.unresolvedLast, ...received.ssgs.map((group) => group.prefixer)],
      }),
    );
    for (const prefix of resolvedLast) db.ulgs.rem(key, prefix);
    if (!fresh.complete) return { kind: "pending", key } as const;
    const envelope = rehydrateKramFactors(db, key, received);
    if (fresh.multi) {
      envelope.sigers.splice(0, envelope.sigers.length, ...[...fresh.pool].sort((a, b) => a.index - b.index));
      if (incoming.serder.ilk === "exn") {
        envelope.tsgs.splice(
          0,
          envelope.tsgs.length,
          establishmentGroup(fresh.kever, fresh.pool),
          ...envelope.tsgs.filter((group) => group.pre !== incoming.serder.pre),
        );
      }
    }
    removeKramFactors(db, key);
    return { kind: "ready", key, receiverTime: plan.receiverTime, envelope } as const;
  });
}
