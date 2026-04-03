import { Dater, Ilks, NumberPrimitive, Prefixer, Verfer } from "../../../cesr/mod.ts";
import { Baser } from "../db/basing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import { type DispatchOrdinal, type KeriDispatchEnvelope, SourceSealCouple } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import {
  type EscrowInstruction,
  type EscrowKind,
  type KELEventState,
  type KeverDecision,
  type KeverTransition,
} from "./kever-decisions.ts";
import { Kever, type KeverEventInit } from "./kever.ts";

/** Normalize one dispatch ordinal into the number primitive expected by DB seal tuples. */
function normalizeSealOrdinal(
  seqner: DispatchOrdinal,
): NumberPrimitive {
  return seqner instanceof NumberPrimitive
    ? seqner
    : new NumberPrimitive({ qb64b: seqner.qb64b });
}

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
 * `keri-ts` difference:
 * - the public processing seam returns typed decisions instead of using
 *   exceptions for normal remote-processing control flow
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
   * The returned decision is the normal typed outcome for remote processing.
   * Exceptions are reserved for invariant/corruption cases during application.
   */
  processEvent(envelope: KeverEventEnvelope): KeverDecision {
    const decision = this.decideEvent(envelope);
    this.applyDecision(decision);
    return decision;
  }

  /**
   * Decide how one event should be treated without mutating durable state.
   *
   * Responsibilities:
   * - first-seen versus existing-prefix routing
   * - duplicate versus likely-duplicitous differentiation
   * - out-of-order detection
   * - delegation to `Kever` for state-machine validation
   */
  decideEvent(envelope: KeverEventEnvelope): KeverDecision {
    const { serder } = envelope;
    const pre = serder.pre;
    const ilk = serder.ilk;
    const said = serder.said;
    const sn = serder.sn;

    if (!pre || !ilk || !said || sn === null) {
      return {
        kind: "reject",
        code: !pre ? "invalidPre" : !ilk ? "invalidIlk" : "invalidSn",
        message: "KEL event must include pre, ilk, said, and sn.",
      };
    }

    try {
      new Prefixer({ qb64: pre });
    } catch (error) {
      return {
        kind: "reject",
        code: "invalidPre",
        message: `Invalid pre=${pre} for event ${said}.`,
        context: {
          cause: error instanceof Error ? error.message : String(error),
        },
      };
    }

    const local = envelope.local ?? this.local;
    const init = this.makeKeverEventInit(envelope, local);

    // If prefix does not exist in kevers (was not reloaded from disk) and first event not inception
    // then escrow out of order.
    if (!this.kevers.has(pre)) {
      if (ilk !== Ilks.icp && ilk !== Ilks.dip) {
        return this.makeEscrowDecision(
          "ooo",
          init,
          `Out-of-order event ilk=${ilk} for unknown prefix ${pre}.`,
        );
      }
      return Kever.evaluateInception(init);
    }

    const kever = this.kevers.get(pre)!;

    if (ilk === Ilks.icp || ilk === Ilks.dip) {
      if (sn !== 0) {
        return {
          kind: "reject",
          code: "invalidSn",
          message: `Duplicate inception event ${said} for ${pre} must keep sn=0.`,
        };
      }
      if (kever.said === said) {
        return this.buildDuplicateDecision(kever, init);
      }
      return this.makeEscrowDecision(
        "duplicitous",
        init,
        `Likely duplicitous inception for ${pre}; existing SAID=${kever.said}, got ${said}.`,
      );
    }

    const duplicateSaid = this.db.getKel(pre, sn);
    if (duplicateSaid && duplicateSaid === said) {
      return this.buildDuplicateDecision(kever, init);
    }

    if (sn > kever.sn + 1) {
      return this.makeEscrowDecision(
        "ooo",
        init,
        `Out-of-order event sn=${sn} for ${pre}; expected <= ${kever.sn + 1}.`,
      );
    }

    return kever.evaluateUpdate(init);
  }

  /**
   * Apply one previously decided outcome to the durable DB/runtime state.
   *
   * Ownership rule:
   * - `Kever` decides acceptance/rejection criteria
   * - `Kevery` owns durable mutation, escrow routing, duplicate logging, and
   *   post-acceptance cue emission
   */
  applyDecision(decision: KeverDecision): void {
    switch (decision.kind) {
      case "accept": {
        let kever = this.kevers.get(decision.transition.pre);
        if (!kever || decision.transition.mode === "create") {
          kever = Kever.fromTransition(decision.transition, {
            db: this.db,
            cues: this.cues,
          });
        }
        const logged = kever.logEvent(decision.transition.log);
        const transition = this.applyFirstSeenState(
          decision.transition,
          logged.fn,
          logged.dater.iso8601,
        );
        kever.applyTransition(transition);
        this.db.pinState(transition.pre, transition.state);
        this.kevers.set(transition.pre, kever);
        this.db.udes.rem([transition.pre, transition.said]);
        this.emitDecisionCues(decision.cues);
        this.emitAcceptanceCues(kever, transition.log.serder, transition.log.local);
        break;
      }
      case "duplicate": {
        const kever = this.kevers.get(decision.log?.serder.pre ?? "");
        if (decision.log && kever) {
          kever.logEvent(decision.log);
        }
        this.emitDecisionCues(decision.cues);
        break;
      }
      case "escrow":
        this.persistEscrowInstruction(decision.instruction);
        this.emitDecisionCues(decision.cues);
        break;
      case "reject":
        break;
    }
  }

  /** Reprocess one pass of out-of-order escrowed events. */
  processEscrowOutOfOrders(): void {
    this.processOrdinalEscrow("ooo");
  }

  /** Placeholder for KERIpy unverified witness-receipt escrow processing. */
  processEscrowUnverWitness(): void {}
  /** Placeholder for KERIpy unverified non-transferable receipt escrow processing. */
  processEscrowUnverNonTrans(): void {}
  /** Placeholder for KERIpy unverified transferable receipt escrow processing. */
  processEscrowUnverTrans(): void {}

  /** Reprocess one pass of partially delegated events. */
  processEscrowPartialDels(): void {
    this.processOrdinalEscrow("partialDels");
  }

  /** Reprocess one pass of partially witnessed events. */
  processEscrowPartialWigs(): void {
    this.processOrdinalEscrow("partialWigs");
  }

  /** Reprocess one pass of partially signed events. */
  processEscrowPartialSigs(): void {
    this.processOrdinalEscrow("partialSigs");
  }

  /** Reprocess one pass of likely duplicitous events. */
  processEscrowDuplicitous(): void {
    this.processOrdinalEscrow("duplicitous");
  }

  /** Reprocess one pass of locally delegable pending events. */
  processEscrowDelegables(): void {
    this.processSetEscrow("delegables");
  }

  /** Reprocess query-not-found escrows through the same decision path. */
  processQueryNotFound(): void {
    this.processSetEscrow("queryNotFound");
  }

  /** Reprocess one pass of misfit events. */
  processEscrowMisfits(): void {
    this.processSetEscrow("misfit");
  }

  /**
   * Run one full bootstrap KEL escrow sweep.
   *
   * The call ordering is aligned with the planned continuous-loop runtime.
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
    this.processEscrowMisfits();
    this.processQueryNotFound();
  }

  /**
   * Emit post-acceptance cues for one finalized event.
   *
   * Ownership rule:
   * - `Kever` owns validation and accepted-state application
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

  /** Forward decision-carried cues into the shared runtime cue deck. */
  private emitDecisionCues(cues?: readonly AgentCue[]): void {
    for (const cue of cues ?? []) {
      this.cues.push(cue);
    }
  }

  /** Build a Kever-init envelope shared across decide/apply helpers. */
  private makeKeverEventInit(
    envelope: KeverEventEnvelope,
    local: boolean,
  ): KeverEventInit {
    return {
      db: this.db,
      cues: this.cues,
      serder: envelope.serder,
      sigers: [...envelope.sigers],
      wigers: [...envelope.wigers],
      frcs: [...envelope.frcs],
      sscs: [...envelope.sscs],
      ssts: [...envelope.ssts],
      local,
    };
  }

  /** Build one event-level escrow decision from normalized event init material. */
  private makeEscrowDecision(
    escrow: EscrowKind,
    init: KeverEventInit,
    message: string,
  ): KeverDecision {
    return {
      kind: "escrow",
      reason: escrow,
      message,
      instruction: {
        escrow,
        pre: init.serder.pre ?? "",
        said: init.serder.said ?? "",
        sn: init.serder.sn ?? -1,
        log: {
          serder: init.serder,
          sigers: [...init.sigers],
          wigers: [...(init.wigers ?? [])],
          first: false,
          frc: init.frcs?.[0] ?? null,
          sourceSeal: init.ssts?.[0] ?? init.sscs?.[0] ?? null,
          local: init.local ?? false,
        },
      },
    };
  }

  /** Build one duplicate decision, logging only when new attachments verify. */
  private buildDuplicateDecision(
    kever: Kever,
    init: KeverEventInit,
  ): KeverDecision {
    const serder = init.serder;
    const storedWitnesses = this.db.wits.get([kever.pre, serder.said ?? ""]).map((
      wit,
    ) => wit.qb64);
    const existingSigs = new Set(
      this.db.sigs.get([kever.pre, serder.said ?? ""]).map((siger) => siger.qb64),
    );
    const existingWigs = new Set(
      this.db.wigs.get([kever.pre, serder.said ?? ""]).map((wiger) => wiger.qb64),
    );
    const verfers = serder.ilk === Ilks.icp || serder.ilk === Ilks.dip
      ? serder.verfers
      : (serder.estive ? serder.verfers : kever.verfers);
    const verifiedSigers = Kever.verifyIndexedSignatures(
      serder.raw,
      init.sigers,
      verfers,
    ).sigers.filter((siger) => !existingSigs.has(siger.qb64));
    const verifiedWigs = Kever.verifyIndexedSignatures(
      serder.raw,
      init.wigers ?? [],
      storedWitnesses.map((wit) => new Verfer({ qb64: wit })),
    ).sigers.filter((wiger) => !existingWigs.has(wiger.qb64));

    if (verifiedSigers.length > 0 || verifiedWigs.length > 0) {
      return {
        kind: "duplicate",
        duplicate: "lateAttachments",
        log: {
          serder,
          sigers: verifiedSigers,
          wigers: verifiedWigs,
          wits: storedWitnesses,
          local: init.local ?? false,
        },
      };
    }

    return {
      kind: "duplicate",
      duplicate: "sameSaid",
    };
  }

  /** Apply accepted first-seen/datetime state after event logging fixes those values. */
  private applyFirstSeenState(
    transition: KeverTransition,
    fn: number | null,
    dt: string,
  ): KeverTransition {
    const state = { ...transition.state, dt };
    if (fn !== null) {
      state.f = fn.toString(16);
    }
    return { ...transition, state };
  }

  /** Persist non-accepted event material plus its escrow bucket membership. */
  private persistEscrowInstruction(instruction: EscrowInstruction): void {
    this.persistEscrowEventMaterial(instruction.log);
    switch (instruction.escrow) {
      case "ooo":
        this.db.ooes.addOn(instruction.pre, instruction.sn, instruction.said);
        break;
      case "partialSigs":
        this.db.pses.addOn(instruction.pre, instruction.sn, instruction.said);
        break;
      case "partialWigs":
        this.db.pwes.addOn(instruction.pre, instruction.sn, instruction.said);
        break;
      case "partialDels":
        this.db.pdes.addOn(instruction.pre, instruction.sn, instruction.said);
        break;
      case "duplicitous":
        this.db.ldes.addOn(instruction.pre, instruction.sn, instruction.said);
        break;
      case "delegables":
        this.db.delegables.add([instruction.pre], instruction.said);
        break;
      case "misfit":
        this.db.misfits.add([instruction.pre], instruction.said);
        break;
      case "queryNotFound":
        this.db.qnfs.add([instruction.pre], instruction.said);
        break;
    }
  }

  /** Persist event material required for later escrow reprocessing. */
  private persistEscrowEventMaterial(log: KELEventState): void {
    const pre = log.serder.pre;
    const said = log.serder.said;
    if (!pre || !said) {
      throw new ValidationError("Escrow persistence requires pre and said.");
    }

    if (!this.db.dtss.get([pre, said])) {
      this.db.dtss.put(
        [pre, said],
        log.frc?.dater ?? new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
      );
    }
    if (log.sigers.length > 0) {
      this.db.sigs.put([pre, said], [...log.sigers]);
    }
    if (log.wigers.length > 0) {
      this.db.wigs.put([pre, said], [...log.wigers]);
    }
    if ((log.wits?.length ?? 0) > 0) {
      this.db.wits.put(
        [pre, said],
        log.wits!.map((wit) => new Prefixer({ qb64: wit })),
      );
    }
    this.db.evts.put([pre, said], log.serder);
    if (log.sourceSeal) {
      this.db.udes.pin([pre, said], [
        normalizeSealOrdinal(log.sourceSeal.seqner),
        log.sourceSeal.diger,
      ]);
    }
    const existingEsr = this.db.esrs.get([pre, said]);
    if (existingEsr) {
      if (log.local && !existingEsr.local) {
        existingEsr.local = true;
        this.db.esrs.pin([pre, said], existingEsr);
      }
    } else {
      this.db.esrs.put([pre, said], { local: log.local });
    }
  }

  /** Reconstruct one escrowed event envelope from durable event/sig state. */
  private rehydrateEscrowEnvelope(pre: string, said: string): KeverEventEnvelope | null {
    const serder = this.db.getEvtSerder(pre, said);
    if (!serder) {
      return null;
    }
    const seal = this.db.udes.get([pre, said]) ?? this.db.aess.get([pre, said]);
    return {
      serder,
      sigers: this.db.sigs.get([pre, said]),
      wigers: this.db.wigs.get([pre, said]),
      frcs: [],
      sscs: seal ? [SourceSealCouple.fromTuple(seal)] : [],
      ssts: [],
      local: this.db.esrs.get([pre, said])?.local ?? false,
    };
  }

  /** Reprocess one ordinal-keyed escrow family. */
  private processOrdinalEscrow(kind: EscrowKind): void {
    const entries = (() => {
      switch (kind) {
        case "ooo":
          return [...this.db.ooes.getTopItemIter()] as Array<[string[], number, string]>;
        case "partialSigs":
          return [...this.db.pses.getTopItemIter()] as Array<[string[], number, string]>;
        case "partialWigs":
          return [...this.db.pwes.getTopItemIter()] as Array<[string[], number, string]>;
        case "partialDels":
          return [...this.db.pdes.getTopItemIter()] as Array<[string[], number, string]>;
        case "duplicitous":
          return [...this.db.ldes.getTopItemIter()] as Array<[string[], number, string]>;
        default:
          return [];
      }
    })();

    for (const [keys, on, said] of entries) {
      const pre = keys[0];
      if (!pre) {
        continue;
      }
      this.replayEscrowEntry(kind, pre, on, said);
    }
  }

  /** Reprocess one set-keyed escrow family. */
  private processSetEscrow(kind: EscrowKind): void {
    const entries = (() => {
      switch (kind) {
        case "delegables":
          return [...this.db.delegables.getTopItemIter()];
        case "misfit":
          return [...this.db.misfits.getTopItemIter()];
        case "queryNotFound":
          return [...this.db.qnfs.getTopItemIter()];
        default:
          return [];
      }
    })();

    for (const [keys, said] of entries) {
      const pre = keys[0];
      if (!pre) {
        continue;
      }
      this.replayEscrowEntry(kind, pre, null, said);
    }
  }

  /** Re-evaluate one escrow entry through the same decide/apply path. */
  private replayEscrowEntry(
    currentEscrow: EscrowKind,
    pre: string,
    on: number | null,
    said: string,
  ): void {
    const envelope = this.rehydrateEscrowEnvelope(pre, said);
    if (!envelope) {
      this.removeEscrow(currentEscrow, pre, on, said);
      return;
    }

    const decision = this.decideEvent(envelope);
    switch (decision.kind) {
      case "accept":
      case "duplicate":
        this.removeEscrow(currentEscrow, pre, on, said);
        this.applyDecision(decision);
        break;
      case "reject":
        this.removeEscrow(currentEscrow, pre, on, said);
        break;
      case "escrow":
        if (decision.reason !== currentEscrow) {
          this.removeEscrow(currentEscrow, pre, on, said);
          this.applyDecision(decision);
        }
        break;
    }
  }

  /** Remove one stored escrow pointer from its current bucket. */
  private removeEscrow(
    escrow: EscrowKind,
    pre: string,
    on: number | null,
    said: string,
  ): void {
    switch (escrow) {
      case "ooo":
        this.db.ooes.remOn(pre, on ?? 0, said);
        break;
      case "partialSigs":
        this.db.pses.remOn(pre, on ?? 0, said);
        break;
      case "partialWigs":
        this.db.pwes.remOn(pre, on ?? 0, said);
        break;
      case "partialDels":
        this.db.pdes.remOn(pre, on ?? 0, said);
        break;
      case "duplicitous":
        this.db.ldes.remOn(pre, on ?? 0, said);
        break;
      case "delegables":
        this.db.delegables.rem([pre], said);
        break;
      case "misfit":
        this.db.misfits.rem([pre], said);
        break;
      case "queryNotFound":
        this.db.qnfs.rem([pre], said);
        break;
    }
  }
}
