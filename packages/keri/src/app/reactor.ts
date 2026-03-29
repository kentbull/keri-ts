import { type Operation } from "npm:effection@^3.6.0";
import {
  type AttachmentGroup,
  type CesrMessage,
  createParser,
  type GroupEntry,
  isCounterGroupLike,
  isPrimitiveTuple,
  isQualifiedPrimitive,
  parseSerder,
  SerderKERI,
  Siger,
  type Smellage,
  Texter,
} from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import {
  BlindedStateQuadruple,
  BoundStateSextuple,
  CigarCouple,
  FirstSeenReplayCouple,
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  SourceSealCouple,
  SourceSealTriple,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
  TypedDigestSealCouple,
  TypedMediaQuadruple,
} from "../core/dispatch.ts";
import { Kevery } from "../core/eventing.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import type { Habery } from "./habbing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/**
 * Shared message-routing component for one `Habery`.
 *
 * KERIpy correspondence:
 * - this is the nearest local correlate to the reactor/doer bundle that owns
 *   parser ingress, `Revery`, `Kevery`, and the reply router
 *
 * Ownership model:
 * - `Reactor` owns transient ingress bytes plus the parser and dispatch seams
 * - the shared cue deck is injected so higher-level hosts can preserve the
 *   KERIpy shared-cues mental model
 * - durable event/reply state still lives in the `Habery` database, not in
 *   this component
 */
export class Reactor {
  readonly hby: Habery;
  readonly cues: Deck<AgentCue>;
  readonly ingress: Deck<Uint8Array>;
  readonly router: Router;
  readonly revery: Revery;
  readonly replyRoutes: BasicReplyRouteHandler;
  readonly kevery: Kevery;
  readonly parser: ReturnType<typeof createParser>;
  readonly local: boolean;

  constructor(
    hby: Habery,
    { cues, local = false }: { cues?: Deck<AgentCue>; local?: boolean } = {},
  ) {
    this.hby = hby;
    this.cues = cues ?? new Deck();
    this.ingress = new Deck();
    this.router = new Router();
    this.revery = new Revery(hby.db, { rtr: this.router, cues: this.cues });
    this.replyRoutes = new BasicReplyRouteHandler(hby.db, this.revery);
    this.replyRoutes.registerReplyRoutes(this.router);
    this.kevery = new Kevery(hby.db, { cues: this.cues });
    this.parser = createParser({
      framed: false,
      attachmentDispatchMode: "compat",
    });
    this.local = local;
  }

  /**
   * Queue one CESR/KERI message byte sequence for later parsing.
   *
   * This is the transient ingress seam used by both local synthetic messages
   * and remotely fetched OOBI artifacts.
   */
  ingest(bytes: Uint8Array): void {
    this.ingress.push(bytes);
  }

  /**
   * Drain one bounded message-processing pass.
   *
   * This mirrors the KERIpy pattern where a doer owns the long-lived loop but
   * delegates the actual work to a plain drain helper.
   */
  processOnce(): void {
    while (!this.ingress.empty) {
      const chunk = this.ingress.pull();
      if (!chunk) {
        continue;
      }
      const frames = this.parser.feed(chunk);
      for (const frame of frames) {
        if (frame.type === "error") {
          throw frame.error;
        }
        this.dispatchEnvelope(envelopeFromMessage(frame.frame, this.local));
      }
    }
  }

  /**
   * Run one bounded escrow-processing pass.
   *
   * Current scope:
   * - KEL escrows through `Kevery.processEscrows()`
   * - reply escrows through `Revery.processEscrowReply()`
   */
  processEscrowsOnce(): void {
    this.kevery.processEscrows();
    this.revery.processEscrowReply();
  }

  /**
   * Continuous message doer for command hosts that keep the runtime alive.
   *
   * This is the Effection equivalent of a KERIpy `msgDo`: drain ingress, yield
   * to the scheduler, and repeat indefinitely.
   */
  *msgDo(): Operation<never> {
    while (true) {
      this.processOnce();
      yield* runtimeTurn();
    }
  }

  /**
   * Continuous escrow doer for the long-lived runtime host.
   *
   * KERIpy correspondence:
   * - mirrors the dedicated `escrowDo` loop rather than folding escrow
   *   processing into parser ingress
   */
  *escrowDo(): Operation<never> {
    while (true) {
      this.processEscrowsOnce();
      yield* runtimeTurn();
    }
  }

  /**
   * Dispatch one normalized envelope to the active app-layer processor.
   *
   * Current dispatch matrix:
   * - `rpy` -> `Revery`
   * - `icp` / `dip` -> bootstrap `Kevery`
   *
   * All other ilks are intentionally ignored for now so the runtime can ingest
   * the minimum bootstrap OOBI material without pretending wider parity.
   */
  private dispatchEnvelope(envelope: KeriDispatchEnvelope): void {
    switch (envelope.serder.ilk) {
      case "rpy":
        this.revery.processReply({
          serder: envelope.serder,
          cigars: envelope.cigars,
          tsgs: envelope.tsgs,
        });
        break;
      case "icp":
      case "dip":
      case "rot":
      case "drt":
      case "ixn":
        this.kevery.processEvent(envelope);
        break;
      default:
        break;
    }
  }
}

/**
 * Rebuild parser smellage from one framed CESR body.
 *
 * `parseSerder()` expects explicit smellage because the frame parser has
 * already done the top-level body classification work. Recomputing this once in
 * one helper keeps the serder boundary explicit.
 */
function smellageFromMessage(
  message: CesrMessage,
): Smellage {
  return {
    proto: message.body.proto,
    pvrsn: message.body.pvrsn,
    kind: message.body.kind,
    size: message.body.size,
    gvrsn: message.body.gvrsn,
  };
}

/**
 * Normalize one tuple of indexers into concrete `Siger` instances.
 *
 * This helper intentionally rebuilds the narrow signature primitive so callers
 * can verify signatures against `.raw` without having to reason about generic
 * parser item unions.
 */
function normalizeTupleIndexers(entry: GroupEntry | undefined): Siger[] {
  if (!entry || !isPrimitiveTuple(entry)) {
    return [];
  }
  const out: Siger[] = [];
  for (const item of entry) {
    if (!isQualifiedPrimitive(item)) {
      continue;
    }
    out.push(new Siger({ qb64b: item.qb64b }));
  }
  return out;
}

/**
 * Normalize one parser attachment group into `KeriDispatchEnvelope` fields.
 *
 * Coverage goal:
 * - normalize the full KERIpy parser `exts` family set needed for later event,
 *   reply, query, EXN, and TEL dispatch
 *
 * Deferred parity:
 * - attachment families that exist in CESR but are not part of the KERIpy
 *   parser dispatch accumulation contract may still remain outside this seam
 */
function normalizeAttachmentGroup(
  group: AttachmentGroup,
  envelope: KeriDispatchEnvelope,
): void {
  switch (group.name) {
    case "AttachmentGroup":
    case "BigAttachmentGroup":
    case "BodyWithAttachmentGroup":
    case "BigBodyWithAttachmentGroup":
      for (const item of group.items) {
        if (isCounterGroupLike(item)) {
          normalizeAttachmentGroup(item as AttachmentGroup, envelope);
        }
      }
      return;
    case "ControllerIdxSigs":
    case "BigControllerIdxSigs":
      for (const item of group.items) {
        if (isPrimitiveTuple(item)) {
          envelope.sigers.push(...normalizeTupleIndexers(item));
          continue;
        }
        if (!isQualifiedPrimitive(item)) {
          continue;
        }
        envelope.sigers.push(new Siger({ qb64b: item.qb64b }));
      }
      return;
    case "WitnessIdxSigs":
    case "BigWitnessIdxSigs":
      for (const item of group.items) {
        if (isPrimitiveTuple(item)) {
          envelope.wigers.push(...normalizeTupleIndexers(item));
          continue;
        }
        if (!isQualifiedPrimitive(item)) {
          continue;
        }
        envelope.wigers.push(new Siger({ qb64b: item.qb64b }));
      }
      return;
    case "NonTransReceiptCouples":
    case "BigNonTransReceiptCouples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 2) {
          continue;
        }
        const [verfer, cigar] = item;
        if (!isQualifiedPrimitive(verfer) || !isQualifiedPrimitive(cigar)) {
          continue;
        }
        envelope.cigars.push(
          CigarCouple.fromQb64bTuple([verfer.qb64b, cigar.qb64b]),
        );
      }
      return;
    case "TransReceiptQuadruples":
    case "BigTransReceiptQuadruples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 4) {
          continue;
        }
        const [prefixer, seqner, diger, siger] = item;
        if (
          !isQualifiedPrimitive(prefixer) ||
          !isQualifiedPrimitive(seqner) ||
          !isQualifiedPrimitive(diger) ||
          !isQualifiedPrimitive(siger)
        ) {
          continue;
        }
        envelope.trqs.push(
          TransReceiptQuadruple.fromQb64bTuple([
            prefixer.qb64b,
            seqner.qb64b,
            diger.qb64b,
            siger.qb64b,
          ]),
        );
      }
      return;
    case "TransIdxSigGroups":
    case "BigTransIdxSigGroups":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 4) {
          continue;
        }
        const [prefixer, seqner, diger, sigers] = item;
        if (
          !isQualifiedPrimitive(prefixer) ||
          !isQualifiedPrimitive(seqner) ||
          !isQualifiedPrimitive(diger)
        ) {
          continue;
        }
        envelope.tsgs.push(
          TransIdxSigGroup.fromQb64bTuple(
            [prefixer.qb64b, seqner.qb64b, diger.qb64b],
            normalizeTupleIndexers(sigers),
          ),
        );
      }
      return;
    case "TransLastIdxSigGroups":
    case "BigTransLastIdxSigGroups":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 2) {
          continue;
        }
        const [prefixer, sigers] = item;
        if (!isQualifiedPrimitive(prefixer)) {
          continue;
        }
        envelope.ssgs.push(
          TransLastIdxSigGroup.fromQb64bTuple(
            prefixer.qb64b,
            normalizeTupleIndexers(sigers),
          ),
        );
      }
      return;
    case "FirstSeenReplayCouples":
    case "BigFirstSeenReplayCouples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 2) {
          continue;
        }
        const [fn, dater] = item;
        if (!isQualifiedPrimitive(fn) || !isQualifiedPrimitive(dater)) {
          continue;
        }
        envelope.frcs.push(
          FirstSeenReplayCouple.fromQb64bTuple([fn.qb64b, dater.qb64b]),
        );
      }
      return;
    case "SealSourceCouples":
    case "BigSealSourceCouples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 2) {
          continue;
        }
        const [seqner, diger] = item;
        if (!isQualifiedPrimitive(seqner) || !isQualifiedPrimitive(diger)) {
          continue;
        }
        envelope.sscs.push(
          SourceSealCouple.fromQb64bTuple([seqner.qb64b, diger.qb64b]),
        );
      }
      return;
    case "SealSourceTriples":
    case "BigSealSourceTriples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 3) {
          continue;
        }
        const [prefixer, seqner, diger] = item;
        if (
          !isQualifiedPrimitive(prefixer) ||
          !isQualifiedPrimitive(seqner) ||
          !isQualifiedPrimitive(diger)
        ) {
          continue;
        }
        envelope.ssts.push(
          SourceSealTriple.fromQb64bTuple([
            prefixer.qb64b,
            seqner.qb64b,
            diger.qb64b,
          ]),
        );
      }
      return;
    case "TypedDigestSealCouples":
    case "BigTypedDigestSealCouples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 2) {
          continue;
        }
        const [verser, diger] = item;
        if (!isQualifiedPrimitive(verser) || !isQualifiedPrimitive(diger)) {
          continue;
        }
        envelope.tdcs.push(
          TypedDigestSealCouple.fromQb64bTuple([verser.qb64b, diger.qb64b]),
        );
      }
      return;
    case "PathedMaterialCouples":
    case "BigPathedMaterialCouples":
      envelope.ptds.push(PathedMaterialGroup.fromRaw(group.raw));
      return;
    case "ESSRPayloadGroup":
    case "BigESSRPayloadGroup":
      for (const item of group.items) {
        if (!isQualifiedPrimitive(item)) {
          continue;
        }
        envelope.essrs.push(new Texter({ qb64b: item.qb64b }));
      }
      return;
    case "BlindedStateQuadruples":
    case "BigBlindedStateQuadruples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 4) {
          continue;
        }
        const [diger, noncer, acdcer, stater] = item;
        if (
          !isQualifiedPrimitive(diger) ||
          !isQualifiedPrimitive(noncer) ||
          !isQualifiedPrimitive(acdcer) ||
          !isQualifiedPrimitive(stater)
        ) {
          continue;
        }
        envelope.bsqs.push(
          BlindedStateQuadruple.fromQb64bTuple([
            diger.qb64b,
            noncer.qb64b,
            acdcer.qb64b,
            stater.qb64b,
          ]),
        );
      }
      return;
    case "BoundStateSextuples":
    case "BigBoundStateSextuples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 6) {
          continue;
        }
        const [diger, noncer, acdcer, stater, number, eventer] = item;
        if (
          !isQualifiedPrimitive(diger) ||
          !isQualifiedPrimitive(noncer) ||
          !isQualifiedPrimitive(acdcer) ||
          !isQualifiedPrimitive(stater) ||
          !isQualifiedPrimitive(number) ||
          !isQualifiedPrimitive(eventer)
        ) {
          continue;
        }
        envelope.bsss.push(
          BoundStateSextuple.fromQb64bTuple([
            diger.qb64b,
            noncer.qb64b,
            acdcer.qb64b,
            stater.qb64b,
            number.qb64b,
            eventer.qb64b,
          ]),
        );
      }
      return;
    case "TypedMediaQuadruples":
    case "BigTypedMediaQuadruples":
      for (const item of group.items) {
        if (!isPrimitiveTuple(item) || item.length < 4) {
          continue;
        }
        const [diger, noncer, labeler, texter] = item;
        if (
          !isQualifiedPrimitive(diger) ||
          !isQualifiedPrimitive(noncer) ||
          !isQualifiedPrimitive(labeler) ||
          !isQualifiedPrimitive(texter)
        ) {
          continue;
        }
        envelope.tmqs.push(
          TypedMediaQuadruple.fromQb64bTuple([
            diger.qb64b,
            noncer.qb64b,
            labeler.qb64b,
            texter.qb64b,
          ]),
        );
      }
      return;
    default:
      return;
  }
}

/**
 * Convert one parsed CESR frame into the runtime's normalized dispatch shape.
 *
 * This is the single parser-to-KERI normalization seam for Gate E. All OOBI
 * material and local runtime-ingested KERI messages should flow through this
 * shape before app-layer dispatch.
 */
function envelopeFromMessage(
  message: CesrMessage,
  local = false,
): KeriDispatchEnvelope {
  const serder = parseSerder(
    message.body.raw,
    smellageFromMessage(message),
  ) as SerderKERI;
  const envelope = new KeriDispatchEnvelope({
    serder,
    attachmentGroups: message.attachments,
    local,
  });
  for (const group of message.attachments) {
    normalizeAttachmentGroup(group, envelope);
  }
  return envelope;
}
