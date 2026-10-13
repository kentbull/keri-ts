/** Internal local TEL acceptance; registry facades own instance naming and scheduling. */
import { Diger, NumberPrimitive, type SerderACDC } from "cesr-ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import {
  type RegistryEvent,
  type RegistryEventValidation,
  validateRip,
  verifyRegistryAnchor,
} from "./regeventing.ts";
import type { RegistryStore } from "./registering.ts";

/** Expected event outcomes; persistence, corruption and programming failures throw. */
export type RegistryEventDecision =
  | { kind: "accept" | "duplicate"; event: RegistryEvent }
  | { kind: "escrow"; reason: "anchor"; event: RegistryEvent }
  | Extract<RegistryEventValidation, { kind: "reject" }>;

/**
 * Borrow the issuer's accepted KEL and registry store; no keys or handles are acquired.
 * The complete inception path is internal until the registry facade is available.
 * Publication is atomic; binding this instance happens only after successful commit.
 */
export class RegistryEventer {
  constructor(
    readonly db: Baser,
    readonly issuer: string,
    readonly store: RegistryStore,
    public regk: string | null = null,
  ) {}

  /** Validate, anchor and accept one inception, or retain its body in anchor escrow. */
  processInception(serder: SerderACDC): RegistryEventDecision {
    const result = validateRip(serder, this.issuer);
    if (result.kind === "reject") return result;
    const event = result.event;
    if (this.regk !== null && this.regk !== event.regid) return { kind: "reject", reason: "registry" };
    const previous = this.acceptedInception(event);
    if (previous) {
      if (previous.kind === "duplicate") this.regk = event.regid;
      return previous;
    }
    const env = this.store.baser.env;
    if (!env) throw new DatabaseNotOpenError("Registry acceptance requires an open backing store.");
    // Bind named tables before the rollback-capable event transaction owns their rows.
    this.store.baser.initializeStorage();
    const decision = env.transactionSync((): RegistryEventDecision => {
      const previous = this.acceptedInception(event);
      if (previous) return previous;
      if (this.store.head(event.regid)) throw new Error("Registry head exists without its accepted inception.");
      this.store.putEvent(serder);
      this.discoverAnchor(event);
      if (!this.store.anchor(event.said)) {
        this.store.escrowMissingAnchor(event.regid, 0, event.said);
        return { kind: "escrow", reason: "anchor", event };
      }
      this.store.accept(event.regid, 0, serder);
      this.store.baser.maes!.rem(event.regid, 0);
      this.store.baser.ooes!.rem(event.regid, 0);
      return { kind: "accept", event };
    });
    if (decision.kind !== "reject") this.regk = event.regid;
    return decision;
  }

  /** Replay is read-only; first acceptance repeats this check under its write transaction. */
  private acceptedInception(event: RegistryEvent): RegistryEventDecision | null {
    const accepted = this.store.seqSaider(event.regid, 0);
    if (!accepted) return null;
    const existing = this.store.event(accepted.qb64);
    if (!existing || existing.said !== accepted.qb64) throw new Error("Corrupt accepted registry inception.");
    if (accepted.qb64 !== event.said) return { kind: "reject", reason: "duplicity" };
    return { kind: "duplicate", event };
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
