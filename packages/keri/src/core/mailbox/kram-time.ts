/** Read-only KRAM replay inspection and receiver-clocked cache planning. */
import type { SerderKERI } from "cesr-ts";
import type { Baser } from "../../db/basing.ts";
import { timestampFromMicros, timestampMicros } from "../../time/mod.ts";
import { MsgCacheRecord, type MsgCacheRecordShape, TxnMsgCacheRecord } from "../records.ts";
import type { KramPolicy } from "./kram-policy.ts";

/** At least one authenticator has verified; multi-key threshold completion is separate. */
export type KramTimeAuthentication = { kind: "seal" | "single" } | { kind: "multi"; complete: boolean };
/** Why replay or timeliness policy refused a message. */
export type KramRefusalReason = "timestamp" | "replay" | "timeliness" | "unknownThread" | "lifetime";
/** Refusals KRAM decides only after a current-key signature or anchored seal verified, so the sender is authenticated. */
export type KramLateReason = Extract<KramRefusalReason, "timeliness" | "lifetime" | "unknownThread">;

/**
 * Whether a drop reason means an authenticated message arrived too late or outside a live exchange.
 *
 * `timestamp`, `replay` and `authentication` are reachable by anyone who can post bytes (see kram-staging.ts),
 * so callers that report or signal a refusal to anyone beyond the log must restrict themselves to these three.
 */
export function isKramLateReason(reason: unknown): reason is KramLateReason {
  return reason === "timeliness" || reason === "lifetime" || reason === "unknownThread";
}

/**
 * Remote refusal is distinct from corrupt local state or infrastructure failure.
 * `deadline` (ISO 8601) is the last receiver instant the message was acceptable: stamp + drift + lag for
 * `timeliness` (KERIpy `Kramer.deadline`), opener + exchange window for `lifetime`; absent for other reasons.
 */
export interface KramTimeRefusal {
  kind: "drop";
  reason: KramRefusalReason;
  deadline?: string;
}
/** Receiver-independent inspection lets callers drop completed replays before source queries. */
export interface KramReplayInspection {
  kind: "new" | "cached";
  body: SerderKERI;
  key: readonly [string, string];
  cacheKey: readonly string[];
  xid: string;
  mdt: bigint;
  partial: boolean;
  cache: MsgCacheRecord | TxnMsgCacheRecord | null;
}
/** No cache, opener, receipt time or partial state is published by a plan. */
export type KramTimePlan = Omit<KramReplayInspection, "kind"> & {
  kind: "proceed";
  record: MsgCacheRecord | TxnMsgCacheRecord;
  receiverTime: string;
};

/** Validate durable cache values without turning corruption into remote refusal. */
export function kramCacheValues(cache: MsgCacheRecord | TxnMsgCacheRecord): Required<MsgCacheRecordShape> {
  const { mdt, d, ml, pml, xl, pxl } = cache;
  if (
    timestampMicros(mdt) === null || [d, ml, pml, xl, pxl].some((v) => !Number.isSafeInteger(v) || v! < 0)
    || pml! < ml! || pxl! < xl!
    || (cache instanceof TxnMsgCacheRecord
      && (timestampMicros(cache.xdt) === null || (cache.rdt && timestampMicros(cache.rdt) === null)))
  ) throw new Error("Corrupt KRAM timeliness cache");
  return { mdt: mdt!, d: d!, ml: ml!, pml: pml!, xl: xl!, pxl: pxl! };
}

/** Exchange id KRAM threads a message by: the `xip` SAID or the v2 `exn` `x` field; empty when it has none. */
export function kramExchangeId(body: SerderKERI): string {
  const said = body.said;
  return body.ilk === "xip" ? said ?? "" : body.ilk === "exn" && body.pvrsn.major >= 2 ? String(body.ked?.x ?? "") : "";
}

/**
 * Inspect frozen message/xid routing and strict completed-message replay rules.
 * Only an incomplete multi-signature message retains partial state.
 */
export function inspectKramReplay(db: Baser, body: SerderKERI): KramReplayInspection | KramTimeRefusal {
  const mdt = timestampMicros(body.stamp);
  if (mdt === null) return { kind: "drop", reason: "timestamp" };
  const sender = body.pre, said = body.said;
  if (!sender || !said) throw new Error("KRAM replay inspection requires sender and message SAID");
  const key = [sender, said] as const;
  const xid = kramExchangeId(body);
  const cacheKey = xid ? [sender, xid, said] : key;
  const cache = xid ? db.tmsc.get(cacheKey) : db.msgc.get(cacheKey);
  const partial = db.pmkm.get(key) !== null;
  if (cache) {
    const values = kramCacheValues(cache);
    if (mdt <= timestampMicros(values.mdt)! && !partial) {
      return { kind: "drop", reason: "replay" };
    }
  }
  return { kind: cache ? "cached" : "new", body, key, cacheKey, xid, mdt, partial, cache };
}

function within(value: bigint, lower: bigint, upper: bigint): boolean {
  return lower <= value && value <= upper;
}

/**
 * Resolve sender-local/shared openers and retain cached multi windows.
 * Receipt time freezes at completion. Staging publishes the cache atomically.
 */
export function evaluateKramTime(
  db: Baser,
  policy: KramPolicy,
  inspection: KramReplayInspection,
  authentication: KramTimeAuthentication,
  receiverTime: string,
): KramTimePlan | KramTimeRefusal {
  const receipt = timestampMicros(receiverTime);
  if (receipt === null) throw new Error("Invalid KRAM receiver clock");
  const { body, cache, xid, mdt } = inspection;
  if (cache && authentication.kind !== "multi") return { kind: "drop", reason: "replay" };
  let values: Required<MsgCacheRecordShape>;
  if (cache) values = kramCacheValues(cache);
  else {
    const type = policy.cacheType(body.ilk!, body.route), multi = authentication.kind === "multi";
    const ml = multi ? type.ll : type.sl, pml = multi ? type.pll : type.psl;
    const reach = (BigInt(type.d) + BigInt(ml)) * 1000n;
    if (!within(mdt, receipt - reach, receipt + BigInt(type.d) * 1000n)) {
      return { kind: "drop", reason: "timeliness", deadline: timestampFromMicros(mdt + reach) };
    }
    values = { mdt: body.stamp!, d: type.d, ml, pml, xl: type.xl, pxl: type.pxl };
  }
  if (!xid) return { ...inspection, kind: "proceed", record: new MsgCacheRecord(values), receiverTime };
  let xdt = cache instanceof TxnMsgCacheRecord ? cache.xdt : undefined;
  if (!cache) {
    if (body.ilk === "xip") xdt = body.stamp!;
    else {
      for (const [, previous] of db.tmsc.getTopItemIter([inspection.key[0], xid])) {
        kramCacheValues(previous);
        xdt = previous.xdt;
        break;
      }
      xdt ??= db.xdt.get(xid)?.dts ?? (!body.ked?.p ? body.stamp! : undefined);
    }
  }
  if (xdt === undefined) return { kind: "drop", reason: "unknownThread" };
  const opener = timestampMicros(xdt);
  if (opener === null) throw new Error("Corrupt KRAM transaction opener");
  const closing = opener + BigInt(values.xl) * 1000n;
  if (!cache && !within(mdt, opener, closing)) {
    return { kind: "drop", reason: "lifetime", deadline: timestampFromMicros(closing) };
  }
  const complete = authentication.kind !== "multi" || authentication.complete;
  const rdt = cache instanceof TxnMsgCacheRecord && cache.rdt ? cache.rdt : complete ? receiverTime : "";
  return {
    ...inspection,
    kind: "proceed",
    record: new TxnMsgCacheRecord({ ...values, xdt, rdt }),
    receiverTime: rdt || receiverTime,
  };
}
