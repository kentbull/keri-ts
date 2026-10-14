import { Dater, Diger, Prefixer, SerderKERI, TraitDex } from "cesr-ts";
import { acceptEscrow, dropEscrow, keepEscrow } from "../core/kever-decisions.ts";
import { RegStateRecord } from "../core/records.ts";
import { acceptReplyDecision, type ReplyProcessDecision, Revery, unverifiedReplyDecision } from "../core/routing.ts";
import { dgKey } from "../db/core/keys.ts";
import type { BrokerProcessReplyArgs } from "../db/escrowing.ts";
import { encodeDateTimeToDater, timestampMicros } from "../time/mod.ts";
import type { Tevery } from "./eventing.ts";

/** Require the entire qualified prefix, not a valid prefix followed by untrusted suffix bytes. */
export function qualifiedPrefix(value: unknown): boolean {
  try {
    return typeof value === "string" && new Prefixer({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}

/** Validate remote fields only; no storage/infrastructure failure is caught here. */
export function registryRecord(data: unknown): RegStateRecord | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !["vn", "i", "s", "d", "ii", "dt", "et", "bt", "b", "c"].includes(key))
    || typeof row.s !== "string" || !/^[0-9a-f]{1,14}$/i.test(row.s)
    || BigInt(`0x${row.s}`) > BigInt(Number.MAX_SAFE_INTEGER)
    || typeof row.bt !== "string" || !/^[0-9a-f]{1,14}$/i.test(row.bt) || !["vcp", "vrt"].includes(String(row.et))
    || timestampMicros(row.dt) === null || !Array.isArray(row.vn) || row.vn.length !== 2
    || row.vn.some((part) => !Number.isSafeInteger(part) || part < 0)
    || !Array.isArray(row.b) || !Array.isArray(row.c) || row.c.some((item) => typeof item !== "string")
  ) return null;
  try {
    if (![row.i, row.ii, ...row.b].every(qualifiedPrefix)) return null;
    if (new Diger({ qb64: row.d as string }).qb64 !== row.d) return null;
    return RegStateRecord.fromDict(row);
  } catch {
    return null;
  }
}

/** Registry-only TSN admission; every reply owns its attester proof and accepted TEL correspondence.
 * Accepted configuration supplies trust, correcting 714's self-listed backer flaw.
 * The accepted pointer is the outer reply SAID, correcting 714's TEL-digest BADA bug.
 * Credential and registry notices require independent reply authentication.
 */
export class RegistryStateReceiver {
  constructor(private readonly tvy: Tevery, private readonly rvy: Revery) {}

  /** Called by Revery's SAID-checked route or typed Broker retry. */
  processReply({ serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs): ReplyProcessDecision {
    const refuse = (reason: string, escrow?: string) => unverifiedReplyDecision(reason, { escrow });
    const record = registryRecord(serder.ked?.a);
    if (
      !record || !qualifiedPrefix(aid) || timestampMicros(serder.ked?.dt) === null || route !== `/tsn/registry/${aid}`
      || serder.said !== diger.qb64 || !serder.verify()
    ) {
      return refuse("Invalid registry transaction-state notice.");
    }
    const regk = record.i!, issuer = record.ii!, sn = Number.parseInt(record.s!, 16);
    const previous = this.tvy.reger.txnsb.current([regk, aid]);
    const disposeIncoming = () => {
      if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(diger);
    };
    const reject = (reason: string) => {
      disposeIncoming();
      return refuse(reason);
    };
    const stored = this.tvy.reger.states.get(regk);
    if (stored && !registryRecord(stored.asDict())) throw new Error("Corrupt stored registry state.");
    if (stored && (stored.ii !== issuer || BigInt(`0x${stored.s!}`) > BigInt(sn))) {
      return reject("Mismatched issuer or stale registry state.");
    }
    const kever = this.tvy.db.getKever(issuer, { refresh: true });
    this.rvy.cues.checkSpace();
    const escrow = (typ: string, query: boolean) => {
      const added = this.tvy.reger.txnsb.escrowStateNotice({
        typ,
        pre: regk,
        aid,
        serder,
        diger,
        dater: new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) }),
        cigars,
        tsgs,
      });
      // Broker now owns the copied pending proof; retain only prior accepted BADA evidence in Baser.
      disposeIncoming();
      if (added && query) {
        this.rvy.cues.push({
          kin: "query",
          pre: issuer,
          src: aid,
          route: typ === "registry-mae" ? "logs" : "tels",
          query: typ === "registry-mae" ? { i: issuer } : { ri: regk, i: "" },
        });
      }
      return refuse("Registry state dependency unavailable.", typ);
    };
    if (!kever) return escrow("registry-mae", true);
    const watchers = new Set<string>();
    for (const [, habitat] of this.tvy.db.getHabItemIter()) {
      for (const watcher of habitat.watchers ?? []) watchers.add(watcher);
    }
    const trusted = aid === issuer || watchers.has(aid)
      || (!!stored && (stored.c?.includes(TraitDex.NoBackers) ? kever.wits : stored.b ?? []).includes(aid));
    if (!trusted && stored) return reject("Untrusted registry state attester.");
    if (previous && (!this.tvy.db.sdts.get([previous.qb64]) || !this.tvy.db.rpys.get([previous.qb64]))) {
      throw new Error("Corrupt prior registry reply evidence.");
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
      return proof.context?.pending ? escrow("registry-mae", false) : reject("Unverified registry state attester.");
    }
    const accepted = this.tvy.reger.tels.getOn(regk, sn);
    if (!accepted) return escrow("registry-ooo", true);
    const raw = this.tvy.reger.tvts.get(dgKey(regk, accepted.qb64));
    if (!raw || !stored || stored.d !== accepted.qb64) throw new Error("Corrupt accepted registry TEL state.");
    const event = new SerderKERI({ raw });
    if (!event.verify() || event.said !== accepted.qb64 || event.pre !== regk || event.sn !== sn) {
      throw new Error("Corrupt accepted registry TEL body.");
    }
    if (!trusted || accepted.qb64 !== record.d) return reject("Registry state does not match accepted TEL.");
    // Receiver-generated record time is descriptive; configuration and state fields must agree.
    const { dt: _incomingTime, ...incoming } = record.asDict();
    const { dt: _storedTime, ...current } = stored.asDict();
    const fields = ["vn", "i", "s", "d", "ii", "et", "bt", "b", "c"];
    if (fields.some((key) => JSON.stringify(incoming[key]) !== JSON.stringify(current[key]))) {
      return reject("Registry state metadata mismatch.");
    }
    const dater = new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) });
    this.tvy.reger.txnsb.updateReply(aid, serder, diger, dater);
    if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(previous);
    this.rvy.cues.push({ kin: "txnStateSaved", record });
    return acceptReplyDecision();
  }

  /** Recheck trust, BADA and current dependencies on every finite retry pass. */
  processEscrows(): void {
    for (const typ of ["registry-mae", "registry-ooo"]) {
      this.tvy.reger.txnsb.retryStateNotices(typ, (args) => {
        const decision = this.processReply(args);
        if (decision.kind === "accept") return acceptEscrow();
        const next = decision.context?.escrow;
        if (next === typ) return keepEscrow("recoverableError");
        return dropEscrow("processingError");
      });
    }
  }
}
