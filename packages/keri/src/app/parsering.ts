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
  requireFlatFrame,
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
import type { KeverDecision, QueryProcessDecision } from "../core/kever-decisions.ts";
import { type KramReceipt, kramReceipt, type KramRefusal } from "../core/kraming.ts";
import { supportsNestedExchange } from "../core/protocol-exchanging.ts";
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
    /** Receipt-time unresolved foreign last references are not current proof. */
    unresolvedLast?: readonly Prefixer[];
    /** Source and last-establishment factors retain their own proof ownership. */
    sscs?: readonly SealSource[];
    sourceSeals?: readonly SealEvent[];
    lsgs?: readonly TransLastIdxSigGroup[];
    /** Reopenable payload views owned by the dispatch caller. */
    essr?: EssrPayload;
    /** Borrowed parent-owned descendants for a supported route. */
    nests?: readonly CesrFrame[];
    /** Hosted endpoint that received this message, independent of its claimed sender. */
    mailboxAid?: string | null;
    /** Scoped receiver authority; never a timestamp supplied by signed wire. */
    receipt?: KramReceipt;
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
  /** TEL query owner; built-in replay is supported while TSN remains explicitly refused. */
  processQuery?(args: QueryEnvelope): void | MessageDropDecision;
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

/** A normal refusal before route processing; a parsed message is not accepted. */
export interface MessageDropDecision {
  kind: "drop";
  reason:
    | "deniedSender"
    | "senderNotAllowed"
    | "missingAuthentication"
    | "unsupportedRoute"
    | "invalidQuery"
    | "missingProcessor"
    | "referenceStub";
}

/** Route-specific results remain distinct from pre-dispatch refusal and unreported outcomes. */
export type DispatchDecision =
  | KeverDecision
  | QueryProcessDecision
  | ReplyProcessDecision
  | ExchangeDecision
  | MessageDropDecision
  | KramRefusal
  | void;

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
 * The optional ready consumer is scoped to v2 non-event dispatch; other messages
 * remain caller-consumed. No hydrated evidence is returned with the decision.
 */
export function* dispatchEnvelope(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger?: ExchangerLike,
  vdr: VdrDispatchServices = {},
  mailboxAid?: string | null,
  consume?: (ready: KeriDispatchEnvelope, decision: DispatchDecision) => Operation<void>,
): Operation<DispatchDecision> {
  const serder = envelope.serder as SerderKERI | SerderACDC;
  if (serder instanceof SerderACDC) {
    if (serder.ilk === null) {
      vdr.vry?.processACDC?.(acdcEnvelopeFromDispatch(envelope, serder));
    }
    return;
  }

  if (
    serder.pvrsn.major >= 2
    && [Ilks.qry, Ilks.rpy, Ilks.exn, Ilks.xip, Ilks.pro, Ilks.bar].some((ilk) => ilk === serder.ilk)
  ) {
    return yield* dispatchMessage(envelope, revery, kevery, exchanger, vdr, mailboxAid, consume);
  }

  switch (serder.ilk) {
    case Ilks.rpy:
      return revery.processReply({
        serder,
        cigars: envelope.cigars,
        tsgs: envelope.tsgs,
      });
    case Ilks.qry:
      if (["tels", "tsn"].includes(serder.route ?? "")) {
        return dispatchTelQuery(queryEnvelopeFromDispatch(envelope), vdr);
      }
      return kevery.processQuery(queryEnvelopeFromDispatch(envelope));
    case Ilks.rct:
      kevery.processReceipt(envelope);
      break;
    case Ilks.exn:
      // Frozen legacy intake requires a signature group even though the EXN kernel accepts source seals.
      if (serder.pvrsn.major === 1 && !envelope.tsgs.length && !envelope.cigars.length) break;
      if (exchanger) {
        return yield* dispatchExchange(envelope, exchanger, mailboxAid);
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
    case Ilks.ixn: {
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
      return decision;
    }
    default:
      break;
  }
}

/**
 * Frozen processMsg boundary: sender policy precedes optional KRAM and proof
 * prerequisites and delegation. Downstream processors authenticate their own
 * evidence; this layer borrows the envelope and never owns its payloads.
 */
function* dispatchMessage(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger: ExchangerLike | undefined,
  vdr: VdrDispatchServices,
  mailboxAid?: string | null,
  consume?: (ready: KeriDispatchEnvelope, decision: DispatchDecision) => Operation<void>,
): Operation<DispatchDecision> {
  const serder = envelope.serder;
  const sender = serder.pre;
  if (sender !== null) {
    if (kevery.denyList.has(sender)) return { kind: "drop", reason: "deniedSender" };
    if (kevery.allowList.size && !kevery.allowList.has(sender)) return { kind: "drop", reason: "senderNotAllowed" };
  }
  let decision: DispatchDecision = undefined;
  const dispatch = function*(ready: KeriDispatchEnvelope): Operation<void> {
    decision = yield* dispatchReadyMessage(ready, revery, kevery, exchanger, vdr, mailboxAid);
    if (consume) yield* consume(ready, decision);
  };
  const refusal = kevery.kramer ? yield* kevery.kramer.intake(envelope, dispatch) : yield* dispatch(envelope);
  return refusal ?? decision;
}

/** Delegate inside the ready callback; downstream processors verify their own proof owners. */
function* dispatchReadyMessage(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger: ExchangerLike | undefined,
  vdr: VdrDispatchServices,
  mailboxAid?: string | null,
): Operation<DispatchDecision> {
  const serder = envelope.serder;
  switch (serder.ilk) {
    case Ilks.qry: {
      const query = queryEnvelopeFromDispatch(envelope);
      if (!query.source && !query.cigars?.length) return { kind: "drop", reason: "missingAuthentication" };
      if (["logs", "ksn", "mbx"].includes(serder.route ?? "")) return kevery.processQuery(query);
      if (serder.route === "tels" || serder.route === "tsn") {
        return dispatchTelQuery(query, vdr);
      }
      return { kind: "drop", reason: "unsupportedRoute" };
    }
    case Ilks.rpy:
      if (!envelope.cigars.length && !envelope.tsgs.length) return { kind: "drop", reason: "missingAuthentication" };
      return revery.processReply({ serder, cigars: envelope.cigars, tsgs: envelope.tsgs });
    case Ilks.exn:
      if (!envelope.cigars.length && !envelope.tsgs.length && !envelope.sscs.length && !envelope.ssts.length) {
        return { kind: "drop", reason: "missingAuthentication" };
      }
      if (!exchanger) return { kind: "drop", reason: "missingProcessor" };
      return yield* dispatchExchange(envelope, exchanger, mailboxAid);
    default:
      // processXip/processPro/processBar are pass stubs at the frozen reference.
      return { kind: "drop", reason: "referenceStub" };
  }
}

/** Both body versions preserve requester prerequisites and the TEL owner's typed refusal. */
function dispatchTelQuery(query: QueryEnvelope, vdr: VdrDispatchServices): void | MessageDropDecision {
  if (!query.source && !query.cigars?.length) return { kind: "drop", reason: "missingAuthentication" };
  if (!vdr.tvy?.processQuery) return { kind: "drop", reason: "missingProcessor" };
  return vdr.tvy.processQuery(query);
}

/** Await the route owner while preserving parent, child and mailbox provenance. */
function* dispatchExchange(
  envelope: KeriDispatchEnvelope,
  exchanger: ExchangerLike,
  mailboxAid?: string | null,
): Operation<void | ExchangeDecision> {
  return yield* exchanger.processEvent({
    serder: envelope.serder,
    tsgs: envelope.tsgs,
    sscs: envelope.sscs,
    sourceSeals: envelope.ssts,
    lsgs: envelope.ssgs,
    unresolvedLast: envelope.unresolvedLast,
    cigars: envelope.cigars,
    ptds: envelope.ptds,
    essr: envelope.essr,
    nests: envelope.nests,
    mailboxAid,
    receipt: kramReceipt(envelope),
  });
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
  // Only completed consumers may retain parent-owned children through normalization.
  const route = String(message.body.ked?.r ?? "");
  if (
    message.body.ilk !== "exn" || !supportsNestedExchange(route, message.body.pvrsn.major)
  ) {
    requireFlatFrame(message, "KERI runtime normalization");
  }
  const serder = (message.body instanceof SerderKERI || message.body instanceof SerderACDC)
    ? message.body as SerderKERI
    : parseSerder(message.body.raw, smellageFromMessage(message)) as SerderKERI;
  const envelope = new KeriDispatchEnvelope({
    serder,
    attachmentGroups: message.attachments,
    essr: message.essr,
    nests: message.nests,
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
  // V2 processMsg falls back to the claimed sender only when raw sigers exist.
  const rawSource = !lastSsg && envelope.serder.pvrsn.major >= 2 && envelope.sigers.length && envelope.serder.pre
    ? new Prefixer({ qb64: envelope.serder.pre })
    : undefined;
  return {
    serder: envelope.serder,
    source: lastSsg?.prefixer ?? rawSource,
    sigers: lastSsg ? [...lastSsg.sigers] : rawSource ? [...envelope.sigers] : [],
    cigars: [...envelope.cigars],
  };
}
