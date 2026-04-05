import {
  Cigar,
  Dater,
  Diger,
  Ilks,
  NumberPrimitive,
  Prefixer,
  SealSource,
  SerderKERI,
  Siger,
  Verfer,
} from "../../../cesr/mod.ts";
import { Baser } from "../db/basing.ts";
import { dgKey, snKey } from "../db/core/keys.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import { type DispatchOrdinal, type KeriDispatchEnvelope, type TransIdxSigGroup } from "./dispatch.ts";
import { UnverifiedReplyError, ValidationError } from "./errors.ts";
import {
  acceptEscrow,
  acceptQuery,
  acceptReceipt,
  dropEscrow,
  dropQuery,
  dropReceipt,
  type EscrowAccept,
  type EscrowDrop,
  type EscrowDropReason,
  type EscrowInstruction,
  type EscrowKeep,
  type EscrowKeepReason,
  type EscrowKind,
  type EscrowProcessDecision,
  escrowQuery,
  escrowReceipt,
  ignoreReceipt,
  keepEscrow,
  type KELEventState,
  type KeverDecision,
  type KeverTransition,
  logEscrowDecision,
  type QueryProcessDecision,
  type ReceiptDrop,
  type ReceiptEscrow,
  type ReceiptProcessDecision,
} from "./kever-decisions.ts";
import { Kever, type KeverEventInit } from "./kever.ts";
import { normalizeMbxTopicCursor } from "./mailbox-topics.ts";
import { makeReplySerder } from "./messages.ts";
import { KeyStateRecord } from "./records.ts";
import { Revery, Router } from "./routing.ts";
import { deriveRotatedWitnessSet, hasUniqueWitnesses } from "./witnesses.ts";

/** Normalize one dispatch ordinal into the number primitive expected by DB seal tuples. */
function normalizeSealOrdinal(
  seqner: DispatchOrdinal,
): NumberPrimitive {
  return seqner instanceof NumberPrimitive
    ? seqner
    : new NumberPrimitive({ qb64b: seqner.qb64b });
}

/** Rebuild one indexed witness signature from a detached non-transferable receipt. */
function wigerFromCigar(
  cigar: Cigar,
  index: number,
  verfer: Verfer,
): Siger {
  return Siger.fromCigar(cigar, { index, verfer });
}

type PartialWitnessReplayDecision =
  | EscrowAccept
  | EscrowDrop
  | { kind: "continue" };

type AcceptedReceiptedEventLookupDecision =
  | {
    kind: "accept";
    event: { pre: string; said: string; serder: SerderKERI; wits: string[] };
  }
  | EscrowKeep
  | EscrowDrop;

function continuePartialWitnessReplay(): { kind: "continue" } {
  return { kind: "continue" };
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
 * Query envelope subset consumed by `Kevery.processQuery()`.
 *
 * KERIpy correspondence:
 * - parser/reactor ingress normalizes the first transferable query endorsement
 *   into requester `source + sigers`
 * - non-transferable query endorsements remain detached `cigars`
 * - `q.src` still lives in the query body and must be explicit
 */
export interface QueryEnvelope {
  serder: SerderKERI;
  source?: Prefixer;
  sigers?: Siger[];
  cigars?: Cigar[];
}

/**
 * Receipt envelope subset consumed by `Kevery.processReceipt()`.
 *
 * KERIpy parity rule:
 * - live `rct` messages carry transferable receipt endorsements as `tsgs`
 * - replay/attached transferable receipt quadruples stay on the separate
 *   `trqs` path and do not flow through `processReceipt()`
 */
export type ReceiptEnvelope = Pick<
  KeriDispatchEnvelope,
  "serder" | "wigers" | "cigars" | "tsgs" | "local"
>;

type ReceiptEventDecision =
  | ReceiptEscrow
  | ReceiptDrop
  | {
    kind: "accept";
    event: { pre: string; said: string; serder: SerderKERI; wits: string[] };
  };

/**
 * Minimal but real KEL event processor backed by live `Kever` instances.
 *
 * `keri-ts` difference:
 * - the public processing seam returns typed decisions instead of using
 *   exceptions for normal remote-processing control flow
 */
export class Kevery {
  static readonly TimeoutUWE = 3600_000;
  static readonly TimeoutURE = 3600_000;
  static readonly TimeoutVRE = 3600_000;
  static readonly TimeoutQNF = 3600_000;

  readonly db: Baser;
  readonly cues: Deck<AgentCue>;
  readonly lax: boolean;
  readonly local: boolean;
  readonly rvy?: Revery;

  constructor(
    db: Baser,
    {
      cues,
      lax = true,
      local = false,
      rvy,
    }: {
      cues?: Deck<AgentCue>;
      lax?: boolean;
      local?: boolean;
      rvy?: Revery;
    } = {},
  ) {
    this.db = db;
    this.cues = cues ?? new Deck();
    this.lax = lax;
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
    const decision = this.decideQuery(envelope);
    this.applyLiveQueryDecision(envelope, decision);
  }

  /**
   * Decide how one live query should be handled without mutating escrow state.
   *
   * KERIpy correspondence:
   * - missing continuation state would raise KERIpy's query-not-found control
   *   flow exception
   * - unsupported routes would raise `ValidationError` and emit `invalid`
   * - `keri-ts` models those as explicit live-query decisions instead
   */
  private decideQuery(envelope: QueryEnvelope): QueryProcessDecision {
    const route = envelope.serder.route;
    const query = envelope.serder.ked?.q as Record<string, unknown> | undefined;
    const pre = typeof query?.i === "string" ? query.i : null;
    const src = typeof query?.src === "string" ? query.src : null;
    const dest = queryReplyDest(envelope);

    if (!route || !query || !pre || !src) {
      return dropQuery("malformedQuery");
    }

    if (!dest) {
      return dropQuery("missingRequesterSignatureMaterial");
    }

    switch (route) {
      case "logs": {
        const fn = query.fn === undefined ? 0 : parseQueryOrdinal(query.fn);
        const sn = query.s === undefined ? null : parseQueryOrdinal(query.s);
        if (fn === null || (query.s !== undefined && sn === null)) {
          return dropQuery("invalidLogsGate");
        }

        const kever = this.kevers.get(pre);
        if (!kever) {
          return escrowQuery("missingKever");
        }

        if (query.a !== undefined) {
          if (!this.db.fetchAllSealingEventByEventSeal(pre, query.a)) {
            return escrowQuery("missingAnchor");
          }
        } else if (sn !== null && kever.sner.num < BigInt(sn)) {
          return escrowQuery("unmetSequenceGate");
        } else if (sn !== null && !this.db.fullyWitnessed(kever.serder)) {
          return escrowQuery("notFullyWitnessed");
        }

        const msgs = [...this.db.clonePreIter(pre, fn)];
        if (kever.delpre) {
          msgs.push(...this.db.cloneDelegation(kever));
        }
        if (msgs.length === 0) {
          return acceptQuery();
        }
        return acceptQuery([{
          kin: "replay",
          pre,
          src,
          dest,
          msgs: concatMessages(msgs),
        }]);
      }
      case "ksn": {
        const kever = this.kevers.get(pre);
        if (!kever) {
          return escrowQuery("missingKever");
        }
        if (!this.db.fullyWitnessed(kever.serder)) {
          return escrowQuery("notFullyWitnessed");
        }
        return acceptQuery([{
          kin: "reply",
          route: "/ksn",
          serder: makeReplySerder(`/ksn/${src}`, kever.state().asDict()),
          src,
          dest,
        }]);
      }
      case "mbx": {
        if (!this.kevers.has(pre)) {
          return escrowQuery("missingKever");
        }
        return acceptQuery([{
          kin: "stream",
          serder: envelope.serder,
          pre,
          src,
          // `mbx` runtime flow always carries the KERIpy-style topic->cursor
          // map even when a boundary caller supplied configured topic names.
          topics: normalizeMbxTopicCursor(query.topics),
        }]);
      }
      default:
        return dropQuery("unsupportedRoute");
    }
  }

  /**
   * Apply one live query decision.
   *
   * Decision mapping:
   * - `accept` emits any carried cues
   * - `escrow` persists query-not-found retry material
   * - `drop` suppresses malformed queries, while unsupported routes still
   *   emit the legacy `invalid` cue for the host/runtime
   */
  private applyLiveQueryDecision(
    envelope: QueryEnvelope,
    decision: QueryProcessDecision,
  ): void {
    switch (decision.kind) {
      case "accept":
        this.emitDecisionCues(decision.cues);
        return;
      case "escrow":
        this.escrowQueryNotFoundEvent(envelope);
        return;
      case "drop":
        if (decision.reason === "unsupportedRoute") {
          this.cues.push({
            kin: "invalid",
            serder: envelope.serder,
            reason: `Unsupported query route ${envelope.serder.route}.`,
          });
        }
        return;
    }
  }

  /**
   * Process one receipt message and store any verified receipt attachments.
   *
   * KERIpy correspondence:
   * - mirrors `Kevery.processReceipt()`
   *
   * Receipt message model:
   * - `serder` is the `rct` message, not the receipted event
   * - non-transferable couples arrive as hydrated `cigars`
   * - witness indexed signatures arrive as `wigers`
   * - transferable receipt endorsements arrive as grouped `tsgs`
   *
   * Verification rule:
   * - every receipt signature verifies against the receipted event bytes, not
   *   the `rct` message body
   *
   * Storage rule:
   * - only receipts for the latest accepted event at `(pre, sn)` are stored
   * - if the receipted event is missing, escrow by receipt family
   * - if the receiptor establishment event is missing for a transferable
   *   receipt group, escrow that group in `vres.`
   */
  processReceipt(envelope: ReceiptEnvelope): void {
    const serder = envelope.serder;
    const pre = serder.pre;
    const sn = serder.sn;
    const said = serder.said;
    const local = envelope.local ?? this.local;
    if (!pre || sn === null || !said) {
      this.cues.push({
        kin: "invalid",
        serder,
        reason: "Receipt message is missing receipted pre, sn, or said.",
      });
      return;
    }

    const receiptEvent = this.decideReceiptEvent(pre, sn, said);
    switch (receiptEvent.kind) {
      case "drop":
        return;
      case "escrow":
        this.escrowMissingReceiptedEvent(envelope, said);
        return;
      case "accept":
        break;
    }

    this.storeVerifiedDetachedReceiptMaterial(
      receiptEvent.event,
      envelope,
      local,
    );
    for (const tsg of envelope.tsgs) {
      const decision = this.processVerifiedTransferableReceiptGroup(
        receiptEvent.event,
        tsg,
        local,
      );
      switch (decision.kind) {
        case "accept":
        case "ignore":
          continue;
        case "escrow":
          this.escrowTReceipts(
            serder,
            tsg.prefixer,
            tsg.seqner,
            tsg.diger,
            tsg.sigers,
          );
          return;
        case "drop":
          return;
      }
    }
  }

  /**
   * Decide whether live receipt processing has an accepted receipted event,
   * needs escrow, or should be dropped.
   *
   * KERIpy correspondence:
   * - stale receipts become `ValidationError`
   * - missing receipted events become `UnverifiedReceiptError`
   * - `keri-ts` models those as explicit drop/escrow decisions instead
   */
  private decideReceiptEvent(
    pre: string,
    sn: number,
    said: string,
  ): ReceiptEventDecision {
    const acceptedSaid = this.db.kels.getLast(pre, sn);
    if (acceptedSaid && acceptedSaid !== said) {
      return dropReceipt("staleReceipt");
    }
    if (!acceptedSaid) {
      return escrowReceipt("missingReceiptedEvent");
    }
    const serder = this.db.getEvtSerder(pre, said);
    if (!serder) {
      return dropReceipt("staleReceipt");
    }
    const wits = this.resolveAcceptedEventWitnesses(pre, said, serder);
    return wits
      ? { kind: "accept", event: { pre, said, serder, wits } }
      : escrowReceipt("missingReceiptedEvent");
  }

  /**
   * Escrow live receipt material when the receipted event is still missing.
   *
   * KERIpy correspondence:
   * - mirrors the family-specific escrow writes that precede
   *   `UnverifiedReceiptError` in `processReceipt()`
   */
  private escrowMissingReceiptedEvent(
    envelope: ReceiptEnvelope,
    said: string,
  ): void {
    const serder = envelope.serder;
    if (envelope.cigars.length > 0) {
      this.escrowUReceipt(serder, envelope.cigars, said);
    }
    if (envelope.tsgs.length > 0) {
      this.escrowTRGroups(serder, envelope.tsgs);
    }
    if (envelope.wigers.length > 0) {
      this.escrowUWReceipt(serder, envelope.wigers, said);
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

    const duplicateSaid = this.db.kels.getLast(pre, sn);
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
        this.db.udes.rem(dgKey(transition.pre, transition.said));
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

  /** Reprocess one pass of unverified witness receipt escrows. */
  processEscrowUnverWitness(): void {
    const entries = [...this.db.uwes.getTopItemIter()] as Array<
      [string[], number, string[]]
    >;

    for (const [keys, sn, couple] of entries) {
      const pre = keys[0];
      const said = couple[0];
      const wigerQb64 = couple[1];
      if (!pre || !said || !wigerQb64) {
        continue;
      }

      const decision = this.reprocessEscrowedWitnessReceipt(
        pre,
        sn,
        said,
        new Siger({ qb64: wigerQb64 }),
      );
      logEscrowDecision("Kevery UWE", decision);
      switch (decision.kind) {
        case "accept":
        case "drop":
          this.db.uwes.remOn([pre], sn, couple);
          break;
        case "keep":
          break;
      }
    }
  }

  /** Reprocess one pass of unverified non-transferable receipt escrows. */
  processEscrowUnverNonTrans(): void {
    const entries = [...this.db.ures.getTopItemIter()];
    for (const [keys, triple] of entries) {
      const pre = keys[0];
      const snh = keys[1];
      if (!pre || !snh) {
        continue;
      }
      const sn = parseInt(snh, 16);
      const [diger, prefixer, cigar] = triple;
      const hydrated = new Cigar(cigar, new Verfer({ qb64: prefixer.qb64 }));
      const decision = this.reprocessEscrowedNonTransReceipt(
        pre,
        sn,
        diger,
        hydrated,
      );
      logEscrowDecision("Kevery URE", decision);
      switch (decision.kind) {
        case "accept":
        case "drop":
          this.db.ures.rem([pre, snh], triple);
          break;
        case "keep":
          break;
      }
    }
  }

  /** Reprocess one pass of unverified transferable receipt escrows. */
  processEscrowUnverTrans(): void {
    const entries = [...this.db.vres.getTopItemIter()];
    for (const [keys, quintuple] of entries) {
      const pre = keys[0];
      const snh = keys[1];
      if (!pre || !snh) {
        continue;
      }
      const sn = parseInt(snh, 16);
      const decision = this.reprocessEscrowedTransferableReceipt(
        pre,
        sn,
        quintuple,
      );
      logEscrowDecision("Kevery VRE", decision);
      switch (decision.kind) {
        case "accept":
        case "drop":
          this.db.vres.rem([pre, snh], quintuple);
          break;
        case "keep":
          break;
      }
    }
  }

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

  /** Reprocess query-not-found escrows through the same query path. */
  processQueryNotFound(): void {
    const entries = [...this.db.qnfs.getTopItemIter()];
    for (const [keys, escrowedSaid] of entries) {
      const requester = keys[0];
      const qsaid = keys[1];
      if (!requester || !qsaid) {
        continue;
      }
      const decision = this.reprocessEscrowedQuery(
        requester,
        qsaid,
      );
      logEscrowDecision("Kevery QNF", decision);
      switch (decision.kind) {
        case "accept":
        case "drop":
          this.db.qnfs.rem([requester, qsaid], escrowedSaid);
          this.clearEscrowedQueryMaterial(requester, qsaid);
          break;
        case "keep":
          break;
      }
    }
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

    const ldig = this.db.kels.getLast(pre, sn);
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

  /**
   * Persist one missing-state query so later runtime turns can retry it.
   *
   * Storage contract:
   * - `evts.`, `dtss.`, `sigs.`, and `rcts.` reuse the KERIpy-style
   *   requester/query `dgKey(requester, said)` contract
   * - `qnfs.` tracks retry state by requester + query SAID, matching KERIpy's
   *   requester-oriented query escrow model rather than collapsing retries
   *   into the event-digest key families
   */
  private escrowQueryNotFoundEvent(envelope: QueryEnvelope): void {
    const said = envelope.serder.said;
    const requester = queryRequester(envelope);
    if (!said) {
      throw new ValidationError("Cannot escrow a query without SAID.");
    }
    if (!requester) {
      throw new ValidationError(
        "Cannot escrow a query without requester signature material.",
      );
    }

    const dgkey = dgKey(requester, said);
    this.db.evts.pin(dgkey, envelope.serder);
    // KERIpy timestamps QNF escrows with local insertion time, not the
    // message's embedded `q.dt`, so timeout behavior reflects how long this
    // node has held the retry rather than sender-supplied clock data.
    this.db.dtss.pin(
      dgkey,
      new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
    );

    const sigers = envelope.sigers ?? [];
    if (sigers.length > 0) {
      this.db.sigs.pin(dgkey, sigers);
    }

    const cigars = envelope.cigars ?? [];
    if (cigars.length > 0) {
      const couples: Array<[Prefixer, Cigar]> = cigars.flatMap(
        (cigar) => {
          const verfer = cigar.verfer;
          // KERIpy stores `rcts.` as durable `(Prefixer, Cigar)` couples rather
          // than hydrated `(Verfer, Cigar)` runtime objects. `keri-ts` mirrors
          // that store contract here, then rehydrates verifier context when the
          // escrowed query is replayed back into runtime `Cigar.verfer` form.
          return verfer ? [[new Prefixer({ qb64: verfer.qb64 }), cigar]] : [];
        },
      );
      if (couples.length > 0) {
        this.db.rcts.pin(dgkey, couples);
      }
    }

    // `qnfs.` intentionally keeps KERIpy's requester-oriented retry key shape.
    this.db.qnfs.add([requester, said], said);
  }

  /** Remove persisted query escrow artifacts once continuation is resolved or dropped. */
  private clearEscrowedQueryMaterial(requester: string, said: string): void {
    const dgkey = dgKey(requester, said);
    this.db.sigs.rem(dgkey);
    this.db.rcts.rem(dgkey);
    this.db.evts.rem(dgkey);
    this.db.dtss.rem(dgkey);
  }

  /**
   * Retry one missing-state query from `qnfs.` through the normal query path.
   *
   * Typed replay decisions make the KERIpy control flow explicit:
   * - live query `escrow` becomes replay `keep`
   * - live query `drop` becomes replay `drop`
   * - live query `accept` becomes replay `accept`
   */
  public reprocessEscrowedQuery(
    requester: string,
    qsaid: string,
  ): EscrowProcessDecision {
    const dgkey = dgKey(requester, qsaid);
    const expiry = this.escrowReplayExpiry(
      "QNF",
      requester,
      qsaid,
      Kevery.TimeoutQNF,
    );
    if (expiry) {
      return expiry;
    }

    const serder = this.db.evts.get(dgkey);
    if (!serder) {
      return dropEscrow("missingEscrowedEvent", {
        message: `QNF Missing escrowed evt at dig = ${qsaid}`,
        context: { requester, qsaid },
      });
    }
    if (serder.ilk !== Ilks.qry) {
      return dropEscrow("malformedEscrowedQuery", {
        message: `QNF Escrowed event at dig = ${qsaid} is not a query.`,
        context: { requester, qsaid, ilk: serder.ilk },
      });
    }

    const sigers = this.db.sigs.get(dgkey);
    // The durable `rcts.` contract is KERIpy-style `(Prefixer, Cigar)`, but
    // runtime query processing in `keri-ts` expects hydrated cigars that carry
    // `.verfer` directly, so replay converts the stored prefix wrapper back
    // into verifier context here.
    const cigars = this.db.rcts.get(dgkey).map(([prefixer, cigar]) =>
      new Cigar(cigar, new Verfer({ qb64: prefixer.qb64 }))
    );
    if (sigers.length === 0 && cigars.length === 0) {
      return dropEscrow("missingEscrowedEndorsements", {
        message: `QNF Missing escrowed evt sigs at dig = ${qsaid}`,
        context: { requester, qsaid },
      });
    }

    let source: Prefixer | undefined;
    if (sigers.length > 0) {
      try {
        source = new Prefixer({ qb64: requester });
      } catch (error) {
        return dropEscrow("malformedEscrowedQuery", {
          message: `QNF Failed to reconstruct escrowed query requester at dig = ${qsaid}`,
          context: {
            requester,
            qsaid,
            cause: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    const decision = this.decideQuery({
      serder,
      source,
      sigers,
      cigars,
    });
    switch (decision.kind) {
      case "accept":
        this.emitDecisionCues(decision.cues);
        return acceptEscrow();
      case "escrow":
        return keepEscrow("queryNotFound", {
          message: `QNF Query still waiting on continuation state at dig = ${qsaid}`,
          context: { requester, qsaid, queryReason: decision.reason },
        });
      case "drop":
        return dropEscrow("malformedEscrowedQuery", {
          message: `QNF Dropping escrowed query at dig = ${qsaid} after live query validation failed.`,
          context: { requester, qsaid, liveReason: decision.reason },
        });
    }
  }

  /**
   * Escrow one unverified witness receipt when the receipted event is missing.
   *
   * KERIpy correspondence:
   * - mirrors `Kevery.escrowUWReceipt()`
   *
   * Escrowed value:
   * - `(edig, wig)` where `edig` is the receipted event digest from the
   *   receipt body, not `serder.said`
   * - each `wig` is a witness indexed signature whose verifier cannot yet be
   *   assigned until the witness list of the receipted event is known
   *
   * Why key by `(pre, sn)`:
   * - receipt digests may not match the database digest algorithm exactly, so
   *   later replay must recover the receipted event by last event at sequence
   *   number, not by trusting the digest alone
   */
  private escrowUWReceipt(
    serder: SerderKERI,
    wigers: readonly Siger[],
    said: string,
  ): void {
    const pre = serder.pre;
    const sn = serder.sn;
    if (!pre || sn === null) {
      return;
    }
    this.db.dtss.pin(
      dgKey(pre, said),
      new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
    );
    for (const wiger of wigers) {
      // Witness verifiers are assigned later from the resolved witness list of
      // the receipted event, so escrow stores the detached signature plus the
      // receipted event digest only.
      this.db.uwes.addOn([pre], sn, [said, wiger.qb64]);
    }
  }

  /**
   * Escrow one unverified non-transferable receipt when the receipted event is missing.
   *
   * KERIpy correspondence:
   * - mirrors `Kevery.escrowUReceipt()`
   *
   * Escrowed value:
   * - `(edig, rpre, cig)` where `edig` is the receipted event digest from the
   *   receipt body, `rpre` is the non-transferable receiptor prefix, and
   *   `cig` is the detached signature over the receipted event
   *
   * Why key by `(pre, sn)`:
   * - receipt digests may vary by digest algorithm, so unescrow must find the
   *   latest accepted event at the sequence number first and then compare digs
   */
  private escrowUReceipt(
    serder: SerderKERI,
    cigars: readonly Cigar[],
    said: string,
  ): void {
    const pre = serder.pre;
    const sn = serder.sn;
    if (!pre || sn === null) {
      return;
    }
    this.db.dtss.pin(
      dgKey(pre, said),
      new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
    );
    const snkey = snKey(pre, sn);
    for (const cigar of cigars) {
      const verfer = cigar.verfer;
      if (!verfer || verfer.transferable) {
        continue;
      }
      // `ures.` keeps the same durable KERIpy receipt-couple shape as `rcts.`,
      // so escrow stores the non-transferable receiptor as a `Prefixer` even
      // though the runtime cigar already carries a hydrated `Verfer`.
      this.db.ures.add(
        snkey,
        [new Diger({ qb64: said }), new Prefixer({ qb64: verfer.qb64 }), cigar],
      );
    }
  }

  /**
   * Escrow one set of transferable receipt groups when the receipted event is missing.
   *
   * KERIpy correspondence:
   * - mirrors `Kevery.escrowTRGroups()`
   *
   * Escrowed value:
   * - one quintuple per siger: `(edig, spre, ssnu, sdig, sig)`
   * - `edig` is the receipted event digest from the receipt body
   * - `spre`, `ssnu`, and `sdig` identify the receiptor establishment event
   * - `sig` is one indexed signature over the receipted event
   *
   * Design rule:
   * - live `rct` processing uses grouped `tsgs`
   * - escrow/storage flattens those groups into quintuple rows in `vres.`
   *   exactly the way KERIpy does
   */
  private escrowTRGroups(
    serder: SerderKERI,
    tsgs: readonly TransIdxSigGroup[],
  ): void {
    const pre = serder.pre;
    const sn = serder.sn;
    const said = serder.said;
    if (!pre || sn === null || !said) {
      return;
    }
    this.db.dtss.pin(
      dgKey(pre, said),
      new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
    );
    const snkey = snKey(pre, sn);
    for (const tsg of tsgs) {
      // Flatten each group into one escrow row per siger so later unescrow can
      // validate and promote each verified receipt independently.
      for (const siger of tsg.sigers) {
        this.db.vres.add(
          snkey,
          [
            new Diger({ qb64: said }),
            tsg.prefixer,
            normalizeSealOrdinal(tsg.seqner),
            tsg.diger,
            siger,
          ],
        );
      }
    }
  }

  /**
   * Escrow one transferable receipt group when the receiptor establishment event is missing.
   *
   * KERIpy correspondence:
   * - mirrors `Kevery.escrowTReceipts()`
   *
   * Distinction from `escrowTRGroups()`:
   * - `escrowTRGroups()` is used when the receipted event itself is missing
   * - `escrowTReceipts()` is used when the receipted event exists but the
   *   receiptor establishment event is not yet in the receiptor's KEL
   */
  private escrowTReceipts(
    serder: SerderKERI,
    prefixer: Prefixer,
    seqner: DispatchOrdinal,
    diger: Diger,
    sigers: readonly Siger[],
  ): void {
    const pre = serder.pre;
    const sn = serder.sn;
    const said = serder.said;
    if (!pre || sn === null || !said) {
      return;
    }
    this.db.dtss.pin(
      dgKey(pre, said),
      new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
    );
    const snkey = snKey(pre, sn);
    // The receipted event is known here, but the receiptor's establishment
    // event is not, so escrow still uses the same quintuple shape as grouped
    // transferable receipt escrows.
    for (const siger of sigers) {
      this.db.vres.add(
        snkey,
        [
          new Diger({ qb64: said }),
          prefixer,
          normalizeSealOrdinal(seqner),
          diger,
          siger,
        ],
      );
    }
  }

  /**
   * Store verified detached receipt attachments for one accepted receipted event.
   *
   * Responsibilities:
   * - verify detached non-transferable couples against the receipted event
   * - promote non-transferable witness receipts into indexed `wigs.`
   *
   * KERIpy correspondence:
   * - this is the `cigars` / `wigers` subset of `processReceipt()`
   * - grouped transferable receipts stay on their own decision path so
   *   terminal drop versus escrow remains explicit in `keri-ts`
   */
  private storeVerifiedDetachedReceiptMaterial(
    event: { pre: string; said: string; serder: SerderKERI; wits: string[] },
    envelope: ReceiptEnvelope,
    local: boolean,
  ): void {
    const dgkey = dgKey(event.pre, event.said);
    for (const cigar of envelope.cigars) {
      const verfer = cigar.verfer;
      if (!verfer || verfer.transferable) {
        continue;
      }
      // In non-promiscuous mode, skip own receipts on own events and on
      // nonlocal other events just as KERIpy does.
      if (this.ownReceiptConflict(event.pre, verfer.qb64, local)) {
        continue;
      }
      if (!verfer.verify(cigar.raw, event.serder.raw)) {
        continue;
      }
      const witnessIndex = event.wits.indexOf(verfer.qb64);
      if (witnessIndex >= 0) {
        // A detached non-transferable receipt from a current witness is
        // promoted to an indexed witness signature before storage.
        this.db.wigs.add(
          dgkey,
          wigerFromCigar(cigar, witnessIndex, verfer),
        );
        continue;
      }
      // Non-witness non-transferable receipts stay in `rcts.` as durable
      // `(Prefixer, Cigar)` couples even though runtime code carries
      // verifier-hydrated cigars.
      this.db.rcts.add(
        dgkey,
        // Match KERIpy's durable `rcts.` store shape. Runtime code rehydrates
        // this back into `cigar.verfer` when loading from DB.
        [new Prefixer({ qb64: verfer.qb64 }), cigar],
      );
    }

    for (const wiger of envelope.wigers) {
      const verferQb64 = event.wits[wiger.index];
      if (!verferQb64) {
        // Bad witness index drops here just like KERIpy skips invalid witness
        // positions before verifier assignment.
        continue;
      }
      // Witness receipt verification assigns the verifier from the receipted
      // event's current witness list, not from detached receipt material.
      const verfer = new Verfer({ qb64: verferQb64 });
      if (verfer.transferable || !verfer.verify(wiger.raw, event.serder.raw)) {
        continue;
      }
      if (this.ownReceiptConflict(event.pre, verfer.qb64, local)) {
        continue;
      }
      this.db.wigs.add(
        dgkey,
        new Siger(
          {
            code: wiger.code,
            raw: wiger.raw,
            index: wiger.index,
            ondex: wiger.ondex,
          },
          verfer,
        ),
      );
    }
  }

  /**
   * Return the KERIpy-style own-receipt conflict for one receiptor, if any.
   *
   * In non-promiscuous mode (`lax === false`), local AIDs do not receipt their
   * own events and do not accept their own receipts for remote events unless
   * the receipt source is explicitly local/protected.
   */
  private ownReceiptConflict(
    receiptedPre: string,
    receiptorPre: string,
    local: boolean,
  ): "ownEvent" | "nonlocal" | null {
    if (this.lax || !this.prefixes.has(receiptorPre)) {
      return null;
    }
    if (this.prefixes.has(receiptedPre)) {
      return "ownEvent";
    }
    return local ? null : "nonlocal";
  }

  /**
   * Process one live transferable receipt group against an accepted receipted event.
   *
   * KERIpy correspondence:
   * - missing receiptor establishment state becomes `UnverifiedTransferableReceiptError`
   * - own transferable receiptor conflicts and bad seals/indices become
   *   terminal `ValidationError`
   * - invalid signature bytes are skipped per siger rather than dropping the
   *   whole group
   */
  private processVerifiedTransferableReceiptGroup(
    event: { pre: string; said: string; serder: SerderKERI; wits: string[] },
    tsg: TransIdxSigGroup,
    local: boolean,
  ): ReceiptProcessDecision {
    if (this.ownReceiptConflict(event.pre, tsg.pre, local)) {
      return dropReceipt("ownTransferableReceiptorConflict");
    }

    const estSaid = this.db.kels.getLast(tsg.pre, Number(tsg.sn));
    if (!estSaid) {
      return escrowReceipt("missingReceiptorEstablishment");
    }
    if (estSaid !== tsg.said) {
      return dropReceipt("invalidReceiptorSeal");
    }

    const estEvent = this.db.getEvtSerder(tsg.pre, estSaid);
    if (!estEvent || estEvent.verfers.length === 0) {
      return dropReceipt("invalidReceiptorEstablishment");
    }

    const dgkey = dgKey(event.pre, event.said);
    let stored = false;
    for (const siger of tsg.sigers) {
      if (siger.index >= estEvent.verfers.length) {
        return dropReceipt("invalidReceiptorIndex");
      }
      const verfer = estEvent.verfers[siger.index];
      if (!verfer) {
        return dropReceipt("invalidReceiptorEstablishment");
      }
      if (!verfer.verify(siger.raw, event.serder.raw)) {
        continue;
      }
      this.db.vrcs.add(
        dgkey,
        [
          tsg.prefixer,
          normalizeSealOrdinal(tsg.seqner),
          tsg.diger,
          new Siger(
            {
              code: siger.code,
              raw: siger.raw,
              index: siger.index,
              ondex: siger.ondex,
            },
            verfer,
          ),
        ],
      );
      stored = true;
    }
    return stored ? acceptReceipt() : ignoreReceipt();
  }

  /**
   * Find the accepted receipted event if the receipt is not stale.
   *
   * Latest-event rule:
   * - receipts are only accepted for the latest accepted event at `(pre, sn)`
   * - if the digest does not match the KEL head at that sequence number, the
   *   receipt is stale and should be ignored
   */
  public lookupAcceptedReceiptedEvent(
    scope: "URE" | "VRE",
    pre: string,
    sn: number,
    said: string,
  ): AcceptedReceiptedEventLookupDecision {
    const acceptedSaid = this.db.kels.getLast(pre, sn);
    const snh = sn.toString(16);
    if (!acceptedSaid) {
      return keepEscrow("missingReceiptedEvent", {
        message: `${scope} Missing receipted evt at pre=${pre} sn=${snh}`,
        context: { pre, sn, said, scope },
      });
    }
    if (acceptedSaid !== said) {
      return dropEscrow("invalidReceiptDigest", {
        message: `${scope} Bad escrowed receipt dig at pre=${pre} sn=${snh}`,
        context: { pre, sn, said, acceptedSaid, scope },
      });
    }
    const serder = this.db.getEvtSerder(pre, said);
    if (!serder) {
      return dropEscrow("invalidReceiptedEventReference", {
        message: `${scope} Invalid receipted evt reference at pre=${pre} sn=${snh}`,
        context: { pre, sn, said, acceptedSaid, scope },
      });
    }
    const wits = this.resolveAcceptedEventWitnesses(pre, said, serder);
    if (!wits) {
      return keepEscrow("missingReceiptedEvent", {
        message: `${scope} Kever not ready for receipted evt at pre=${pre} sn=${snh}`,
        context: { pre, sn, said, scope },
      });
    }
    return {
      kind: "accept",
      event: { pre, said, serder, wits },
    };
  }

  /**
   * Resolve the witness list used for accepted-event receipt processing.
   *
   * Order of preference:
   * - witness state already logged with the accepted event in `wits.`
   * - backers carried directly on inception/delegated inception events
   * - current live key state for later event types
   *
   * KERIpy note:
   * - accepted-event receipt handling is a different seam from
   *   `_processEscrowFindUnver()`
   * - partial-witness replay deliberately recomputes the witness list from the
   *   escrowed event and current state instead of trusting this projection
   */
  private resolveAcceptedEventWitnesses(
    pre: string,
    said: string,
    serder: SerderKERI,
  ): string[] | null {
    const stored = this.db.wits.get(dgKey(pre, said)).map((wit) => wit.qb64);
    if (stored.length > 0) {
      return stored;
    }
    if (serder.ilk === Ilks.icp || serder.ilk === Ilks.dip) {
      return [...serder.backs];
    }
    const kever = this.db.getKever(pre);
    return kever ? [...kever.wits] : null;
  }

  /**
   * Rebuild one partial-witness escrow event's witness list for receipt replay.
   *
   * KERIpy correspondence:
   * - mirrors the witness-list reconstruction inside `_processEscrowFindUnver()`
   */
  public resolvePartialWitnessEscrowWitnesses(
    serder: SerderKERI,
  ): { kind: "accept"; wits: string[] } | { kind: "continue" } | EscrowDrop {
    if (serder.ilk === Ilks.icp || serder.ilk === Ilks.dip) {
      const wits = [...serder.backs];
      return hasUniqueWitnesses(wits)
        ? { kind: "accept", wits }
        : dropEscrow("duplicateWitnesses", {
          message: `PWE Invalid wits = ${JSON.stringify(wits)} has duplicates for evt = ${JSON.stringify(serder.ked)}.`,
          context: { pre: serder.pre, said: serder.said, wits },
        });
    }

    const kever = this.db.getKever(serder.pre ?? "");
    if (serder.ilk === Ilks.rot || serder.ilk === Ilks.drt) {
      // Rotation receipts need current accepted witness state before cuts/adds
      // can be applied. KERIpy treats that as "not ready yet", not corruption.
      if (!kever) {
        return continuePartialWitnessReplay();
      }
      const derived = deriveRotatedWitnessSet(
        kever.wits,
        serder.cuts,
        serder.adds,
      );
      if (derived.kind === "accept") {
        return { kind: "accept", wits: derived.value.wits };
      }
      return dropEscrow(derived.reason, {
        message: `PWE Invalid witness cuts/adds for evt = ${JSON.stringify(serder.ked)}.`,
        context: {
          pre: serder.pre,
          said: serder.said,
          reason: derived.reason,
          cuts: [...serder.cuts],
          adds: [...serder.adds],
          currentWits: [...kever.wits],
        },
      });
    }

    // For non-establishment events, partial-witness replay expects current key
    // state to be available already; otherwise the escrowed state is corrupt.
    if (!kever) {
      return dropEscrow("processingError", {
        message: `PWE Missing current key state for receipted evt at pre=${serder.pre ?? ""}.`,
        context: { pre: serder.pre, said: serder.said, ilk: serder.ilk },
      });
    }
    return { kind: "accept", wits: [...kever.wits] };
  }

  /**
   * Search `pwes.` for one receipt's matching event and, if it is a witness
   * receipt, verify and store it in `wigs.`.
   *
   * KERIpy correspondence:
   * - mirrors `_processEscrowFindUnver()`
   *
   * Important rule:
   * - this helper only promotes receipts into `wigs.`
   * - it never writes `rcts.` while the receipted event is still in `pwes.`
   */
  private processEscrowFindUnver(
    pre: string,
    sn: number,
    said: string,
    { wiger, cigar }: { wiger?: Siger; cigar?: Cigar },
  ): PartialWitnessReplayDecision {
    for (const candidateSaid of this.db.pwes.getOnIter([pre], sn)) {
      if (candidateSaid !== said) {
        continue;
      }

      const serder = this.db.getEvtSerder(pre, candidateSaid);
      if (!serder) {
        return dropEscrow("missingEscrowedEvent", {
          message: `PWE Missing escrowed evt at dig = ${candidateSaid}`,
          context: { pre, sn, said: candidateSaid },
        });
      }

      const witnessState = this.resolvePartialWitnessEscrowWitnesses(serder);
      if (witnessState.kind === "continue") {
        return witnessState;
      }
      if (witnessState.kind === "drop") {
        return witnessState;
      }

      if (cigar) {
        const verfer = cigar.verfer;
        const receiptorPre = verfer?.qb64;
        if (!verfer || !receiptorPre) {
          return dropEscrow("missingEscrowArtifact", {
            message: `PWE Missing verifier context for escrowed receipt at pre=${pre} sn=${sn.toString(16)}.`,
            context: { pre, sn, said },
          });
        }
        const witnessIndex = witnessState.wits.indexOf(receiptorPre);
        if (witnessIndex < 0) {
          continue;
        }
        if (!verfer.verify(cigar.raw, serder.raw)) {
          return dropEscrow("invalidReceiptSignature", {
            message: `PWE Bad escrowed witness receipt wig at pre=${pre} sn=${sn.toString(16)}.`,
            context: { pre, sn, said, receiptor: receiptorPre },
          });
        }
        this.db.wigs.add(
          dgKey(pre, serder.said ?? said),
          wigerFromCigar(cigar, witnessIndex, verfer),
        );
        return acceptEscrow();
      }

      if (!wiger) {
        return dropEscrow("missingEscrowArtifact", {
          message: `PWE Missing escrowed witness signature material at pre=${pre} sn=${sn.toString(16)}.`,
          context: { pre, sn, said },
        });
      }
      const verferQb64 = witnessState.wits[wiger.index];
      if (!verferQb64) {
        return dropEscrow("invalidWitnessIndex", {
          message: `PWE Bad escrowed witness receipt index=${wiger.index} at pre=${pre} sn=${sn.toString(16)}`,
          context: {
            pre,
            sn,
            said,
            witnessIndex: wiger.index,
            wits: witnessState.wits,
          },
        });
      }
      const verfer = new Verfer({ qb64: verferQb64 });
      if (!verfer.verify(wiger.raw, serder.raw)) {
        return dropEscrow("invalidReceiptSignature", {
          message: `PWE Bad escrowed witness receipt wig at pre=${pre} sn=${sn.toString(16)}.`,
          context: {
            pre,
            sn,
            said,
            witnessIndex: wiger.index,
            witness: verferQb64,
          },
        });
      }
      this.db.wigs.add(
        dgKey(pre, serder.said ?? said),
        new Siger(
          {
            code: wiger.code,
            raw: wiger.raw,
            index: wiger.index,
            ondex: wiger.ondex,
          },
          verfer,
        ),
      );
      return acceptEscrow();
    }

    return continuePartialWitnessReplay();
  }

  /**
   * Reprocess one witness receipt escrow entry from `uwes.`.
   *
   * KERIpy rule:
   * - UWE replay only retries against `pwes.` through `_processEscrowFindUnver`
   * - if the partial-witness event is still not ready, keep the receipt escrowed
   */
  public reprocessEscrowedWitnessReceipt(
    pre: string,
    sn: number,
    said: string,
    wiger: Siger,
  ): EscrowProcessDecision {
    const expiry = this.escrowReplayExpiry("UWE", pre, said, Kevery.TimeoutUWE);
    if (expiry) {
      return expiry;
    }
    const decision = this.processEscrowFindUnver(pre, sn, said, { wiger });
    return decision.kind === "continue"
      ? keepEscrow("missingReceiptedEvent", {
        message: `UWE Missing witness receipted evt at pre=${pre} sn=${sn.toString(16)}`,
        context: { pre, sn, said },
      })
      : decision;
  }

  /**
   * Reprocess one non-transferable receipt escrow entry from `ures.`.
   *
   * Escrow replay may promote the receipt into `wigs.` if the receiptor turns
   * out to be a current witness, otherwise it lands in `rcts.`.
   */
  private reprocessEscrowedNonTransReceipt(
    pre: string,
    sn: number,
    diger: Diger,
    cigar: Cigar,
  ): EscrowProcessDecision {
    const said = diger.qb64;
    const expiry = this.escrowReplayExpiry("URE", pre, said, Kevery.TimeoutURE);
    if (expiry) {
      return expiry;
    }
    const verfer = cigar.verfer;
    if (!verfer) {
      return dropEscrow("missingEscrowArtifact", {
        message: `URE Missing escrowed receipt verifier at pre=${pre} sn=${sn.toString(16)}.`,
        context: { pre, sn, said },
      });
    }

    const partialDecision = this.processEscrowFindUnver(pre, sn, said, {
      cigar,
    });
    if (partialDecision.kind === "accept" || partialDecision.kind === "drop") {
      return partialDecision;
    }

    const lookup = this.lookupAcceptedReceiptedEvent("URE", pre, sn, said);
    if (lookup.kind !== "accept") {
      return lookup;
    }
    const { event } = lookup;
    if (!verfer.verify(cigar.raw, event.serder.raw)) {
      return dropEscrow("invalidReceiptSignature", {
        message: `URE Bad escrowed receipt sig at pre=${pre} sn=${sn.toString(16)} receipter=${verfer.qb64}`,
        context: { pre, sn, said, receiptor: verfer.qb64 },
      });
    }
    const dgkey = dgKey(event.pre, event.said);
    const witnessIndex = event.wits.indexOf(verfer.qb64);
    if (witnessIndex >= 0) {
      this.db.wigs.add(
        dgkey,
        wigerFromCigar(cigar, witnessIndex, verfer),
      );
      return acceptEscrow();
    }
    this.db.rcts.add(
      dgkey,
      // Keep the stored receipt shape KERIpy uses for `rcts.` even though the
      // reprocessed runtime cigar already has verifier context attached.
      [new Prefixer({ qb64: verfer.qb64 }), cigar],
    );
    return acceptEscrow();
  }

  /**
   * Reprocess one transferable receipt escrow entry from `vres.`.
   *
   * Escrowed transferable receipts are stored as quintuples, but successful
   * replay writes only the verified quadruple into `vrcs.`.
   */
  public reprocessEscrowedTransferableReceipt(
    pre: string,
    sn: number,
    quintuple: [Diger, Prefixer, NumberPrimitive, Diger, Siger],
  ): EscrowProcessDecision {
    const [receiptedDiger, prefixer, snumber, ssaider, siger] = quintuple;
    const said = receiptedDiger.qb64;
    const expiry = this.escrowReplayExpiry("VRE", pre, said, Kevery.TimeoutVRE);
    if (expiry) {
      return expiry;
    }
    const lookup = this.lookupAcceptedReceiptedEvent("VRE", pre, sn, said);
    if (lookup.kind !== "accept") {
      return lookup;
    }
    const { event } = lookup;

    const estSaid = this.db.kels.getLast(prefixer.qb64, Number(snumber.num));
    if (!estSaid) {
      return keepEscrow("missingReceiptorEstablishment", {
        message: `VRE Missing receiptor establishment evt at pre=${prefixer.qb64} sn=${snumber.num.toString(16)}`,
        context: {
          pre,
          sn,
          said,
          receiptor: prefixer.qb64,
          receiptorSn: snumber.num.toString(16),
        },
      });
    }
    if (estSaid !== ssaider.qb64) {
      return dropEscrow("invalidReceiptorSeal", {
        message: `VRE Bad chit seal at sn = ${snumber.num.toString(16)} for receipt from pre = ${prefixer.qb64}`,
        context: {
          pre,
          sn,
          said,
          receiptor: prefixer.qb64,
          estSaid,
          sealSaid: ssaider.qb64,
        },
      });
    }
    const estEvent = this.db.getEvtSerder(prefixer.qb64, estSaid);
    if (!estEvent) {
      return dropEscrow("invalidReceiptorEstablishment", {
        message: `VRE Invalid seal est. event dig = ${ssaider.qb64} for receipt from pre = ${prefixer.qb64}`,
        context: { pre, sn, said, receiptor: prefixer.qb64, estSaid },
      });
    }
    if (estEvent.verfers.length === 0) {
      return dropEscrow("missingReceiptorKeys", {
        message: `VRE Invalid seal est. event dig = ${ssaider.qb64} for receipt from pre = ${prefixer.qb64} no keys`,
        context: { pre, sn, said, receiptor: prefixer.qb64, estSaid },
      });
    }
    if (siger.index >= estEvent.verfers.length) {
      return dropEscrow("receiptorIndexOutOfRange", {
        message: `VRE Index = ${siger.index} too large for keys`,
        context: {
          pre,
          sn,
          said,
          receiptor: prefixer.qb64,
          estSaid,
          sigerIndex: siger.index,
          keyCount: estEvent.verfers.length,
        },
      });
    }
    const verfer = estEvent.verfers[siger.index];
    if (!verfer.verify(siger.raw, event.serder.raw)) {
      return dropEscrow("invalidReceiptSignature", {
        message: `VRE Bad escrowed trans receipt sig at pre=${pre} sn=${sn.toString(16)} receipter=${prefixer.qb64}`,
        context: {
          pre,
          sn,
          said,
          receiptor: prefixer.qb64,
          sigerIndex: siger.index,
        },
      });
    }
    const dgkey = dgKey(event.pre, event.said);
    this.db.vrcs.add(
      dgkey,
      [
        prefixer,
        snumber,
        ssaider,
        new Siger(
          {
            code: siger.code,
            raw: siger.raw,
            index: siger.index,
            ondex: siger.ondex,
          },
          verfer,
        ),
      ],
    );
    return acceptEscrow();
  }

  /** Return one replay-drop reason when a receipt/query escrow item is no longer retryable. */
  private escrowReplayExpiry(
    scope: "QNF" | "UWE" | "URE" | "VRE",
    pre: string,
    said: string,
    timeoutMs: number,
  ): EscrowDrop | null {
    const dater = this.db.dtss.get(dgKey(pre, said));
    if (!dater) {
      return dropEscrow("missingDater", {
        message: `${scope} Missing escrowed event datetime at dig = ${said}`,
        context: { pre, said, scope },
      });
    }
    return Date.now() - new Date(dater.iso8601).getTime() > timeoutMs
      ? dropEscrow("stale", {
        message: `${scope} Stale event escrow at dig = ${said}`,
        context: { pre, said, scope },
      })
      : null;
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
    const dgkey = dgKey(kever.pre, serder.said ?? "");
    const storedWitnesses = this.db.wits.get(dgkey)
      .map((
        wit,
      ) => wit.qb64);
    const existingSigs = new Set(
      this.db.sigs.get(dgkey).map((siger) => siger.qb64),
    );
    const existingWigs = new Set(
      this.db.wigs.get(dgkey).map((wiger) => wiger.qb64),
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
    const dgkey = dgKey(pre, said);

    if (!this.db.dtss.get(dgkey)) {
      this.db.dtss.put(
        dgkey,
        log.frc?.dater
          ?? new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
      );
    }
    if (log.sigers.length > 0) {
      this.db.sigs.put(dgkey, [...log.sigers]);
    }
    if (log.wigers.length > 0) {
      this.db.wigs.put(dgkey, [...log.wigers]);
    }
    if ((log.wits?.length ?? 0) > 0) {
      this.db.wits.put(
        dgkey,
        log.wits!.map((wit) => new Prefixer({ qb64: wit })),
      );
    }
    this.db.evts.put(dgkey, log.serder);
    if (log.sourceSeal) {
      this.db.udes.pin(dgkey, [
        normalizeSealOrdinal(log.sourceSeal.s),
        log.sourceSeal.d,
      ]);
    }
    const existingEsr = this.db.esrs.get(dgkey);
    if (existingEsr) {
      if (log.local && !existingEsr.local) {
        existingEsr.local = true;
        this.db.esrs.pin(dgkey, existingEsr);
      }
    } else {
      this.db.esrs.put(dgkey, { local: log.local });
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
    const dgkey = dgKey(pre, said);
    const seal = this.db.udes.get(dgkey) ?? this.db.aess.get(dgkey);
    return {
      serder,
      sigers: this.db.sigs.get(dgkey),
      wigers: this.db.wigs.get(dgkey),
      frcs: [],
      sscs: seal ? [SealSource.fromTuple(seal)] : [],
      ssts: [],
      local: this.db.esrs.get(dgkey)?.local ?? false,
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

/**
 * Return the requester identity carried by one normalized query envelope.
 *
 * KERIpy correspondence:
 * - transferable query endorsements arrive as `source + sigers`
 * - non-transferable query endorsements arrive as `cigars`
 */
function queryRequester(envelope: QueryEnvelope): string | null {
  if (envelope.source) {
    return envelope.source.qb64;
  }
  const cigar = envelope.cigars?.[0];
  return cigar?.verfer?.qb64 ?? null;
}

/** Return the reply destination derived from one normalized query envelope. */
function queryReplyDest(envelope: QueryEnvelope): string | null {
  return queryRequester(envelope);
}

function parseQueryOrdinal(value: unknown): number | null {
  if (typeof value !== "string" || !/^[0-9a-f]+$/iu.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 16);
  return Number.isNaN(parsed) ? null : parsed;
}
