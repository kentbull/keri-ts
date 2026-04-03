import {
  Cigar,
  Dater,
  Diger,
  Ilks,
  NumberPrimitive,
  Prefixer,
  SerderKERI,
  Verfer,
} from "../../../cesr/mod.ts";
import { Baser } from "../db/basing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import {
  type DispatchOrdinal,
  type KeriDispatchEnvelope,
  SourceSealCouple,
  type TransIdxSigGroup,
} from "./dispatch.ts";
import { UnverifiedReplyError, ValidationError } from "./errors.ts";
import {
  type EscrowInstruction,
  type EscrowKind,
  type KELEventState,
  type KeverDecision,
  type KeverTransition,
} from "./kever-decisions.ts";
import { Kever, type KeverEventInit } from "./kever.ts";
import { KeyStateRecord } from "./records.ts";
import { Revery, Router } from "./routing.ts";

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

/** Query envelope subset consumed by `Kevery.processQuery()`. */
export type QueryEnvelope = Pick<
  KeriDispatchEnvelope,
  "serder" | "cigars" | "tsgs"
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
  readonly rvy?: Revery;

  constructor(
    db: Baser,
    {
      cues,
      local = false,
      rvy,
    }: {
      cues?: Deck<AgentCue>;
      local?: boolean;
      rvy?: Revery;
    } = {},
  ) {
    this.db = db;
    this.cues = cues ?? new Deck();
    this.local = local;
    this.rvy = rvy;
  }

  /** Live accepted-state cache delegated from the backing `Baser`. */
  get kevers(): Map<string, Kever> {
    return this.db.kevers;
  }

  /** Locally managed AIDs delegated from the backing `Baser`. */
  get prefixes(): Set<string> {
    return this.db.prefixes;
  }

  /** Register the reply routes owned by `Kevery` itself. */
  registerReplyRoutes(router: Router): void {
    router.addRoute("/ksn/{aid}", this, "KeyStateNotice");
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
   * Process one query message through the KEL-owned query/reply path.
   *
   * Current route support:
   * - `logs`
   * - `ksn`
   * - `mbx`
   */
  processQuery(envelope: QueryEnvelope): void {
    const route = envelope.serder.route;
    const query = envelope.serder.ked?.q as Record<string, unknown> | undefined;
    const pre = typeof query?.i === "string" ? query.i : null;
    const src = typeof query?.src === "string"
      ? query.src
      : inferQuerySource(envelope);

    if (!route || !query || !pre || !src) {
      this.cues.push({
        kin: "invalid",
        serder: envelope.serder,
        reason: "Query message is missing route, i, or src.",
      });
      return;
    }

    switch (route) {
      case "logs": {
        const msgs = [...this.db.clonePreIter(pre)];
        if (msgs.length === 0) {
          this.cues.push({
            kin: "invalid",
            serder: envelope.serder,
            reason: `No replay material available for ${pre}.`,
          });
          return;
        }
        this.cues.push({
          kin: "replay",
          pre,
          src,
          dest: inferQuerySource(envelope) ?? undefined,
          msgs: concatMessages(msgs),
        });
        return;
      }
      case "ksn": {
        const kever = this.kevers.get(pre);
        if (!kever) {
          this.cues.push({
            kin: "invalid",
            serder: envelope.serder,
            reason: `No accepted key state available for ${pre}.`,
          });
          return;
        }
        this.cues.push({
          kin: "reply",
          route: `/ksn/${src}`,
          data: kever.state().asDict(),
          src,
          dest: inferQuerySource(envelope) ?? undefined,
        });
        return;
      }
      case "mbx": {
        const topics = normalizeMailboxTopics(query.topics);
        if (!this.kevers.has(pre)) {
          this.cues.push({
            kin: "invalid",
            serder: envelope.serder,
            reason: `No mailbox topic authority available for ${pre}.`,
          });
          return;
        }
        this.cues.push({
          kin: "stream",
          serder: envelope.serder,
          pre,
          src,
          topics,
        });
        return;
      }
      default:
        this.cues.push({
          kin: "invalid",
          serder: envelope.serder,
          reason: `Unsupported query route ${route}.`,
        });
    }
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
          message:
            `Duplicate inception event ${said} for ${pre} must keep sn=0.`,
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
        this.emitAcceptanceCues(
          kever,
          transition.log.serder,
          transition.log.local,
        );
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
   * Process one `/ksn/{aid}` reply and persist the accepted key-state notice.
   */
  processReplyKeyStateNotice(args: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    aid: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): void {
    if (!this.rvy) {
      throw new ValidationError(
        "Kevery is not configured with a reply verifier.",
      );
    }
    if (!args.route.startsWith("/ksn")) {
      throw new ValidationError(
        `Unsupported route=${args.route} in ${Ilks.rpy} reply.`,
      );
    }

    const ksn = KeyStateRecord.fromDict(args.serder.ked?.a);
    const pre = typeof ksn.i === "string" ? ksn.i : null;
    const sn = typeof ksn.s === "string" ? parseInt(ksn.s, 16) : null;
    const said = typeof ksn.d === "string" ? ksn.d : null;
    const dt = typeof ksn.dt === "string" ? ksn.dt : null;
    if (!pre || sn === null || Number.isNaN(sn) || !said || !dt) {
      throw new ValidationError("Malformed key state notice reply body.");
    }

    const existing = this.kevers.get(pre);
    if (existing && sn < existing.sn) {
      throw new ValidationError(
        `Skipped stale key state at sn=${sn} for ${pre}.`,
      );
    }

    const keys: [string, string] = [pre, args.aid];
    let osaider = this.db.knas.get(keys);
    if (osaider?.qb64 === args.diger.qb64) {
      osaider = null;
    }
    const accepted = this.rvy.acceptReply({
      serder: args.serder,
      saider: args.diger,
      route: args.route,
      aid: args.aid,
      osaider,
      cigars: args.cigars,
      tsgs: args.tsgs,
    });
    if (!accepted) {
      throw new UnverifiedReplyError(
        `Unverified key state notice reply ${args.serder.said ?? "<unknown>"}.`,
      );
    }

    const ldig = this.db.getKel(pre, sn);
    if (ldig && ldig !== said) {
      throw new ValidationError(
        `Mismatch key state at sn=${sn} with accepted event log for ${pre}.`,
      );
    }

    const saider = new Diger({ qb64: said });
    const dater = new Dater({ qb64: encodeDateTimeToDater(dt) });
    this.updateKeyState(args.aid, ksn, saider, dater);
    this.cues.push({ kin: "keyStateSaved", ksn });
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
    const storedWitnesses = this.db.wits.get([kever.pre, serder.said ?? ""])
      .map((
        wit,
      ) => wit.qb64);
    const existingSigs = new Set(
      this.db.sigs.get([kever.pre, serder.said ?? ""]).map((siger) =>
        siger.qb64
      ),
    );
    const existingWigs = new Set(
      this.db.wigs.get([kever.pre, serder.said ?? ""]).map((wiger) =>
        wiger.qb64
      ),
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
    const state = KeyStateRecord.fromDict({ ...transition.state, dt });
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
        log.frc?.dater ??
          new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
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
  private rehydrateEscrowEnvelope(
    pre: string,
    said: string,
  ): KeverEventEnvelope | null {
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
          return [...this.db.ooes.getTopItemIter()] as Array<
            [string[], number, string]
          >;
        case "partialSigs":
          return [...this.db.pses.getTopItemIter()] as Array<
            [string[], number, string]
          >;
        case "partialWigs":
          return [...this.db.pwes.getTopItemIter()] as Array<
            [string[], number, string]
          >;
        case "partialDels":
          return [...this.db.pdes.getTopItemIter()] as Array<
            [string[], number, string]
          >;
        case "duplicitous":
          return [...this.db.ldes.getTopItemIter()] as Array<
            [string[], number, string]
          >;
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

  /** Persist accepted key-state notice projections into their dedicated stores. */
  private updateKeyState(
    aid: string,
    ksn: KeyStateRecord,
    saider: Diger,
    dater: Dater,
  ): void {
    this.db.kdts.pin([saider.qb64], dater);
    this.db.ksns.pin([saider.qb64], ksn);
    if (ksn.i) {
      this.db.knas.pin([ksn.i, aid], saider);
    }
  }
}

function concatMessages(messages: readonly Uint8Array[]): Uint8Array {
  if (messages.length === 0) {
    return new Uint8Array();
  }
  let total = 0;
  for (const msg of messages) {
    total += msg.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const msg of messages) {
    out.set(msg, offset);
    offset += msg.length;
  }
  return out;
}

function inferQuerySource(envelope: QueryEnvelope): string | null {
  const cigar = envelope.cigars[0];
  if (cigar?.verfer) {
    return cigar.verfer.qb64;
  }
  return envelope.tsgs[0]?.pre ?? null;
}

function normalizeMailboxTopics(
  value: unknown,
): Record<string, number> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((topic): topic is string => typeof topic === "string")
        .map((topic) => [topic, 0]),
    );
  }

  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([topic]) => typeof topic === "string")
      .map((
        [topic, idx],
      ) => [topic, typeof idx === "number" ? idx : Number(idx) || 0]),
  );
}
