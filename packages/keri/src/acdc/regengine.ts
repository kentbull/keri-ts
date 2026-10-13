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
      const head = this.acceptedHead(event.regid);
      if (head && head.sn >= event.sn) throw new Error("Registry update would downgrade accepted head.");
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
    if (!body) throw new Error("Corrupt accepted registry event.");
    const result = body.ilk === Ilks.rip
      ? validateRip(body, this.issuer)
      : validateUpdate(body, regid);
    if (
      result?.kind !== "valid" || result.event.said !== marker.qb64
      || result.event.sn !== BigInt(sn) || result.event.regid !== regid
    ) {
      throw new Error("Corrupt accepted registry event.");
    }
    return result.event.serder;
  }

  /** An accepted head must identify this registry's body and its matching accepted ordinal. */
  private acceptedHead(regid: string): RegistryEvent | null {
    const marker = this.store.head(regid);
    if (!marker) return null;
    const body = this.store.event(marker.qb64);
    if (!body) throw new Error("Corrupt registry head.");
    const result = body.ilk === Ilks.rip
      ? validateRip(body, this.issuer)
      : validateUpdate(body, regid);
    if (
      result?.kind !== "valid" || result.event.said !== marker.qb64 || result.event.regid !== regid
      || result.event.sn > BigInt(Number.MAX_SAFE_INTEGER)
    ) throw new Error("Corrupt registry head.");
    if (this.acceptedAt(regid, Number(result.event.sn))?.said !== marker.qb64) {
      throw new Error("Corrupt registry head ordinal.");
    }
    return result.event;
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
