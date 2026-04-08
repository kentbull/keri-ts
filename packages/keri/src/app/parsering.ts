import {
  type AttachmentGroup,
  BlindState,
  BoundState,
  type CesrFrame,
  type CesrMessage,
  Cigar,
  type GroupEntry,
  Ilks,
  isCounterGroupLike,
  isPrimitiveTuple,
  isQualifiedPrimitive,
  parseSerder,
  SealEvent,
  SealKind,
  SealSource,
  SerderKERI,
  Siger,
  type Smellage,
  Texter,
  TypeMedia,
  Verfer,
} from "../../../cesr/mod.ts";
import {
  FirstSeenReplayCouple,
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
} from "../core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../core/eventing.ts";
import { type ReplyProcessDecision, Revery } from "../core/routing.ts";

export interface ExchangerLike {
  processEvent(args: {
    serder: SerderKERI;
    tsgs: TransIdxSigGroup[];
    cigars: Cigar[];
    ptds: PathedMaterialGroup[];
    essrs: Texter[];
  }): void;
}

/**
 * Convert one or more already-parsed CESR frames into KERI dispatch envelopes.
 *
 * Architectural rule:
 * - CESR parsing belongs to the real `CesrParser`
 * - KERI normalization belongs here
 * - routing into `Revery` / `Kevery` / `Exchanger` happens separately via
 *   `dispatchEnvelope(...)`
 */
export function envelopesFromFrames(
  frames: readonly CesrFrame[],
  local = false,
): KeriDispatchEnvelope[] {
  const envelopes: KeriDispatchEnvelope[] = [];
  for (const frame of frames) {
    if (frame.type === "error") {
      throw frame.error;
    }
    envelopes.push(envelopeFromMessage(frame.frame, local));
  }
  return envelopes;
}

/**
 * Route one already-parsed KERI dispatch envelope into the established
 * `Revery` / `Kevery` / `Exchanger` architecture.
 */
export function dispatchEnvelope(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger?: ExchangerLike,
): ReplyProcessDecision | void {
  switch (envelope.serder.ilk) {
    case Ilks.rpy:
      return revery.processReply({
        serder: envelope.serder,
        cigars: envelope.cigars,
        tsgs: envelope.tsgs,
      });
    case Ilks.qry:
      kevery.processQuery(queryEnvelopeFromDispatch(envelope));
      break;
    case Ilks.rct:
      kevery.processReceipt(envelope);
      break;
    case Ilks.exn:
      exchanger?.processEvent({
        serder: envelope.serder,
        tsgs: envelope.tsgs,
        cigars: envelope.cigars,
        ptds: envelope.ptds,
        essrs: envelope.essrs,
      });
      break;
    case Ilks.icp:
    case Ilks.dip:
    case Ilks.rot:
    case Ilks.drt:
    case Ilks.ixn:
      {
        const decision = kevery.processEvent(envelope);
        if (decision.kind === "accept" || decision.kind === "duplicate") {
          kevery.processAttachedReceiptCouples({
            serder: envelope.serder,
            cigars: envelope.cigars,
            firner: envelope.lastFrc?.firner,
            local: envelope.local,
          });
          kevery.processAttachedReceiptQuadruples({
            serder: envelope.serder,
            trqs: envelope.trqs,
            firner: envelope.lastFrc?.firner,
            local: envelope.local,
          });
        }
      }
      break;
    default:
      break;
  }
}

function smellageFromMessage(message: CesrMessage): Smellage {
  return {
    proto: message.body.proto,
    pvrsn: message.body.pvrsn,
    kind: message.body.kind,
    size: message.body.size,
    gvrsn: message.body.gvrsn,
  };
}

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

function cigarFromQb64bCouple(
  verferQb64b: Uint8Array,
  cigarQb64b: Uint8Array,
): Cigar {
  return new Cigar(
    { qb64b: cigarQb64b },
    new Verfer({ qb64b: verferQb64b }),
  );
}

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
          cigarFromQb64bCouple(verfer.qb64b, cigar.qb64b),
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
          !isQualifiedPrimitive(prefixer)
          || !isQualifiedPrimitive(seqner)
          || !isQualifiedPrimitive(diger)
          || !isQualifiedPrimitive(siger)
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
          !isQualifiedPrimitive(prefixer)
          || !isQualifiedPrimitive(seqner)
          || !isQualifiedPrimitive(diger)
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
          SealSource.fromQb64bTuple([seqner.qb64b, diger.qb64b]),
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
          !isQualifiedPrimitive(prefixer)
          || !isQualifiedPrimitive(seqner)
          || !isQualifiedPrimitive(diger)
        ) {
          continue;
        }
        envelope.ssts.push(
          SealEvent.fromQb64bTuple([
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
          SealKind.fromQb64bTuple([verser.qb64b, diger.qb64b]),
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
        const [blid, uuid, acdc, state] = item;
        if (
          !isQualifiedPrimitive(blid)
          || !isQualifiedPrimitive(uuid)
          || !isQualifiedPrimitive(acdc)
          || !isQualifiedPrimitive(state)
        ) {
          continue;
        }
        envelope.bsqs.push(
          BlindState.fromQb64bTuple([
            blid.qb64b,
            uuid.qb64b,
            acdc.qb64b,
            state.qb64b,
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
        const [blid, uuid, acdc, state, number, bound] = item;
        if (
          !isQualifiedPrimitive(blid)
          || !isQualifiedPrimitive(uuid)
          || !isQualifiedPrimitive(acdc)
          || !isQualifiedPrimitive(state)
          || !isQualifiedPrimitive(number)
          || !isQualifiedPrimitive(bound)
        ) {
          continue;
        }
        envelope.bsss.push(
          BoundState.fromQb64bTuple([
            blid.qb64b,
            uuid.qb64b,
            acdc.qb64b,
            state.qb64b,
            number.qb64b,
            bound.qb64b,
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
        const [blid, uuid, mediaType, mediaValue] = item;
        if (
          !isQualifiedPrimitive(blid)
          || !isQualifiedPrimitive(uuid)
          || !isQualifiedPrimitive(mediaType)
          || !isQualifiedPrimitive(mediaValue)
        ) {
          continue;
        }
        envelope.tmqs.push(
          TypeMedia.fromQb64bTuple([
            blid.qb64b,
            uuid.qb64b,
            mediaType.qb64b,
            mediaValue.qb64b,
          ]),
        );
      }
      return;
    default:
      return;
  }
}

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

function queryEnvelopeFromDispatch(
  envelope: KeriDispatchEnvelope,
): QueryEnvelope {
  const lastSsg = envelope.ssgs.at(-1);
  return {
    serder: envelope.serder,
    source: lastSsg?.prefixer,
    sigers: lastSsg ? [...lastSsg.sigers] : [],
    cigars: [...envelope.cigars],
  };
}
