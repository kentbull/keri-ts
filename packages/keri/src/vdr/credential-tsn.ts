import { Dater, Diger, SerderKERI, TraitDex } from "cesr-ts";
import type { PreparedCueBatch } from "../core/cue-admission.ts";
import { type CuePublisher, cuePublisher } from "../core/cue-publishing.ts";
import type { AgentCue } from "../core/cues.ts";
import { acceptEscrow, dropEscrow, keepEscrow } from "../core/kever-decisions.ts";
import { VcStateRecord } from "../core/records.ts";
import {
  acceptReplyDecision,
  type ReplyPlan,
  type ReplyProcessDecision,
  Revery,
  unverifiedReplyDecision,
} from "../core/routing.ts";
import { dgKey } from "../db/core/keys.ts";
import type { BrokerProcessReplyArgs } from "../db/escrowing.ts";
import { encodeDateTimeToDater, timestampMicros } from "../time/mod.ts";
import { Tever, Tevery } from "./eventing.ts";
import { qualifiedPrefix, registryRecord } from "./registry-tsn.ts";

/** Legacy storage ordinals are safe integers even though protocol numbers may be wider. */
function ordinal(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{1,14}$/i.test(value)
    && BigInt(`0x${value}`) <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Validate only the untrusted notice, including its independently carried anchor commitments. */
function credentialRecord(data: unknown): VcStateRecord | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !["vn", "i", "s", "d", "ri", "ra", "a", "dt", "et"].includes(key))
    || !ordinal(row.s) || !["iss", "bis", "rev", "brv"].includes(String(row.et))
    || !qualifiedPrefix(row.ri) || timestampMicros(row.dt) === null
    || !Array.isArray(row.vn) || row.vn.length !== 2 || row.vn.some((n) => !Number.isSafeInteger(n) || n < 0)
    || !row.a || typeof row.a !== "object" || Array.isArray(row.a)
    || !row.ra || typeof row.ra !== "object" || Array.isArray(row.ra)
  ) return null;
  const a = row.a, ra = row.ra;
  if (
    Object.keys(a).length !== 2 || !("s" in a) || typeof a.s !== "number"
    || !Number.isSafeInteger(a.s) || a.s < 0 || !("d" in a)
  ) return null;
  if (
    Object.keys(ra).length && (Object.keys(ra).length !== 3 || !("i" in ra) || !qualifiedPrefix(ra.i)
      || !("s" in ra) || !ordinal(ra.s) || !("d" in ra))
  ) return null;
  try {
    for (const digest of [row.i, row.d, a.d, ...(Object.keys(ra).length && "d" in ra ? [ra.d] : [])]) {
      if (typeof digest !== "string" || new Diger({ qb64: digest }).qb64 !== digest) return null;
    }
    return VcStateRecord.fromDict(row);
  } catch {
    return null;
  }
}

/** Dependency buckets owned by the credential notice receiver. */
type CredentialEscrowFamily = "credential-mre" | "credential-mae" | "credential-ooo";

/** Credential outcomes retain the receiver's exact dependency family. */
export type CredentialReplyDecision = ReplyProcessDecision<CredentialEscrowFamily>;

/** Credential TSN admission owns its attester proof, registry dependency and current TEL commitment.
 * Accepted configuration supplies trust; Broker owns pending proofs outside legacy Revery escrow.
 * Publication retains the outer reply SAID and refuses forged anchors or superseded issuance notices,
 * intentional corrections to actual 714's BADA and credential correspondence gaps.
 */
export class CredentialStateReceiver {
  private readonly publisher: CuePublisher;
  constructor(private readonly tvy: Tevery, private readonly rvy: Revery) {
    this.publisher = cuePublisher(rvy.cues);
  }

  /** Revery's canonical route and Broker retries use the same current-state checks. */
  processReply({ serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs): CredentialReplyDecision {
    const record = credentialRecord(serder.ked?.a);
    if (
      !record || !qualifiedPrefix(aid) || timestampMicros(serder.ked?.dt) === null
      || route !== `/tsn/credential/${aid}` || serder.said !== diger.qb64 || !serder.verify()
    ) return unverifiedReplyDecision("Invalid credential transaction-state notice.");
    const vci = record.i!, regk = record.ri!, sn = Number.parseInt(record.s!, 16);
    const previous = this.tvy.reger.txnsb.current([vci, aid]);
    const disposeIncoming = () => {
      if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(diger);
    };
    const reject = (reason: string) => {
      disposeIncoming();
      return unverifiedReplyDecision(reason);
    };
    const saved = this.tvy.reger.states.get(regk);
    const stored = saved ? registryRecord(saved.asDict()) : null;
    if (saved && !stored) throw new Error("Corrupt stored registry state.");
    const issuer = stored?.ii ?? aid;
    this.publisher.preflight(1);
    let queries: PreparedCueBatch | undefined;
    const escrow = (typ: CredentialEscrowFamily, query: boolean, proof?: ReplyPlan): CredentialReplyDecision => {
      const isNew = !this.tvy.reger.txnsb.hasStateNotice(typ, vci, aid, diger);
      const cues: AgentCue[] = isNew && query
        ? [{
          kin: "query",
          pre: issuer,
          src: aid,
          route: typ === "credential-mae" ? "logs" : "tels",
          query: typ === "credential-mae" ? { i: issuer } : { ri: regk, i: typ === "credential-mre" ? "" : vci },
        }]
        : [];
      this.rvy.cues.checkSpace(cues.length);
      const child = cues.length ? this.publisher.prepare(cues) : undefined;
      try {
        if (proof) this.rvy.writeReply(proof);
        const added = this.tvy.reger.txnsb.escrowStateNotice({
          typ,
          pre: vci,
          aid,
          serder,
          diger,
          dater: new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) }),
          cigars,
          tsgs,
        });
        if (added !== isNew) throw new Error("Credential escrow membership changed before publication");
        disposeIncoming();
        queries?.publish();
        child?.publish();
        return {
          kind: "unverified",
          reason: "dependencyPending",
          family: typ,
          message: "Credential state dependency unavailable.",
        };
      } finally {
        child?.release();
      }
    };
    const regsn = record.ra!.s === undefined ? 0 : Number.parseInt(record.ra!.s, 16);
    if (!stored || Number.parseInt(stored.s, 16) < regsn) return escrow("credential-mre", true);
    const tever = new Tever({ db: this.tvy.db, reger: this.tvy.reger, rsr: stored });
    if (
      !tever.serder.verify() || tever.serder.said !== stored.d
      || this.tvy.reger.tels.getOn(regk, tever.sn)?.qb64 !== stored.d
    ) throw new Error("Corrupt accepted registry TEL state.");
    const kever = this.tvy.db.getKever(issuer, { refresh: true });
    if (!kever) return escrow("credential-mae", true);
    const watchers = new Set<string>();
    for (const [, habitat] of this.tvy.db.getHabItemIter()) {
      for (const watcher of habitat.watchers ?? []) watchers.add(watcher);
    }
    if (
      aid !== issuer && !watchers.has(aid)
      && !(stored.c.includes(TraitDex.NoBackers) ? kever.wits : stored.b).includes(aid)
    ) {
      return reject("Untrusted credential state attester.");
    }
    if (previous && (!this.tvy.db.sdts.get([previous.qb64]) || !this.tvy.db.rpys.get([previous.qb64]))) {
      throw new Error("Corrupt prior credential reply evidence.");
    }
    const proof = this.rvy.decideReply({
      serder,
      saider: diger,
      route,
      aid,
      cigars,
      tsgs,
      osaider: previous?.qb64 === diger.qb64 ? null : previous,
      retainPrevious: true,
      externalEscrow: true,
    });
    this.rvy.cues.checkSpace(proof.cues.length);
    queries = proof.cues.length ? this.publisher.prepare(proof.cues) : undefined;
    try {
      if (proof.kind !== "accept") {
        if (proof.reason === "proofPending") return escrow("credential-mae", false, proof);
        this.rvy.writeReply(proof);
        queries?.publish();
        return reject("Unverified credential state attester.");
      }
      const accepted = this.tvy.reger.tels.getOn(vci, sn);
      if (!accepted) return escrow("credential-ooo", true, proof);
      const current = tever.vcState(vci);
      const raw = this.tvy.reger.tvts.get(dgKey(vci, accepted.qb64));
      if (!raw || !current) throw new Error("Corrupt accepted credential TEL state.");
      const event = new SerderKERI({ raw });
      if (!event.verify() || event.pre !== vci || event.sn !== sn || event.said !== accepted.qb64) {
        throw new Error("Corrupt accepted credential TEL body.");
      }
      if (Tevery.registryKey(event) !== regk) return reject("Credential belongs to a different registry.");
      const fields = ["vn", "i", "s", "d", "ri", "dt", "et"] as const;
      if (
        accepted.qb64 !== record.d || fields.some((key) => JSON.stringify(record[key]) !== JSON.stringify(current[key]))
        || (["s", "d"] as const).some((key) => record.a![key] !== current.a![key])
        || (["i", "s", "d"] as const).some((key) => record.ra![key] !== current.ra![key])
      ) return reject("Credential state does not match current accepted TEL and anchors.");
      const cues: AgentCue[] = [{ kin: "txnStateSaved", record }];
      this.rvy.cues.checkSpace(cues.length);
      const child = this.publisher.prepare(cues);
      try {
        this.rvy.writeReply(proof);
        this.tvy.reger.txnsb.updateReply(
          aid,
          serder,
          diger,
          new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) }),
        );
        if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(previous);
        queries?.publish();
        child?.publish();
        return acceptReplyDecision();
      } finally {
        child?.release();
      }
    } finally {
      queries?.release();
    }
  }

  /** Dependency migration and terminal refusal remove indexes; the bounded Broker pass owns retry. */
  processEscrows(): void {
    for (const typ of ["credential-mre", "credential-mae", "credential-ooo"]) {
      this.tvy.reger.txnsb.retryStateNotices(typ, (args) => {
        const decision = this.processReply(args);
        if (decision.kind === "accept") return acceptEscrow();
        return decision.reason === "dependencyPending" && decision.family === typ
          ? keepEscrow("recoverableError")
          : dropEscrow("processingError");
      });
    }
  }
}
