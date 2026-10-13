import {
  type AttachmentGroup,
  BlindState,
  BoundState,
  type CesrFrame,
  Cigar,
  Dater,
  Diger,
  type EssrPayload,
  FirstSeen,
  type GroupEntry,
  Ilks,
  isCounterGroupLike,
  isGroupTuple,
  Labeler,
  Noncer,
  NumberPrimitive,
  parseSerder,
  Prefixer,
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
  Verser,
} from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import {
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
} from "../core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../core/eventing.ts";
import { type ReplyProcessDecision, Revery } from "../core/routing.ts";
import type { ExchangeDecision } from "./exchanging.ts";

/** Exchange admission may await durable payload storage before dispatch advances. */
export interface ExchangerLike {
  /** Resolve after signature admission and its required storage/handler effects finish. */
  processEvent(args: {
    serder: SerderKERI;
    tsgs: TransIdxSigGroup[];
    cigars: Cigar[];
    ptds: PathedMaterialGroup[];
    /** Reopenable payload views owned by the dispatch caller. */
    essr?: EssrPayload;
    /** Hosted endpoint that received this message, independent of its claimed sender. */
    mailboxAid?: string | null;
  }): Operation<void | ExchangeDecision>;
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
  frcs: FirstSeen[];
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
  /** Reopenable ESSR views carried alongside credential attachments. */
  essr?: EssrPayload;
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
 * - CESR parsing belongs to the real progressive CESR parser
 * - KERI normalization belongs here
 * - routing into `Revery` / `Kevery` / `Exchanger` happens separately via
 *   `dispatchEnvelope(...)`
 */
export function envelopesFromFrames(
  frames: readonly CesrFrame[],
  local = false,
): KeriDispatchEnvelope[] {
  return frames.map((frame) => envelopeFromFrame(frame, local));
}

/**
 * Route one already-parsed KERI dispatch envelope into the established
 * `Revery` / `Kevery` / `Exchanger` architecture.
 */
export function* dispatchEnvelope(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger?: ExchangerLike,
  vdr: VdrDispatchServices = {},
  mailboxAid?: string | null,
): Operation<ReplyProcessDecision | void> {
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
      if (exchanger) {
        yield* exchanger.processEvent({
          serder,
          tsgs: envelope.tsgs,
          cigars: envelope.cigars,
          ptds: envelope.ptds,
          essr: envelope.essr,
          mailboxAid,
        });
      }
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
            firner: envelope.lastFrc?.f,
            local: envelope.local,
          });
          kevery.processAttachedReceiptQuadruples({
            serder,
            trqs: envelope.trqs,
            firner: envelope.lastFrc?.f,
            local: envelope.local,
          });
          kevery.processAttachedReceiptGroups({
            serder,
            tsgs: envelope.tsgs,
            firner: envelope.lastFrc?.f,
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
    essr: envelope.essr,
    ssts: [...envelope.ssts],
    bsqs: [...envelope.bsqs],
    bsss: [...envelope.bsss],
    tmqs: [...envelope.tmqs],
  };
}

function smellageFromMessage(message: CesrFrame): Smellage {
  return {
    proto: message.body.proto,
    pvrsn: message.body.pvrsn,
    kind: message.body.kind,
    size: message.body.size,
    gvrsn: message.body.gvrsn,
  };
}

/** Require the primitive role promised by the parser graph at the public frame boundary. */
function primitive<T>(entry: GroupEntry | undefined, Type: new(...args: any[]) => T): T {
  if (!(entry instanceof Type)) throw new TypeError(`Expected parsed ${Type.name}`);
  return entry;
}

/** Read a nested signature list without decoding its bytes again. */
function signatureTuple(entry: GroupEntry | undefined): Siger[] {
  if (!entry || !isGroupTuple(entry)) throw new TypeError("Expected signature tuple");
  return entry.map((item) => primitive(item, Siger));
}

/** Collect already hydrated attachment values into the runtime envelope. */
function collectAttachments(group: AttachmentGroup, envelope: KeriDispatchEnvelope): void {
  switch (group.name) {
    case "AttachmentGroup":
    case "BigAttachmentGroup":
    case "BodyWithAttachmentGroup":
    case "BigBodyWithAttachmentGroup":
      for (const item of group.items) {
        if (isCounterGroupLike(item)) collectAttachments(item, envelope);
      }
      return;
    case "ControllerIdxSigs":
    case "BigControllerIdxSigs":
    case "WitnessIdxSigs":
    case "BigWitnessIdxSigs": {
      const target = group.name.includes("Witness") ? envelope.wigers : envelope.sigers;
      for (const item of group.items) {
        target.push(...(isGroupTuple(item) ? signatureTuple(item) : [primitive(item, Siger)]));
      }
      return;
    }
    case "NonTransReceiptCouples":
    case "BigNonTransReceiptCouples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 2) throw new TypeError("Expected receipt couple");
        const verfer = primitive(item[0], Verfer);
        const cigar = primitive(item[1], Cigar);
        // Attach verifier context from the couple; copying a Matter instance does not decode bytes.
        envelope.cigars.push(new Cigar(cigar, verfer));
      }
      return;
    // Historical protocol v1 receipt tuples remain valid; v2 -N means nonce seals.
    case "TransReceiptQuadruples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 4) throw new TypeError("Expected TransReceiptQuadruples tuple");
        envelope.trqs.push(TransReceiptQuadruple.fromTuple([
          primitive(item[0], Prefixer),
          primitive(item[1], NumberPrimitive),
          primitive(item[2], Diger),
          primitive(item[3], Siger),
        ]));
      }
      return;
    case "TransIdxSigGroups":
    case "BigTransIdxSigGroups":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 4) throw new TypeError("Expected TransIdxSigGroups tuple");
        envelope.tsgs.push(TransIdxSigGroup.fromTuple([
          primitive(item[0], Prefixer),
          primitive(item[1], NumberPrimitive),
          primitive(item[2], Diger),
          signatureTuple(item[3]),
        ]));
      }
      return;
    case "TransLastIdxSigGroups":
    case "BigTransLastIdxSigGroups":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 2) throw new TypeError("Expected TransLastIdxSigGroups tuple");
        envelope.ssgs.push(TransLastIdxSigGroup.fromTuple([
          primitive(item[0], Prefixer),
          signatureTuple(item[1]),
        ]));
      }
      return;
    case "FirstSeenReplayCouples":
    case "BigFirstSeenReplayCouples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 2) throw new TypeError("Expected FirstSeenReplayCouples tuple");
        envelope.frcs.push(FirstSeen.fromTuple([
          primitive(item[0], NumberPrimitive),
          primitive(item[1], Dater),
        ]));
      }
      return;
    case "SealSourceCouples":
    case "BigSealSourceCouples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 2) throw new TypeError("Expected SealSourceCouples tuple");
        envelope.sscs.push(SealSource.fromTuple([
          primitive(item[0], NumberPrimitive),
          primitive(item[1], Diger),
        ]));
      }
      return;
    case "SealSourceTriples":
    case "BigSealSourceTriples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 3) throw new TypeError("Expected SealSourceTriples tuple");
        envelope.ssts.push(SealEvent.fromTuple([
          primitive(item[0], Prefixer),
          primitive(item[1], NumberPrimitive),
          primitive(item[2], Diger),
        ]));
      }
      return;
    case "TypedDigestSealCouples":
    case "BigTypedDigestSealCouples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 2) throw new TypeError("Expected TypedDigestSealCouples tuple");
        envelope.tdcs.push(SealKind.fromTuple([
          primitive(item[0], Verser),
          primitive(item[1], Noncer),
        ]));
      }
      return;
    case "BlindedStateQuadruples":
    case "BigBlindedStateQuadruples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 4) throw new TypeError("Expected BlindedStateQuadruples tuple");
        envelope.bsqs.push(BlindState.fromTuple([
          new Noncer(primitive(item[0], Diger)),
          primitive(item[1], Noncer),
          primitive(item[2], Noncer),
          primitive(item[3], Labeler),
        ]));
      }
      return;
    case "BoundStateSextuples":
    case "BigBoundStateSextuples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 6) throw new TypeError("Expected BoundStateSextuples tuple");
        envelope.bsss.push(BoundState.fromTuple([
          new Noncer(primitive(item[0], Diger)),
          primitive(item[1], Noncer),
          primitive(item[2], Noncer),
          primitive(item[3], Labeler),
          primitive(item[4], NumberPrimitive),
          primitive(item[5], Noncer),
        ]));
      }
      return;
    case "TypedMediaQuadruples":
    case "BigTypedMediaQuadruples":
      for (const item of group.items) {
        if (!isGroupTuple(item) || item.length !== 4) throw new TypeError("Expected TypedMediaQuadruples tuple");
        envelope.tmqs.push(TypeMedia.fromTuple([
          new Noncer(primitive(item[0], Diger)),
          primitive(item[1], Noncer),
          primitive(item[2], Labeler),
          primitive(item[3], Texter),
        ]));
      }
      return;
    case "PathedMaterialCouples":
    case "BigPathedMaterialCouples":
      envelope.ptds.push(PathedMaterialGroup.fromRaw(group.raw));
      return;
    default:
      return;
  }
}

/** Project one complete frame for progressive routing without an intermediate event array. */
export function envelopeFromFrame(
  message: CesrFrame,
  local = false,
): KeriDispatchEnvelope {
  const serder = (message.body instanceof SerderKERI || message.body instanceof SerderACDC)
    ? message.body as SerderKERI
    : parseSerder(message.body.raw, smellageFromMessage(message)) as SerderKERI;
  const envelope = new KeriDispatchEnvelope({
    serder,
    attachmentGroups: message.attachments,
    essr: message.essr,
    local,
  });
  for (const group of message.attachments) {
    collectAttachments(group, envelope);
  }
  return envelope;
}

/** Normalize the actual query endorsements for ingress and per-request authorization. */
export function queryEnvelopeFromDispatch(
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
