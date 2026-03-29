import { Prefixer } from "../../../cesr/mod.ts";
import { Baser } from "../db/basing.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import type { KeriDispatchEnvelope } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import { Kever } from "./kever.ts";

/**
 * KEL event envelope consumed by the current `Kevery`.
 *
 * KERIpy correspondence:
 * - this is the KEL-focused subset of the parser `exts`/dispatch envelope used
 *   by `Kevery.processEvent()`
 *
 * Design rule:
 * - keep this shaped like the richer dispatch envelope so later receipt,
 *   delegation, and witness work does not need another event-envelope rewrite
 */
export type KeverEventEnvelope = Pick<
  KeriDispatchEnvelope,
  "serder" | "sigers" | "wigers" | "frcs" | "sscs" | "ssts" | "local"
>;

/**
 * Minimal but real KEL event processor backed by live `Kever` instances.
 *
 * Current scope:
 * - first-seen `icp` / `dip`
 * - update scaffolding for `rot` / `drt` / `ixn`
 * - post-acceptance cue emission and live-`Kever` cache ownership via `Baser`
 *
 * Deferred breadth:
 * - full duplication, out-of-order, witness receipt, delegation, and recovery
 *   parity remains later escrow work
 */
export class Kevery {
  readonly db: Baser;
  readonly cues: Deck<AgentCue>;
  readonly local: boolean;

  constructor(
    db: Baser,
    { cues, local = false }: { cues?: Deck<AgentCue>; local?: boolean } = {},
  ) {
    this.db = db;
    this.cues = cues ?? new Deck();
    this.local = local;
  }

  /** Live accepted-state cache delegated from the backing `Baser`. */
  get kevers(): Map<string, Kever> {
    return this.db.kevers;
  }

  /** Locally managed AIDs delegated from the backing `Baser`. */
  get prefixes(): Set<string> {
    return this.db.prefixes;
  }

  /**
   * Process one normalized KEL event envelope.
   *
   * Flow:
   * - validate prefix material
   * - first-seen inception/delception creates a new `Kever`
   * - later accepted events delegate to the existing `Kever.update()`
   * - post-acceptance cues remain `Kevery` owned
   */
  processEvent(envelope: KeverEventEnvelope): void {
    const { serder } = envelope;
    const pre = serder.pre;
    const ilk = serder.ilk;
    const said = serder.said;
    const sn = serder.sn;

    if (!pre || !ilk || !said || sn === null) {
      throw new ValidationError(
        "KEL event must include pre, ilk, said, and sn.",
      );
    }

    try {
      new Prefixer({ qb64: pre });
    } catch (error) {
      throw new ValidationError(`Invalid pre=${pre} for event ${said}.`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const local = envelope.local ?? this.local;
    if (!this.kevers.has(pre)) {
      if (ilk !== "icp" && ilk !== "dip") {
        throw new ValidationError(
          `Out-of-order event ilk=${ilk} for unknown prefix ${pre} is not yet implemented.`,
        );
      }

      const kever = new Kever({
        db: this.db,
        cues: this.cues,
        serder,
        sigers: envelope.sigers,
        wigers: envelope.wigers,
        frcs: envelope.frcs,
        sscs: envelope.sscs,
        ssts: envelope.ssts,
        local,
      });
      this.kevers.set(pre, kever);
      this.emitAcceptanceCues(kever, serder, local);
      return;
    }

    if (ilk === "icp" || ilk === "dip") {
      const kever = this.kevers.get(pre)!;
      if (sn !== 0) {
        throw new ValidationError(
          `Duplicate inception event ${said} for ${pre} must keep sn=0.`,
        );
      }
      if (kever.said === said) {
        kever.logEvent({
          serder,
          sigers: envelope.sigers,
          wigers: envelope.wigers,
          local,
        });
        return;
      }
      throw new ValidationError(
        `Likely duplicitous inception for ${pre}; existing SAID=${kever.said}, got ${said}.`,
      );
    }

    const kever = this.kevers.get(pre)!;
    kever.update({
      serder,
      sigers: envelope.sigers,
      wigers: envelope.wigers,
      frcs: envelope.frcs,
      sscs: envelope.sscs,
      ssts: envelope.ssts,
      local,
    });
    this.emitAcceptanceCues(kever, serder, local);
  }

  /** Placeholder for KERIpy out-of-order event escrow processing. */
  processEscrowOutOfOrders(): void {}
  /** Placeholder for KERIpy unverified witness-receipt escrow processing. */
  processEscrowUnverWitness(): void {}
  /** Placeholder for KERIpy unverified non-transferable receipt escrow processing. */
  processEscrowUnverNonTrans(): void {}
  /** Placeholder for KERIpy unverified transferable receipt escrow processing. */
  processEscrowUnverTrans(): void {}
  /** Placeholder for KERIpy partially verified delegated-event escrow processing. */
  processEscrowPartialDels(): void {}
  /** Placeholder for KERIpy partially verified witness-signature escrow processing. */
  processEscrowPartialWigs(): void {}
  /** Placeholder for KERIpy partially verified controller-signature escrow processing. */
  processEscrowPartialSigs(): void {}
  /** Placeholder for KERIpy duplicitous-event escrow processing. */
  processEscrowDuplicitous(): void {}
  /** Placeholder for KERIpy delegable-event escrow reprocessing. */
  processEscrowDelegables(): void {}
  /** Placeholder for KERIpy query-not-found escrow processing. */
  processQueryNotFound(): void {}

  /**
   * Run one full bootstrap KEL escrow sweep.
   *
   * The call ordering is already aligned with the planned continuous-loop
   * runtime even though most escrow handlers remain stubbed today.
   */
  processEscrows(): void {
    this.processEscrowOutOfOrders();
    this.processEscrowUnverWitness();
    this.processEscrowUnverNonTrans();
    this.processEscrowUnverTrans();
    this.processEscrowPartialDels();
    this.processEscrowPartialWigs();
    this.processEscrowPartialSigs();
    this.processEscrowDuplicitous();
    this.processEscrowDelegables();
    this.processQueryNotFound();
  }

  /**
   * Emit post-acceptance cues for one finalized event.
   *
   * Ownership rule:
   * - `Kever` owns validation and state mutation
   * - `Kevery` owns the higher-level cue side effects that follow acceptance
   */
  private emitAcceptanceCues(
    kever: Kever,
    serder: KeverEventEnvelope["serder"],
    local: boolean,
  ): void {
    if (!this.prefixes.has(kever.pre)) {
      this.cues.push({ kin: "receipt", serder });
    } else if (!local) {
      this.cues.push({ kin: "notice", serder });
    }

    if (local && kever.locallyWitnessed()) {
      this.cues.push({ kin: "witness", serder });
    }

    this.cues.push({ kin: "keyStateSaved", ksn: kever.state() });
  }
}
