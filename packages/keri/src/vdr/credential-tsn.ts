import { Dater, Diger, SerderKERI, TraitDex } from "cesr-ts";
import { acceptEscrow, dropEscrow, keepEscrow } from "../core/kever-decisions.ts";
import { VcStateRecord } from "../core/records.ts";
import { acceptReplyDecision, type ReplyProcessDecision, Revery, unverifiedReplyDecision } from "../core/routing.ts";
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
  const a = row.a as Record<string, unknown>, ra = row.ra as Record<string, unknown>;
  if (Object.keys(a).length !== 2 || !Number.isSafeInteger(a.s) || Number(a.s) < 0) return null;
  if (Object.keys(ra).length && (Object.keys(ra).length !== 3 || !qualifiedPrefix(ra.i) || !ordinal(ra.s))) return null;
  try {
    for (const digest of [row.i, row.d, a.d, ...(Object.keys(ra).length ? [ra.d] : [])]) {
      if (typeof digest !== "string" || new Diger({ qb64: digest }).qb64 !== digest) return null;
    }
    return VcStateRecord.fromDict(row);
  } catch {
    return null;
  }
}

/** Credential TSN admission owns its attester proof, registry dependency and current TEL commitment.
 * Accepted configuration supplies trust; Broker owns pending proofs outside legacy Revery escrow.
 * Publication retains the outer reply SAID and refuses forged anchors or superseded issuance notices,
 * intentional corrections to actual 714's BADA and credential correspondence gaps.
 */
export class CredentialStateReceiver {
  constructor(private readonly tvy: Tevery, private readonly rvy: Revery) {}

  /** Revery's canonical route and Broker retries use the same current-state checks. */
  processReply({ serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs): ReplyProcessDecision {
    const refuse = (reason: string, escrow?: string) => unverifiedReplyDecision(reason, { escrow });
    const record = credentialRecord(serder.ked?.a);
    if (
      !record || !qualifiedPrefix(aid) || timestampMicros(serder.ked?.dt) === null
      || route !== `/tsn/credential/${aid}` || serder.said !== diger.qb64 || !serder.verify()
    ) return refuse("Invalid credential transaction-state notice.");
    const vci = record.i!, regk = record.ri!, sn = Number.parseInt(record.s!, 16);
    const previous = this.tvy.reger.txnsb.current([vci, aid]);
    const disposeIncoming = () => {
      if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(diger);
    };
    const reject = (reason: string) => {
      disposeIncoming();
      return refuse(reason);
    };
    const stored = this.tvy.reger.states.get(regk);
    if (stored && !registryRecord(stored.asDict())) throw new Error("Corrupt stored registry state.");
    const issuer = stored?.ii ?? aid;
    this.rvy.cues.checkSpace();
    const escrow = (typ: string, query: boolean) => {
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
      disposeIncoming();
      if (added && query) {
        this.rvy.cues.push({
          kin: "query",
          pre: issuer,
          src: aid,
          route: typ === "credential-mae" ? "logs" : "tels",
          query: typ === "credential-mae" ? { i: issuer } : { ri: regk, i: typ === "credential-mre" ? "" : vci },
        });
      }
      return refuse("Credential state dependency unavailable.", typ);
    };
    const regsn = record.ra!.s === undefined ? 0 : Number.parseInt(record.ra!.s as string, 16);
    if (!stored || Number.parseInt(stored.s!, 16) < regsn) return escrow("credential-mre", true);
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
      && !(stored.c!.includes(TraitDex.NoBackers) ? kever.wits : stored.b!).includes(aid)
    ) {
      return reject("Untrusted credential state attester.");
    }
    if (previous && (!this.tvy.db.sdts.get([previous.qb64]) || !this.tvy.db.rpys.get([previous.qb64]))) {
      throw new Error("Corrupt prior credential reply evidence.");
    }
    const proof = this.rvy.acceptReply({
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
    if (proof.kind !== "accept") {
      return proof.context?.pending ? escrow("credential-mae", false) : reject("Unverified credential state attester.");
    }
    const accepted = this.tvy.reger.tels.getOn(vci, sn);
    if (!accepted) return escrow("credential-ooo", true);
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
      || ["s", "d"].some((key) => record.a![key] !== current.a![key])
      || ["i", "s", "d"].some((key) => record.ra![key] !== current.ra![key])
    ) return reject("Credential state does not match current accepted TEL and anchors.");
    this.tvy.reger.txnsb.updateReply(
      aid,
      serder,
      diger,
      new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) }),
    );
    if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(previous);
    this.rvy.cues.push({ kin: "txnStateSaved", record });
    return acceptReplyDecision();
  }

  /** Dependency migration and terminal refusal remove indexes; the bounded Broker pass owns retry. */
  processEscrows(): void {
    for (const typ of ["credential-mre", "credential-mae", "credential-ooo"]) {
      this.tvy.reger.txnsb.retryStateNotices(typ, (args) => {
        const decision = this.processReply(args);
        if (decision.kind === "accept") return acceptEscrow();
        return decision.context?.escrow === typ ? keepEscrow("recoverableError") : dropEscrow("processingError");
      });
    }
  }
}
