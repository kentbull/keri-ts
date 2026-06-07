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
  SerderACDC,
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

export interface TelDispatchArgs {
  serder: SerderKERI;
  seqner: SealSource["s"] | null;
  saider: SealSource["d"] | null;
  attachmentGroups: readonly AttachmentGroup[];
  local: boolean;
  sigers: Siger[];
  wigers: Siger[];
  cigars: Cigar[];
  trqs: TransReceiptQuadruple[];
  tsgs: TransIdxSigGroup[];
  ssgs: TransLastIdxSigGroup[];
  frcs: FirstSeenReplayCouple[];
  sscs: SealSource[];
  tdcs: SealKind[];
}

export interface AcdcDispatchArgs {
  serder: SerderACDC;
  prefixer: SealEvent["i"] | null;
  seqner: SealEvent["s"] | null;
  saider: SealEvent["d"] | null;
  attachmentGroups: readonly AttachmentGroup[];
  local: boolean;
  ptds: PathedMaterialGroup[];
  essrs: Texter[];
  ssts: SealEvent[];
  bsqs: BlindState[];
  bsss: BoundState[];
  tmqs: TypeMedia[];
}

export interface TeveryLike {
  processEvent?(args: TelDispatchArgs): void;
  processEscrows?(): void;
}

export interface VerifierLike {
  processACDC?(args: AcdcDispatchArgs): void;
  processEscrows?(): void;
}

export interface VdrDispatchServices {
  tvy?: TeveryLike | null;
  vry?: VerifierLike | null;
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
  vdr: VdrDispatchServices = {},
): ReplyProcessDecision | void {
  const serder = envelope.serder as SerderKERI | SerderACDC;
  if (serder instanceof SerderACDC) {
    if (serder.ilk === null) {
      vdr.vry?.processACDC?.(acdcEnvelopeFromDispatch(envelope, serder));
    }
    return;
  }

  switch (serder.ilk) {
    case Ilks.rpy:
      return revery.processReply({
        serder,
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
        serder,
        tsgs: envelope.tsgs,
        cigars: envelope.cigars,
        ptds: envelope.ptds,
        essrs: envelope.essrs,
      });
      break;
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      vdr.tvy?.processEvent?.(telEnvelopeFromDispatch(envelope, serder));
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
            serder,
            cigars: envelope.cigars,
            firner: envelope.lastFrc?.firner,
            local: envelope.local,
          });
          kevery.processAttachedReceiptQuadruples({
            serder,
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

function telEnvelopeFromDispatch(
  envelope: KeriDispatchEnvelope,
  serder: SerderKERI,
): TelDispatchArgs {
  const source = envelope.lastSsc;
  return {
    serder,
    seqner: source?.s ?? null,
    saider: source?.d ?? null,
    attachmentGroups: envelope.attachmentGroups,
    local: envelope.local,
    sigers: [...envelope.sigers],
    wigers: [...envelope.wigers],
    cigars: [...envelope.cigars],
    trqs: [...envelope.trqs],
    tsgs: [...envelope.tsgs],
    ssgs: [...envelope.ssgs],
    frcs: [...envelope.frcs],
    sscs: [...envelope.sscs],
    tdcs: [...envelope.tdcs],
  };
}

function acdcEnvelopeFromDispatch(
  envelope: KeriDispatchEnvelope,
  serder: SerderACDC,
): AcdcDispatchArgs {
  const source = envelope.lastSst;
  return {
    serder,
    prefixer: source?.i ?? null,
    seqner: source?.s ?? null,
    saider: source?.d ?? null,
    attachmentGroups: envelope.attachmentGroups,
    local: envelope.local,
    ptds: [...envelope.ptds],
    essrs: [...envelope.essrs],
    ssts: [...envelope.ssts],
    bsqs: [...envelope.bsqs],
    bsss: [...envelope.bsss],
    tmqs: [...envelope.tmqs],
  };
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
