import { Dater, Diger, Prefixer, SerderKERI, TraitDex } from "cesr-ts";
import type { PreparedCueBatch } from "../core/cue-admission.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
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
export function qualifiedPrefix(value: unknown): value is string {
  try {
    return typeof value === "string" && new Prefixer({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}

/** Validate unknown notice fields and return the existing record with every field required. */
export function registryRecord(data: unknown): Required<RegStateRecord> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (
    Object.keys(data).some((key) => !["vn", "i", "s", "d", "ii", "dt", "et", "bt", "b", "c"].includes(key))
    || !("i" in data) || !qualifiedPrefix(data.i) || !("ii" in data) || !qualifiedPrefix(data.ii)
    || !("s" in data) || typeof data.s !== "string" || !/^[0-9a-f]{1,14}$/i.test(data.s)
    || BigInt(`0x${data.s}`) > BigInt(Number.MAX_SAFE_INTEGER)
    || !("bt" in data) || typeof data.bt !== "string" || !/^[0-9a-f]{1,14}$/i.test(data.bt)
    || !("et" in data) || (data.et !== "vcp" && data.et !== "vrt")
    || !("dt" in data) || typeof data.dt !== "string" || timestampMicros(data.dt) === null
    || !("vn" in data) || !Array.isArray(data.vn) || data.vn.length !== 2
    || !("b" in data) || !Array.isArray(data.b) || !("c" in data) || !Array.isArray(data.c)
    || !("d" in data) || typeof data.d !== "string"
  ) return null;
  // Array.isArray erases item types; narrow untrusted elements before constructing owned projections.
  const version: unknown[] = data.vn, backers: unknown[] = data.b, config: unknown[] = data.c;
  const [major, minor] = version;
  if (
    typeof major !== "number" || !Number.isSafeInteger(major) || major < 0
    || typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0
    || !backers.every(qualifiedPrefix) || !config.every((item) => typeof item === "string")
  ) return null;
  try {
    if (new Diger({ qb64: data.d }).qb64 !== data.d) return null;
  } catch {
    return null;
  }
  // Keep required-field types while constructing the existing record; these arrays are fresh owned copies.
  return Object.assign(new RegStateRecord(), {
    vn: [major, minor],
    i: data.i,
    s: data.s,
    d: data.d,
    ii: data.ii,
    dt: data.dt,
    et: data.et,
    bt: data.bt,
    b: [...backers],
    c: [...config],
  });
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
  constructor(private readonly tvy: Tevery, private readonly rvy: Revery) {}

  /** Called by Revery's SAID-checked route or typed Broker retry. */
  processReply({ serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs): RegistryReplyDecision {
    const record = registryRecord(serder.ked?.a);
    const stamp = serder.ked?.dt;
    if (
      !record || !qualifiedPrefix(aid) || typeof stamp !== "string" || timestampMicros(stamp) === null
      || route !== `/tsn/registry/${aid}`
      || serder.said !== diger.qb64 || !serder.verify()
    ) {
      return unverifiedReplyDecision("Invalid registry transaction-state notice.");
    }
    const regk = record.i, issuer = record.ii, sn = Number.parseInt(record.s, 16);
    const previous = this.tvy.reger.txnsb.current([regk, aid]);
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
    if (stored && (stored.ii !== issuer || BigInt(`0x${stored.s}`) > BigInt(sn))) {
      return reject("Mismatched issuer or stale registry state.");
    }
    const kever = this.tvy.db.getKever(issuer, { refresh: true });
    if (this.rvy.cues instanceof Deck) this.rvy.cues.checkSpace(1);
    let queries: PreparedCueBatch | undefined;
    let queryCues: readonly AgentCue[] = [];
    const escrow = (typ: RegistryEscrowFamily, query: boolean, proof?: ReplyPlan): RegistryReplyDecision => {
      const isNew = !this.tvy.reger.txnsb.hasStateNotice(typ, regk, aid, diger);
      const cues: AgentCue[] = !isNew || !query
        ? []
        : typ === "registry-mae"
        ? [{ kin: "query", pre: issuer, src: aid, route: "logs", q: {} }]
        : [{ kin: "query", pre: issuer, src: aid, route: "tels", q: { ri: regk, i: "" } }];
      this.rvy.cues.checkSpace(cues.length);
      const child = cues.length && !(this.rvy.cues instanceof Deck) ? this.rvy.cues.prepare(cues) : undefined;
      try {
        if (proof) this.rvy.writeReply(proof);
        const added = this.tvy.reger.txnsb.escrowStateNotice({
          typ,
          pre: regk,
          aid,
          serder,
          diger,
          dater: new Dater({ qb64: encodeDateTimeToDater(stamp) }),
          cigars,
          tsgs,
        });
        if (added !== isNew) throw new Error("Registry escrow membership changed before publication");
        // Broker now owns copied pending proof; retain prior accepted BADA evidence in Baser.
        disposeIncoming();
        if (queries) queries.publish();
        else if (queryCues.length) this.rvy.cues.extend(queryCues);
        if (child) child.publish();
        else if (cues.length) this.rvy.cues.extend(cues);
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
      || (!!stored && (stored.c.includes(TraitDex.NoBackers) ? kever.wits : stored.b).includes(aid));
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
    queryCues = proof.cues;
    queries = queryCues.length && !(this.rvy.cues instanceof Deck) ? this.rvy.cues.prepare(queryCues) : undefined;
    try {
      if (proof.kind !== "accept") {
        if (proof.reason === "proofPending") return escrow("registry-mae", false, proof);
        this.rvy.writeReply(proof);
        if (queries) queries.publish();
        else if (queryCues.length) this.rvy.cues.extend(queryCues);
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
      const fields = ["vn", "i", "s", "d", "ii", "et", "bt", "b", "c"] as const;
      if (fields.some((key) => JSON.stringify(record[key]) !== JSON.stringify(stored[key]))) {
        return reject("Registry state metadata mismatch.");
      }
      const dater = new Dater({ qb64: encodeDateTimeToDater(stamp) });
      const cues: AgentCue[] = [{ kin: "txnStateSaved", record }];
      this.rvy.cues.checkSpace(cues.length);
      const child = this.rvy.cues instanceof Deck ? undefined : this.rvy.cues.prepare(cues);
      try {
        this.rvy.writeReply(proof);
        this.tvy.reger.txnsb.updateReply(aid, serder, diger, dater);
        if (previous?.qb64 !== diger.qb64) this.rvy.removeReply(previous);
        if (queries) queries.publish();
        else if (queryCues.length) this.rvy.cues.extend(queryCues);
        if (child) child.publish();
        else if (cues.length) this.rvy.cues.extend(cues);
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
