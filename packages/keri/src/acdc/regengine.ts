/** Internal local TEL acceptance; registry facades own instance naming and scheduling. */
import {
  Diger,
  Ilks,
  makeBlindState,
  makeBoundState,
  type MakeBoundStateOptions,
  NumberPrimitive,
  type Saider,
  SerderACDC,
} from "cesr-ts";
import { DatabaseNotOpenError, ValidationError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import { blindate, type BlindateOptions } from "./messaging.ts";
import {
  type RegistryDisclosure,
  type RegistryEvent,
  type RegistryEventValidation,
  validateRip,
  validateUpdate,
  verifyRegistryAnchor,
} from "./regeventing.ts";
import type { RegistryStore } from "./registering.ts";
import { FailedSchemaValidationError, MissingSchemaError, validateSchema } from "./scheming.ts";

/** Expected event outcomes; persistence, corruption and programming failures throw. */
export type RegistryEventDecision =
  | { kind: "accept" | "duplicate"; event: RegistryEvent }
  | { kind: "escrow"; reason: "anchor" | "order"; event: RegistryEvent }
  | { kind: "reject"; reason: "ordinalRange" }
  | Extract<RegistryEventValidation, { kind: "reject" }>;

/** Disclosure derivation and wire options; the engine alone selects the next ordinal and blinder. */
export type RegistryBlindOptions =
  & Omit<BlindateOptions, "sn">
  & Pick<MakeBoundStateOptions, "raw" | "salt" | "tier" | "bsn" | "bd">
  & { bound?: boolean };
/** Grant serders and bare SAIDs share syntax checks; presentation construction does not authenticate grants. */
export type RegistryPresentationTarget = string | { readonly said: string | null };
/** A disclosure and its staged commitment, neither of which establishes anchored acceptance. */
export type RegistryBlindResult = readonly [RegistryDisclosure, SerderACDC];

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

  /** Read the accepted head only after validating its body and ordinal marker. */
  get head(): Saider | null {
    const event = this.regk ? this.acceptedHead(this.regk) : null;
    return event ? this.store.head(event.regid) : null;
  }
  /** Accepted TEL ordinal, retaining -1n for a staged but unaccepted inception. */
  get sn(): bigint {
    return this.regk ? this.acceptedHead(this.regk)?.sn ?? -1n : -1n;
  }
  /** Return an accepted inception; a corrupt marker/body pair throws. */
  get regser(): SerderACDC | null {
    return this.regk ? this.acceptedAt(this.regk, 0) : null;
  }

  /** Validate credential membership and issuer before deriving its next blinded registry update. */
  blind(acdc: SerderACDC, state: string, options: RegistryBlindOptions = {}): RegistryBlindResult {
    if (!(acdc instanceof SerderACDC) || !acdc.verify()) {
      throw new ValidationError("Registry blinding requires a self-verifying ACDC.");
    }
    if (acdc.regid !== this.regk) throw new ValidationError("Credential belongs to another registry.");
    if (acdc.issuer !== this.issuer) throw new ValidationError("Credential belongs to another issuer.");
    const schema = validateSchema(acdc, this.db);
    if (schema.kind === "missing") throw new MissingSchemaError(schema.said);
    if (schema.kind === "invalid") throw new FailedSchemaValidationError(schema.reason);
    return this.blindTarget(acdc.said!, state, options);
  }

  /** Commit a grant SAID without requiring the grant's issuer to control this presentation registry. */
  present(
    grant: RegistryPresentationTarget,
    state = "presented",
    options: RegistryBlindOptions = {},
  ): RegistryBlindResult {
    const target = typeof grant === "string" ? grant : grant.said;
    try {
      new Diger({ qb64: target ?? "" });
    } catch (cause) {
      throw new ValidationError("Presentation target must be a valid grant SAID.", { cause });
    }
    return this.blindTarget(target!, state, options);
  }

  /** Empty target/state disclose a vacuous step; downstream verification retains the preceding binding. */
  vacate(options: RegistryBlindOptions = {}): RegistryBlindResult {
    return this.blindTarget("", "", options);
  }

  /** Derive and stage a validated target; presentation/vacuous callers own their target checks. */
  protected blindTarget(target: string, state: string, options: RegistryBlindOptions): RegistryBlindResult {
    const tip = this.effectiveFrontier();
    if (!tip) throw new ValidationError("Registry must be anchored before updates.");
    if ("blinder" in options) throw new ValidationError("Caller-supplied blinder overrides are unsupported.");
    const sn = tip.sn + 1n;
    if (sn > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Unsafe registry update ordinal.");
    const { raw, salt, tier, bound, bsn, bd, ...wire } = options;
    const inputs = { raw, salt, tier, sn, acdc: target, state };
    const blinder = bound ? makeBoundState({ ...inputs, bsn, bd }) : makeBlindState(inputs);
    const serder = blindate(tip.regid, tip.said, blinder.d.nonce, { ...wire, sn });
    const decision = this.processEvent(serder);
    if (decision.kind === "reject") throw new ValidationError(`Registry update rejected: ${decision.reason}`);
    return [blinder, serder];
  }

  /** Extend an accepted head through exactly one staged successor at each ordinal, without mutation. */
  private effectiveFrontier(): RegistryEvent | null {
    let tip = this.regk ? this.acceptedHead(this.regk) : null;
    while (tip) {
      const sn = tip.sn + 1n;
      if (sn > BigInt(Number.MAX_SAFE_INTEGER)) return tip;
      const saids = new Set<string>();
      for (const escrow of [this.store.baser.maes, this.store.baser.ooes]) {
        for (const [said] of escrow?.get(tip.regid, Number(sn)) ?? []) saids.add(said);
      }
      let successor: RegistryEvent | null = null;
      for (const said of saids) {
        const body = this.store.event(said);
        if (!body) continue;
        if (body.said !== said) throw new Error("Corrupt staged registry event.");
        const result = validateUpdate(body, tip.regid);
        if (result.kind !== "valid" || result.event.sn !== sn || result.event.prior !== tip.said) continue;
        if (successor) throw new ValidationError("Registry has conflicting staged successors.");
        successor = result.event;
      }
      if (!successor) return tip;
      tip = successor;
    }
    return null;
  }

  /** Retry newly visible anchors, then advance the contiguous accepted chain. */
  processEscrows(): void {
    this.processMissingAnchors();
    this.processQueued();
  }

  /** Authenticate a complete explicit source couple or discover one for a stored event. */
  anchorMsg(said: string, number?: NumberPrimitive, diger?: Diger): RegistryEventDecision {
    const serder = this.store.event(said);
    if (!serder) return { kind: "reject", reason: "event" };
    if (serder.said !== said) throw new Error("Corrupt escrowed registry event.");
    const result = this.regk === null || serder.ilk === Ilks.rip
      ? validateRip(serder, this.issuer)
      : validateUpdate(serder, this.regk);
    if (result.kind === "reject") return result;
    const event = result.event;
    if (this.regk !== null && event.regid !== this.regk) return { kind: "reject", reason: "registry" };
    if (event.sn > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "reject", reason: "ordinalRange" };
    const occupied = this.acceptedEvent(event);
    if (occupied?.kind === "reject") return occupied;
    const prior = event.sn > 0n ? this.acceptedAt(event.regid, Number(event.sn) - 1) : null;
    if (prior && prior.said !== event.prior) return { kind: "reject", reason: "prior" };
    if ((number === undefined) !== (diger === undefined)) return { kind: "reject", reason: "anchor" };
    if (number && diger) {
      if (!verifyRegistryAnchor(event, { db: this.db, issuer: this.issuer, number, diger })) {
        return { kind: "reject", reason: "anchor" };
      }
      this.store.putAnchor(said, number, diger);
    } else {
      this.discoverAnchor(event);
    }
    if (!this.store.anchor(said)) return { kind: "reject", reason: "anchor" };
    return this.processEvent(serder);
  }

  /** Advance only the next ordinal, committing one verified winner per transaction. */
  private processQueued(): void {
    if (this.regk === null) return;
    while (true) {
      const head = this.acceptedHead(this.regk);
      if (!head) return;
      const sn = head.sn + 1n;
      if (sn > BigInt(Number.MAX_SAFE_INTEGER)) return;
      const candidates = this.store.baser.ooes?.get(this.regk, Number(sn)).map(([said]) => said) ?? [];
      candidates.sort((a, b) => this.compareAnchors(a, b));
      let advanced = false;
      for (const said of candidates) {
        const event = this.replayCandidate(said, Number(sn));
        if (!event || !this.store.anchor(said)) continue;
        const decision = this.processOne(event.serder);
        if (decision.kind === "accept") {
          advanced = true;
          break;
        }
      }
      if (!advanced) return;
    }
  }

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

  /** Accept one parsed event, then advance ready successors without recursive replay. */
  processEvent(serder: SerderACDC): RegistryEventDecision {
    const decision = this.processOne(serder);
    if (decision.kind === "accept") this.processQueued();
    return decision;
  }

  /** Decide and persist one event; callers own subsequent chain progression. */
  private processOne(serder: SerderACDC): RegistryEventDecision {
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
