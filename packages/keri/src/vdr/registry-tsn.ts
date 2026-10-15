import { Dater, Diger, Prefixer, SerderKERI, TraitDex } from "cesr-ts";
import type { PreparedCueBatch } from "../core/cue-admission.ts";
import { type CuePublisher, cuePublisher } from "../core/cue-publishing.ts";
import type { AgentCue } from "../core/cues.ts";
import { acceptEscrow, dropEscrow, keepEscrow } from "../core/kever-decisions.ts";
import { RegStateRecord } from "../core/records.ts";
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

/** Dependency buckets owned by the registry notice receiver. */
type RegistryEscrowFamily = "registry-mae" | "registry-ooo";

/** Registry outcomes retain the receiver's exact dependency family. */
export type RegistryReplyDecision = ReplyProcessDecision<RegistryEscrowFamily>;

/** Registry-only TSN admission; every reply owns its attester proof and accepted TEL correspondence.
 * Accepted configuration supplies trust, correcting 714's self-listed backer flaw.
 * The accepted pointer is the outer reply SAID, correcting 714's TEL-digest BADA bug.
 * Credential and registry notices require independent reply authentication.
 */
export class RegistryStateReceiver {
  private readonly publisher: CuePublisher;
  constructor(private readonly tvy: Tevery, private readonly rvy: Revery) {
    this.publisher = cuePublisher(rvy.cues);
  }

  /** Called by Revery's SAID-checked route or typed Broker retry. */
  processReply({ serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs): RegistryReplyDecision {
    const record = registryRecord(serder.ked?.a);
    if (
      !record || !qualifiedPrefix(aid) || timestampMicros(serder.ked?.dt) === null || route !== `/tsn/registry/${aid}`
      || serder.said !== diger.qb64 || !serder.verify()
    ) {
      return unverifiedReplyDecision("Invalid registry transaction-state notice.");
    }
    const regk = record.i!, issuer = record.ii!, sn = Number.parseInt(record.s!, 16);
    const previous = this.tvy.reger.txnsb.current([regk, aid]);
    const disposeIncoming = () => {
      if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(diger);
    };
    const reject = (reason: string) => {
      disposeIncoming();
      return unverifiedReplyDecision(reason);
    };
    const stored = this.tvy.reger.states.get(regk);
    if (stored && !registryRecord(stored.asDict())) throw new Error("Corrupt stored registry state.");
    if (stored && (stored.ii !== issuer || BigInt(`0x${stored.s!}`) > BigInt(sn))) {
      return reject("Mismatched issuer or stale registry state.");
    }
    const kever = this.tvy.db.getKever(issuer, { refresh: true });
    this.publisher.preflight(1);
    let queries: PreparedCueBatch | undefined;
    const escrow = (typ: RegistryEscrowFamily, query: boolean, proof?: ReplyPlan): RegistryReplyDecision => {
      const isNew = !this.tvy.reger.txnsb.hasStateNotice(typ, regk, aid, diger);
      const cues: AgentCue[] = isNew && query
        ? [{
          kin: "query",
          pre: issuer,
          src: aid,
          route: typ === "registry-mae" ? "logs" : "tels",
          query: typ === "registry-mae" ? { i: issuer } : { ri: regk, i: "" },
        }]
        : [];
      this.rvy.cues.checkSpace(cues.length);
      const child = cues.length ? this.publisher.prepare(cues) : undefined;
      try {
        if (proof) this.rvy.writeReply(proof);
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
        if (added !== isNew) throw new Error("Registry escrow membership changed before publication");
        // Broker now owns copied pending proof; retain prior accepted BADA evidence in Baser.
        disposeIncoming();
        queries?.publish();
        child?.publish();
        return {
          kind: "unverified",
          reason: "dependencyPending",
          family: typ,
          message: "Registry state dependency unavailable.",
        };
      } finally {
        child?.release();
      }
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
        if (proof.reason === "proofPending") return escrow("registry-mae", false, proof);
        this.rvy.writeReply(proof);
        queries?.publish();
        return reject("Unverified registry state attester.");
      }
      const accepted = this.tvy.reger.tels.getOn(regk, sn);
      if (!accepted) return escrow("registry-ooo", true, proof);
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
      const cues: AgentCue[] = [{ kin: "txnStateSaved", record }];
      this.rvy.cues.checkSpace(cues.length);
      const child = this.publisher.prepare(cues);
      try {
        this.rvy.writeReply(proof);
        this.tvy.reger.txnsb.updateReply(aid, serder, diger, dater);
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

  /** Recheck trust, BADA and current dependencies on every finite retry pass. */
  processEscrows(): void {
    for (const typ of ["registry-mae", "registry-ooo"]) {
      this.tvy.reger.txnsb.retryStateNotices(typ, (args) => {
        const decision = this.processReply(args);
        if (decision.kind === "accept") return acceptEscrow();
        if (decision.reason === "dependencyPending" && decision.family === typ) return keepEscrow("recoverableError");
        return dropEscrow("processingError");
      });
    }
  }
}
