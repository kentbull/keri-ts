/** Read-only KRAM replay inspection and receiver-clocked cache planning. */
import type { SerderKERI } from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { timestampMicros } from "../time/mod.ts";
import type { KramPolicy } from "./kram-policy.ts";
import { MsgCacheRecord, type MsgCacheRecordShape, TxnMsgCacheRecord } from "./records.ts";

/** At least one authenticator has verified; multi-key threshold completion is separate. */
export type KramTimeAuthentication = { kind: "seal" | "single" } | { kind: "multi"; complete: boolean };
/** Remote refusal is distinct from corrupt local state or infrastructure failure. */
export interface KramTimeRefusal {
  kind: "drop";
  reason: "timestamp" | "replay" | "timeliness" | "unknownThread" | "lifetime";
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
  /** Only a caller-proven durable ready record permits completed handoff resumption. */
  resumingReady: boolean;
  cache: MsgCacheRecord | TxnMsgCacheRecord | null;
}
/** No cache, opener, receipt time or partial state is published by a plan. */
export type KramTimePlan = Omit<KramReplayInspection, "kind"> & {
  kind: "proceed";
  record: MsgCacheRecord | TxnMsgCacheRecord;
  receiverTime: string;
};

/** Validate durable cache values without turning corruption into remote refusal. */
function cacheValues(cache: MsgCacheRecord | TxnMsgCacheRecord): Required<MsgCacheRecordShape> {
  const { mdt, d, ml, pml, xl, pxl } = cache;
  if (
    timestampMicros(mdt) === null || [d, ml, pml, xl, pxl].some((v) => !Number.isSafeInteger(v) || v! < 0)
    || pml! < ml! || pxl! < xl!
    || (cache instanceof TxnMsgCacheRecord
      && (timestampMicros(cache.xdt) === null || (cache.rdt && timestampMicros(cache.rdt) === null)))
  ) throw new Error("Corrupt KRAM timeliness cache");
  return { mdt: mdt!, d: d!, ml: ml!, pml: pml!, xl: xl!, pxl: pxl! };
}

/**
 * Inspect frozen message/xid routing and strict completed-message replay rules.
 * A ready resumption requires matching durable cache/partial state; its trusted
 * readiness and original receiver time are rechecked by K8.
 */
export function inspectKramReplay(
  db: Baser,
  body: SerderKERI,
  options: { resumingReady?: boolean } = {},
): KramReplayInspection | KramTimeRefusal {
  const mdt = timestampMicros(body.stamp);
  if (mdt === null) return { kind: "drop", reason: "timestamp" };
  const sender = body.pre, said = body.said;
  if (!sender || !said) throw new Error("KRAM replay inspection requires sender and message SAID");
  const key = [sender, said] as const;
  const xid = body.ilk === "xip" ? said : body.ilk === "exn" && body.pvrsn.major >= 2 ? String(body.ked?.x ?? "") : "";
  const cacheKey = xid ? [sender, xid, said] : key;
  const cache = xid ? db.tmsc.get(cacheKey) : db.msgc.get(cacheKey);
  const partial = db.pmkm.get(key) !== null, resumingReady = options.resumingReady ?? false;
  if (resumingReady && (!cache || !partial)) throw new Error("Ready KRAM resumption lacks cache or partial state");
  if (cache) {
    const values = cacheValues(cache);
    if (mdt <= timestampMicros(values.mdt)! && !partial) return { kind: "drop", reason: "replay" };
    if (resumingReady && cache instanceof TxnMsgCacheRecord && !cache.rdt) {
      throw new Error("Ready KRAM transaction lacks receiver time");
    }
  }
  return { kind: cache ? "cached" : "new", body, key, cacheKey, xid, mdt, partial, resumingReady, cache };
}

function within(value: bigint, lower: bigint, upper: bigint): boolean {
  return lower <= value && value <= upper;
}

/**
 * Resolve sender-local/shared openers and retain cached multi windows.
 * Receipt time freezes at completion; nontransaction ready retries supply their
 * durable original receiverTime. K8 rechecks and publishes all state atomically.
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
  if (cache && authentication.kind !== "multi" && !inspection.resumingReady) return { kind: "drop", reason: "replay" };
  let values: Required<MsgCacheRecordShape>;
  if (cache) values = cacheValues(cache);
  else {
    const type = policy.cacheType(body.ilk!, body.route), multi = authentication.kind === "multi";
    const ml = multi ? type.ll : type.sl, pml = multi ? type.pll : type.psl;
    if (!within(mdt, receipt - (BigInt(type.d) + BigInt(ml)) * 1000n, receipt + BigInt(type.d) * 1000n)) {
      return { kind: "drop", reason: "timeliness" };
    }
    values = { mdt: body.stamp!, d: type.d, ml, pml, xl: type.xl, pxl: type.pxl };
  }
  if (!xid) return { ...inspection, kind: "proceed", record: new MsgCacheRecord(values), receiverTime };
  let xdt = cache instanceof TxnMsgCacheRecord ? cache.xdt : undefined;
  if (!cache) {
    if (body.ilk === "xip") xdt = body.stamp!;
    else {
      for (const [, previous] of db.tmsc.getTopItemIter([inspection.key[0], xid])) {
        cacheValues(previous);
        xdt = previous.xdt;
        break;
      }
      xdt ??= db.xdt.get(xid)?.dts ?? (!body.ked?.p ? body.stamp! : undefined);
    }
  }
  if (xdt === undefined) return { kind: "drop", reason: "unknownThread" };
  const opener = timestampMicros(xdt);
  if (opener === null) throw new Error("Corrupt KRAM transaction opener");
  if (!cache && !within(mdt, opener, opener + BigInt(values.xl) * 1000n)) return { kind: "drop", reason: "lifetime" };
  const complete = authentication.kind !== "multi" || authentication.complete;
  const rdt = cache instanceof TxnMsgCacheRecord && cache.rdt ? cache.rdt : complete ? receiverTime : "";
  return {
    ...inspection,
    kind: "proceed",
    record: new TxnMsgCacheRecord({ ...values, xdt, rdt }),
    receiverTime: rdt || receiverTime,
  };
}
