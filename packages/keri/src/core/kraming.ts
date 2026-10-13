/** Optional KRAM authentication/timeliness intake before route-specific verification. */
import { b, Dater, Diger, NumberPrimitive, Prefixer, ResourceLimitError, SealSource, type Siger } from "cesr-ts";
import { call, type Operation, type Provide, resource } from "effection";
import type { Baser } from "../db/basing.ts";
import {
  rehydrateKram,
  removeKramPending,
  snapshotKram,
  storeKramFactors,
  validateKramFactors,
} from "../db/kram-pending.ts";
import { encodeDateTimeToDater, makeNowIso8601, timestampMicros } from "../time/mod.ts";
import { type AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup } from "./dispatch.ts";
import { Kever } from "./kever.ts";
import { type KramConfig, KramPolicy } from "./kram-policy.ts";
import { MsgCacheRecord, TxnMsgCacheRecord } from "./records.ts";

/** Expected intake refusals retain their capacity, dependency or verification reason. */
export interface KramRefusal {
  kind: "drop";
  reason:
    | "kramBusy"
    | "kramLimit"
    | "kramReplay"
    | "kramPending"
    | "kramTime"
    | "kramAuthentication"
    | "kramMissingState";
}
/** Authentication precedence matches the frozen reference's three lag classes. */
type AuthType = "seal" | "single" | "multi";
/** Only KRAM-ready messages may enter the downstream callback. */
interface ReadyMessage {
  kind: "ready";
  envelope: KeriDispatchEnvelope;
  key: readonly string[];
}
/** Checked snapshot windows carried by an interoperable timeliness cache. */
interface CacheValues {
  mdt: string;
  d: number;
  ml: number;
  pml: number;
  xl: number;
  pxl: number;
}
/** Replace a normalized factor list without mutating parsed wire attachment groups. */
function replace<T>(list: T[], items: readonly T[]): void {
  list.splice(0, list.length, ...items);
}
/** Distinguish malformed durable rows from ordinary incoming timeliness refusal. */
function cacheValues(record: MsgCacheRecord | TxnMsgCacheRecord): CacheValues {
  const { mdt, d, ml, pml, xl, pxl } = record;
  if (timestampMicros(mdt) === null || [d, ml, pml, xl, pxl].some((v) => !Number.isSafeInteger(v) || v! < 0)) {
    throw new Error("Corrupt KRAM timeliness cache");
  }
  return { mdt: mdt!, d: d!, ml: ml!, pml: pml!, xl: xl!, pxl: pxl! };
}
/** Exact inclusive millisecond windows applied to microsecond-qualified timestamps. */
function within(stamp: bigint, start: bigint, end: bigint): boolean {
  return start <= stamp && stamp <= end;
}

/**
 * Authenticate sender factors and timeliness, then borrow evidence to a route owner.
 * Partial state uses existing KERIpy tables plus bounded private tree snapshots.
 * Complete handoff remains retryable after I/O failure; a successful callback
 * clears partial ownership while retaining its replay marker and receiver time.
 */
export class Kramer {
  readonly db: Baser;
  readonly cues: Deck<AgentCue>;
  readonly policy: KramPolicy;
  private readonly now: () => number;
  private active = false;
  /** Each pruning pass captures a finite range and closes every cursor before mutation. */
  private readonly pruning: { start?: Uint8Array; end?: Uint8Array }[] = [{}, {}];

  constructor(
    db: Baser,
    { config = {}, cues = new Deck<AgentCue>(), now = Date.now }: {
      config?: KramConfig;
      cues?: Deck<AgentCue>;
      now?: () => number;
    } = {},
  ) {
    this.db = db;
    this.cues = cues;
    this.now = now;
    this.policy = new KramPolicy(db, config, now);
  }

  /** Own cancellable snapshot hydration through downstream consumption and joined cleanup. */
  *intake<T>(
    incoming: KeriDispatchEnvelope,
    consume: (envelope: KeriDispatchEnvelope) => Operation<T>,
  ): Operation<T | KramRefusal> {
    return yield* call(function*(this: Kramer) {
      if (this.active) return { kind: "drop", reason: "kramBusy" } as KramRefusal;
      yield* resource<void>(function*(this: Kramer, provide: Provide<void>) {
        this.active = true;
        try {
          yield* provide(undefined);
        } finally {
          this.active = false;
        }
      }.bind(this));
      // Acquire before the work child: abort joins its reads/owners before freeing admission.
      return yield* call(function*(this: Kramer) {
        this.policy.reconcile();
        if (this.policy.exempts(incoming.serder)) return yield* consume(incoming);
        let decision: ReadyMessage | KramRefusal;
        try {
          decision = yield* this.admit(incoming);
        } catch (error) {
          if (error instanceof ResourceLimitError) return { kind: "drop", reason: "kramLimit" } as KramRefusal;
          throw error;
        }
        if (decision.kind !== "ready") return decision;
        this.normalizeReceipt(incoming, decision.envelope);
        const result = yield* consume(decision.envelope);
        this.transaction(() => removeKramPending(this.db, decision.key));
        return result;
      }.bind(this));
    }.bind(this));
  }

  /** Publish normalized parent factors to ingress callbacks; reopened payloads stay callback-scoped. */
  private normalizeReceipt(incoming: KeriDispatchEnvelope, ready: KeriDispatchEnvelope): void {
    replace(incoming.sigers, ready.sigers);
    replace(incoming.tsgs, ready.tsgs);
    replace(incoming.ssgs, ready.ssgs);
    replace(incoming.cigars, ready.cigars);
    replace(incoming.sscs, ready.sscs);
    replace(incoming.ssts, ready.ssts);
    replace(incoming.unresolvedLast, ready.unresolvedLast);
  }

  /** Change only cache policy; supplied exemptions/enabled state are construction-time policy. */
  changeConfig(caches: KramConfig["caches"], delay?: number): void {
    this.policy.change(caches, delay);
  }

  /** Prune a finite batch, retaining the shared opener until its final transaction row disappears. */
  prune(maxRows = 128): number {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new RangeError("Invalid KRAM pruning batch");
    if (this.active) return 0;
    this.policy.reconcile();
    const now = this.now();
    if (!Number.isSafeInteger(now)) throw new Error("Invalid KRAM receiver clock");
    const when = BigInt(now) * 1000n;
    let removed = 0;
    for (const [family, table] of [this.db.msgc, this.db.tmsc].entries()) {
      const cursor = this.pruning[family];
      if (!cursor.end) {
        for (const key of table.sdb.getKeys({ reverse: true, limit: 1 })) {
          cursor.end = b(`${new TextDecoder().decode(key)}\0`);
        }
      }
      if (!cursor.end) continue;
      let visited = 0;
      while (visited++ < maxRows) {
        let physical: Uint8Array | undefined;
        for (const key of table.sdb.getKeys({ start: cursor.start, end: cursor.end, limit: 1 })) physical = key;
        if (!physical) {
          cursor.start = undefined;
          cursor.end = undefined;
          break;
        }
        const text = new TextDecoder().decode(physical), keys = text.split(".");
        cursor.start = b(`${text}\0`);
        const record = table.get(keys);
        if (!record) throw new Error("KRAM pruning row disappeared");
        const cache = cacheValues(record);
        let expired: boolean;
        if (family === 0) {
          expired = !within(
            timestampMicros(cache.mdt)!,
            when - (BigInt(cache.d) + BigInt(cache.pml)) * 1000n,
            when + BigInt(cache.d) * 1000n,
          );
        } else {
          const opener = timestampMicros((record as TxnMsgCacheRecord).xdt);
          if (opener === null) throw new Error("Corrupt KRAM transaction opener");
          expired = !within(when, opener, opener + BigInt(cache.pxl) * 1000n);
        }
        if (!expired) continue;
        this.transaction(() => {
          table.rem(keys);
          removeKramPending(this.db, [keys[0], keys.at(-1)!]);
          if (family === 1) {
            let remains = false;
            // This scan retains no aggregate list; phase 4 owns its consumed-work checkpoints.
            for (const [other] of this.db.tmsc.getTopItemIter()) {
              if (other[1] === keys[1]) {
                remains = true;
                break;
              }
            }
            if (!remains) this.db.xdt.rem(keys[1]);
          }
        });
        removed++;
      }
    }
    return removed;
  }

  /** Request missing sender state through the established runtime query cue seam. */
  private missing(sender: string, sn: bigint | null = null): KramRefusal {
    this.cues.push({
      kin: "query",
      pre: sender,
      q: { r: "logs", pre: sender, ...(sn === null ? {} : { sn: sn.toString(16) }) },
    });
    return { kind: "drop", reason: "kramMissingState" };
  }

  /** Source references use the last sender-implied candidate and its accepted KEL event. */
  private seal(envelope: KeriDispatchEnvelope): boolean | KramRefusal {
    const source = envelope.sscs.at(-1);
    if (!source) return false;
    const sender = envelope.serder.pre!;
    if (source.s.num > BigInt(Number.MAX_SAFE_INTEGER)) return false;
    const said = this.db.kels.getLast(sender, Number(source.s.num));
    if (!said) return this.missing(sender, source.s.num);
    if (said !== source.d.qb64) return false;
    const event = this.db.getEvtSerder(sender, said);
    if (!event) return this.missing(sender, source.s.num);
    return event.seals.some((value) =>
      value && typeof value === "object" && !Array.isArray(value) && "d" in value && value.d === envelope.serder.said
    );
  }

  /** Pool only current sender keys; foreign proofs remain separate for the route owner. */
  private signatures(envelope: KeriDispatchEnvelope, kever: Kever): { valid: boolean; sigers: Siger[] } {
    const sender = envelope.serder.pre!;
    replace(
      envelope.tsgs,
      envelope.tsgs.filter((group) =>
        group.pre !== sender || (group.sn === BigInt(kever.lastEst.s) && group.said === kever.lastEst.d)
      ),
    );
    for (const cigar of envelope.cigars) {
      if (
        cigar.verfer && !cigar.verfer.transferable && cigar.verfer.qb64 === sender
        && cigar.verfer.verify(cigar.raw, envelope.serder.raw)
      ) return { valid: true, sigers: [] };
    }
    const pool = [...envelope.sigers];
    for (const group of envelope.tsgs) if (group.pre === sender) pool.push(...group.sigers);
    const verified = Kever.verifyIndexedSignatures(envelope.serder.raw, pool, kever.verfers);
    const ids = new Set(verified.sigers.map((s) => s.qb64));
    replace(
      envelope.sigers,
      pool.filter((s) => ids.has(s.qb64)).filter((s, i, all) => all.findIndex((v) => v.qb64 === s.qb64) === i),
    );
    replace(
      envelope.tsgs,
      envelope.tsgs.flatMap((group) => {
        if (group.pre !== sender) return [group];
        const sigs = group.sigers.filter((s) => ids.has(s.qb64));
        return sigs.length ? [new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, sigs)] : [];
      }),
    );
    if (envelope.serder.ilk === "exn" && verified.sigers.length) this.senderGroup(envelope, kever, verified.sigers);
    return { valid: verified.sigers.length > 0, sigers: verified.sigers };
  }

  /** Convert the verified sender pool into an explicit establishment reference for Exchanger. */
  private senderGroup(envelope: KeriDispatchEnvelope, kever: Kever, sigers: readonly Siger[]): void {
    replace(envelope.tsgs, [
      new TransIdxSigGroup(
        kever.prefixer,
        NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
        new Diger({ qb64: kever.lastEst.d }),
        sigers,
      ),
      ...envelope.tsgs.filter((g) => g.pre !== envelope.serder.pre),
    ]);
  }

  /** Normalize sender-owned last groups and source triples without touching child proofs. */
  private normalize(incoming: KeriDispatchEnvelope): KeriDispatchEnvelope {
    const envelope = new KeriDispatchEnvelope({ ...incoming, attachmentGroups: [...incoming.attachmentGroups] });
    for (const seal of envelope.ssts) {
      if (seal.i.qb64 === envelope.serder.pre) envelope.sscs.push(SealSource.fromTuple([seal.s, seal.d]));
    }
    replace(envelope.ssts, envelope.ssts.filter((seal) => seal.i.qb64 !== envelope.serder.pre));
    for (const group of envelope.ssgs) if (group.pre === envelope.serder.pre) envelope.sigers.push(...group.sigers);
    replace(envelope.ssgs, envelope.ssgs.filter((group) => group.pre !== envelope.serder.pre));
    return envelope;
  }

  /** Decide and durably stage one fully authenticated or partially signed message. */
  private *admit(incoming: KeriDispatchEnvelope): Operation<ReadyMessage | KramRefusal> {
    let envelope = this.normalize(incoming);
    const body = envelope.serder, sender = body.pre, said = body.said;
    const mdt = timestampMicros(body.ked?.dt);
    if (!sender || !said || mdt === null) return { kind: "drop", reason: "kramTime" };
    const key = [sender, said];
    const xid = body.ilk === "xip"
      ? said
      : body.ilk === "exn" && body.pvrsn.major >= 2
      ? String(body.ked?.x ?? "")
      : "";
    const txKey = [sender, xid, said];
    const stored = xid ? this.db.tmsc.get(txKey) : this.db.msgc.get(key);
    const cached = stored ? cacheValues(stored) : null;
    const partial = this.db.pmkm.get(key);
    const handingOff = this.db.kready.get(key) === "1";
    if (cached && mdt <= timestampMicros(cached.mdt)! && !partial) return { kind: "drop", reason: "kramReplay" };
    if (partial && (partial.raw.length !== body.raw.length || !partial.raw.every((byte, i) => byte === body.raw[i]))) {
      return { kind: "drop", reason: "kramAuthentication" };
    }
    const hasSeal = envelope.sscs.length > 0;
    const hasSigs = envelope.sigers.length > 0 || envelope.tsgs.some((g) => g.pre === sender)
      || envelope.cigars.some((c) => c.verfer?.qb64 === sender);
    if (!hasSeal && !hasSigs) return { kind: "drop", reason: "kramAuthentication" };
    if (cached && hasSeal && !hasSigs && !handingOff) return { kind: "drop", reason: "kramReplay" };
    const kever = this.db.getKever(sender, { refresh: true });
    if (!kever) return this.missing(sender);
    let sealValid = false;
    if (hasSeal) {
      const result = this.seal(envelope);
      if (typeof result === "object") return result;
      sealValid = result;
      if (cached && result && !handingOff) return { kind: "drop", reason: "kramReplay" };
    }
    const auth: AuthType = sealValid ? "seal" : kever.verfers.length === 1 ? "single" : "multi";
    if (hasSeal && !hasSigs && !sealValid) return { kind: "drop", reason: "kramAuthentication" };
    if (cached && auth === "single" && !handingOff) return { kind: "drop", reason: "kramReplay" };
    const established = this.db.pmsk.get(key);
    if (
      cached && auth === "multi" && established
      && (established[0].num !== BigInt(kever.lastEst.s) || established[1].qb64 !== kever.lastEst.d)
    ) {
      this.transaction(() => removeKramPending(this.db, key));
      return { kind: "drop", reason: "kramReplay" };
    }
    const type = cached
      ? { d: cached.d, sl: cached.ml, ll: cached.ml, xl: cached.xl, psl: cached.pml, pll: cached.pml, pxl: cached.pxl }
      : this.policy.cacheType(body.ilk!, body.route);
    const ml = auth === "multi" ? type.ll : type.sl;
    const pml = auth === "multi" ? type.pll : type.psl;
    const now = this.now();
    if (!Number.isSafeInteger(now)) throw new Error("Invalid KRAM receiver clock");
    const receipt = BigInt(now) * 1000n;
    if (!cached && !within(mdt, receipt - (BigInt(type.d) + BigInt(ml)) * 1000n, receipt + BigInt(type.d) * 1000n)) {
      return { kind: "drop", reason: "kramTime" };
    }
    let xdt = "";
    if (xid) {
      if (stored instanceof TxnMsgCacheRecord) xdt = stored.xdt ?? "";
      else if (body.ilk === "xip") xdt = body.ked!.dt as string;
      else {
        for (const [, record] of this.db.tmsc.getTopItemIter([sender, xid])) {
          xdt = record.xdt ?? "";
          break;
        }
        xdt ||= this.db.xdt.get(xid)?.dts ?? (!body.ked?.p ? body.ked!.dt as string : "");
      }
      const opener = timestampMicros(xdt);
      if (cached && opener === null) throw new Error("Corrupt KRAM transaction opener");
      if (opener === null || (!cached && !within(mdt, opener, opener + BigInt(type.xl) * 1000n))) {
        return { kind: "drop", reason: "kramTime" };
      }
    }
    const verified = auth === "seal"
      ? (hasSigs && body.ilk === "exn" ? this.signatures(envelope, kever) : { valid: true, sigers: [] })
      : this.signatures(envelope, kever);
    if (auth !== "seal" && !verified.valid) return { kind: "drop", reason: "kramAuthentication" };
    const storedSigs: Siger[] = [];
    if (partial) {
      for (const sig of this.db.pmks.getIter(key)) {
        if (storedSigs.length >= 4096) throw new ResourceLimitError("KRAM signature pool exceeds finite limits");
        storedSigs.push(sig);
      }
    }
    const pool = Kever.verifyIndexedSignatures(body.raw, storedSigs, kever.verfers).sigers;
    if (pool.length !== storedSigs.length) throw new Error("Stored KRAM signature pool is inconsistent");
    const indices = new Set(pool.map((s) => s.index));
    for (const sig of verified.sigers) {
      if (!indices.has(sig.index)) {
        pool.push(sig);
        indices.add(sig.index);
      }
    }
    if (auth === "multi" && !kever.tholder) throw new Error("Accepted sender has no signature threshold");
    const ready = auth !== "multi" || !!kever.tholder?.satisfy([...indices]);
    // Hydrate stored descendants under this scope before replacing their snapshot.
    if (partial) envelope = yield* rehydrateKram(this.db, key, envelope);
    if (ready && auth === "multi") {
      replace(envelope.sigers, [...pool].sort((a, b) => a.index - b.index));
      if (body.ilk === "exn") this.senderGroup(envelope, kever, pool);
    }
    const snapshot = yield* snapshotKram(envelope);
    const rdts = makeNowIso8601(new Date(now));
    const record = cached ?? { mdt: body.ked!.dt as string, d: type.d, ml, pml, xl: type.xl, pxl: type.pxl };
    this.transaction(() => {
      if (xid) {
        const previousRdt = stored instanceof TxnMsgCacheRecord ? stored.rdt : undefined;
        this.db.tmsc.pin(txKey, { ...record, xdt, rdt: previousRdt || (ready ? rdts : "") });
        this.db.xdt.pin(xid, new Dater({ qb64: encodeDateTimeToDater(xdt) }));
      } else if (!cached) this.db.msgc.pin(key, record);
      this.db.pmkm.pin(key, body);
      for (const sig of pool) this.db.pmks.add(key, sig);
      this.db.pmsk.pin(key, [NumberPrimitive.fromNum(BigInt(kever.lastEst.s)), new Diger({ qb64: kever.lastEst.d })]);
      storeKramFactors(this.db, key, envelope);
      validateKramFactors(this.db, key);
      if (snapshot) this.db.kpnd.sdb.putSync(b(key.join(".")), snapshot);
      if (ready) this.db.kready.pin(key, "1");
    });
    return ready ? { kind: "ready", envelope, key } : { kind: "drop", reason: "kramPending" };
  }

  /** Keep cache, partial factors and ownership markers in one durable transaction. */
  private transaction(mutate: () => void): void {
    if (!this.db.env) throw new Error("KRAM database is closed");
    this.db.env.transactionSync(mutate);
  }
}
