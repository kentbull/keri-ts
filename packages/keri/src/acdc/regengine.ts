/** Internal local TEL acceptance; registry facades own instance naming and scheduling. */
import { Diger, Ilks, NumberPrimitive, type SerderACDC } from "cesr-ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import {
  type RegistryEvent,
  type RegistryEventValidation,
  validateRip,
  validateUpdate,
  verifyRegistryAnchor,
} from "./regeventing.ts";
import type { RegistryStore } from "./registering.ts";

/** Expected event outcomes; persistence, corruption and programming failures throw. */
export type RegistryEventDecision =
  | { kind: "accept" | "duplicate"; event: RegistryEvent }
  | { kind: "escrow"; reason: "anchor" | "order"; event: RegistryEvent }
  | { kind: "reject"; reason: "ordinalRange" }
  | Extract<RegistryEventValidation, { kind: "reject" }>;

/**
 * Borrow the issuer's accepted KEL and registry store; no keys or handles are acquired.
 * Event processing is internal until the registry facade is available.
 * Publication is atomic; binding this instance happens only after successful commit.
 */
export class RegistryEventer {
  constructor(
    readonly db: Baser,
    readonly issuer: string,
    readonly store: RegistryStore,
    public regk: string | null = null,
  ) {}

  /** Retry anchor escrow by ordinal, arbitrating siblings before entering normal acceptance. */
  processMissingAnchors(): void {
    if (this.regk === null) return;
    const slots = new Map<number, string[]>();
    // Finish the read cursor before writes. Shared scan credit belongs to the resource-policy phase.
    for (const [, sn, [said]] of this.store.baser.maes?.getTopItemIter(this.regk) ?? []) {
      if (!Number.isSafeInteger(sn) || sn < 0) throw new RangeError("Unsafe registry escrow ordinal.");
      const candidates = slots.get(sn) ?? [];
      candidates.push(said);
      slots.set(sn, candidates);
    }
    for (const [sn, saids] of [...slots].sort(([a], [b]) => a - b)) {
      const candidates: RegistryEvent[] = [];
      for (const said of saids) {
        const event = this.replayCandidate(said, sn);
        if (!event) continue;
        this.discoverAnchor(event);
        candidates.push(event);
      }
      candidates.sort((a, b) => this.compareAnchors(a.said, b.said));
      for (const event of candidates) {
        const result = this.processEvent(event.serder);
        if (result.kind === "reject" || result.kind === "duplicate") {
          this.store.clearEscrows(this.regk, sn, event.said);
        }
      }
    }
  }

  /** Prune unrecoverable candidates; corrupt records and storage failures still propagate. */
  private replayCandidate(said: string, sn: number): RegistryEvent | null {
    const serder = this.store.event(said);
    if (!serder) {
      this.store.clearEscrows(this.regk!, sn, said);
      return null;
    }
    if (serder.said !== said) throw new Error("Corrupt escrowed registry event.");
    const result = serder.ilk === Ilks.rip
      ? validateRip(serder, this.issuer)
      : validateUpdate(serder, this.regk!);
    if (result.kind === "valid") {
      const event = result.event;
      if (event.regid === this.regk && event.sn === BigInt(sn)) {
        const existing = this.acceptedEvent(event);
        const prior = sn > 0 ? this.acceptedAt(event.regid, sn - 1) : null;
        if (!existing && (!prior || prior.said === event.prior)) return event;
      }
    }
    this.store.clearEscrows(this.regk!, sn, said);
    return null;
  }

  /** Earliest verified anchor wins; digest then event SAID break ties using code-point order. */
  private compareAnchors(left: string, right: string): number {
    const a = this.store.anchor(left), b = this.store.anchor(right);
    if (a && !b) return -1;
    if (!a && b) return 1;
    if (a && b) {
      if (a[0].num !== b[0].num) return a[0].num < b[0].num ? -1 : 1;
      if (a[1].qb64 !== b[1].qb64) return a[1].qb64 < b[1].qb64 ? -1 : 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /** Process one parsed event; automatic escrow progression is owned by the retry pass. */
  processEvent(serder: SerderACDC): RegistryEventDecision {
    if (this.regk === null || serder.ilk === Ilks.rip) return this.processInception(serder);
    const result = validateUpdate(serder, this.regk);
    if (result.kind === "reject") return result;
    const event = result.event;
    // Preserve protocol precision until the existing ordinal storage seam can represent it.
    if (event.sn > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "reject", reason: "ordinalRange" };
    const prior = this.acceptedAt(event.regid, Number(event.sn) - 1);
    if (prior && prior.said !== event.prior) return { kind: "reject", reason: "prior" };
    const previous = this.acceptedEvent(event);
    if (previous) return previous;
    const env = this.store.baser.env;
    if (!env) throw new DatabaseNotOpenError("Registry acceptance requires an open backing store.");
    this.store.baser.initializeStorage();
    return env.transactionSync((): RegistryEventDecision => {
      const prior = this.acceptedAt(event.regid, Number(event.sn) - 1);
      if (prior && prior.said !== event.prior) return { kind: "reject", reason: "prior" };
      const previous = this.acceptedEvent(event);
      if (previous) return previous;
      this.store.putEvent(serder);
      this.discoverAnchor(event);
      if (!this.store.anchor(event.said)) {
        this.store.escrowMissingAnchor(event.regid, Number(event.sn), event.said);
        return { kind: "escrow", reason: "anchor", event };
      }
      this.store.baser.maes!.rem(event.regid, Number(event.sn), [event.said]);
      if (!prior) {
        this.store.escrowOutOfOrder(event.regid, Number(event.sn), event.said);
        return { kind: "escrow", reason: "order", event };
      }
      const head = this.store.head(event.regid);
      if (head) {
        const body = this.store.event(head.qb64);
        if (!body || body.said !== head.qb64) throw new Error("Corrupt registry head.");
        if (BigInt(`0x${body.sad!.n}`) >= event.sn) throw new Error("Registry update would downgrade accepted head.");
      }
      this.commit(event);
      return { kind: "accept", event };
    });
  }

  /** Validate, anchor and accept one inception, or retain its body in anchor escrow. */
  private processInception(serder: SerderACDC): RegistryEventDecision {
    const result = validateRip(serder, this.issuer);
    if (result.kind === "reject") return result;
    const event = result.event;
    if (this.regk !== null && this.regk !== event.regid) return { kind: "reject", reason: "registry" };
    const previous = this.acceptedEvent(event);
    if (previous) {
      if (previous.kind === "duplicate") this.regk = event.regid;
      return previous;
    }
    const env = this.store.baser.env;
    if (!env) throw new DatabaseNotOpenError("Registry acceptance requires an open backing store.");
    // Bind named tables before the rollback-capable event transaction owns their rows.
    this.store.baser.initializeStorage();
    const decision = env.transactionSync((): RegistryEventDecision => {
      const previous = this.acceptedEvent(event);
      if (previous) return previous;
      if (this.store.head(event.regid)) throw new Error("Registry head exists without its accepted inception.");
      this.store.putEvent(serder);
      this.discoverAnchor(event);
      if (!this.store.anchor(event.said)) {
        this.store.escrowMissingAnchor(event.regid, 0, event.said);
        return { kind: "escrow", reason: "anchor", event };
      }
      this.commit(event);
      return { kind: "accept", event };
    });
    if (decision.kind !== "reject") this.regk = event.regid;
    return decision;
  }

  /** Replay is read-only; first acceptance repeats this check under its write transaction. */
  private acceptedEvent(event: RegistryEvent): RegistryEventDecision | null {
    const existing = this.acceptedAt(event.regid, Number(event.sn));
    if (!existing) return null;
    if (existing.said !== event.said) return { kind: "reject", reason: "duplicity" };
    return { kind: "duplicate", event };
  }

  /** Accepted markers require a matching body at the exact ordinal, unlike mere staged bodies. */
  private acceptedAt(regid: string, sn: number): SerderACDC | null {
    const marker = this.store.seqSaider(regid, sn);
    if (!marker) return null;
    const body = this.store.event(marker.qb64);
    if (!body || body.said !== marker.qb64 || BigInt(`0x${body.sad!.n}`) !== BigInt(sn)) {
      throw new Error("Corrupt accepted registry event.");
    }
    return body;
  }

  /** Publish one verified winner and remove all siblings from its decided slot atomically. */
  private commit(event: RegistryEvent): void {
    this.store.accept(event.regid, Number(event.sn), event.serder);
    this.store.baser.maes!.rem(event.regid, Number(event.sn));
    this.store.baser.ooes!.rem(event.regid, Number(event.sn));
  }

  /** Keep an already verified anchor or discover the earliest fully witnessed seal. */
  private discoverAnchor(event: RegistryEvent): void {
    if (this.store.anchor(event.said)) return;
    const anchor = this.db.fetchLastSealingEventByEventSeal(this.issuer, {
      i: event.regid,
      s: event.serder.sad!.n,
      d: event.said,
    });
    if (!anchor) return;
    const number = NumberPrimitive.fromNum(BigInt(anchor.sn!));
    const diger = new Diger({ qb64: anchor.said! });
    if (verifyRegistryAnchor(event, { db: this.db, issuer: this.issuer, number, diger })) {
      this.store.putAnchor(event.said, number, diger);
    }
  }
}
