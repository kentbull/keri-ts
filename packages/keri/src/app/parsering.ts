import {
  type AttachmentGroup,
  BlindState,
  BoundState,
  type CesrFrame,
  Cigar,
  Dater,
  Diger,
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
  type Versionage,
} from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { RegistryObserver, RegistryObserverDecision } from "../acdc/observing.ts";
import {
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransLastIdxSigGroup,
  TransReceiptQuadruple,
} from "../core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../core/eventing.ts";
import type { KeverDecision, QueryProcessDecision } from "../core/kever-decisions.ts";
import { type KramRefusal } from "../core/kraming.ts";
import { supportsNestedExchange } from "../core/protocol-exchanging.ts";
import { type ReplyProcessDecision, Revery } from "../core/routing.ts";
import type { TelProcessDecision, Tevery } from "../vdr/eventing.ts";
import type { ExchangeDecision } from "./exchanging.ts";
import type { Verifier, VerifierDecision } from "./verifying.ts";

/** Exchange admission may await durable payload storage before dispatch advances. */
export interface ExchangerLike {
  /** Resolve after signature admission and its required storage/handler effects finish. */
  processEvent(args: {
    serder: SerderKERI;
    tsgs: TransIdxSigGroup[];
    cigars: Cigar[];
    ptds: PathedMaterialGroup[];
    gvrsn?: Versionage;
    /** Receipt-time unresolved foreign last references are not current proof. */
    unresolvedLast?: readonly Prefixer[];
    /** Source and last-establishment factors retain their own proof ownership. */
    sscs?: readonly SealSource[];
    sourceSeals?: readonly SealEvent[];
    lsgs?: readonly TransLastIdxSigGroup[];
    /** Ordered ordinary ESSR fragments. */
    essrs?: readonly Texter[];
    /** Borrowed parent-owned descendants for a supported route. */
    nests?: readonly CesrFrame[];
    /** Hosted endpoint that received this message, independent of its claimed sender. */
    mailboxAid?: string | null;
    /** Receiver-observed time supplied by local intake, independent of signed wire. */
    receiverTime?: string;
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
  /** Ordered ordinary ESSR fragments carried alongside credential attachments. */
  essrs?: readonly Texter[];
  ssts: SealEvent[];
  bsqs: BlindState[];
  bsss: BoundState[];
  tmqs: TypeMedia[];
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
  | TelProcessDecision
  | VerifierDecision
  | RegistryObserverDecision
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
 * - CESR parsing belongs to the buffered finite CESR decoder
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

/** The processed envelope and its exact decision; KRAM may combine earlier proof records. */
export interface DispatchResult {
  envelope: KeriDispatchEnvelope;
  decision: DispatchDecision;
}

/**
 * Route one already-parsed KERI dispatch envelope into the established
 * `Revery` / `Kevery` / `Exchanger` architecture.
 * Return ordinary buffered evidence and its decision to the application owner.
 *
 * @param envelope Parsed body and its exact attachment evidence.
 * @param revery Borrowed reply-route verifier.
 * @param kevery Input KEL processor for this dispatch.
 * @param exchanger Optional exchange processor; absent exchange support remains explicit.
 * @param tevery Optional legacy TEL processor.
 * @param verifier Optional credential processor.
 * @param mailboxAid Receiving hosted endpoint provenance, distinct from claimed sender.
 * @param messageKevery Authoritative shared message-policy/KRAM processor when distinct from input Kevery.
 * @param registry Native registry intake over accepted public KEL state, without requiring a local alias.
 * @returns The processed envelope and protocol-specific decision data.
 * @throws Unsupported input and infrastructure/handler failures follow their owning processor contracts.
 */
export function* dispatchEnvelope(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger?: ExchangerLike,
  tevery?: Tevery,
  verifier?: Verifier,
  mailboxAid?: string | null,
  /** Long-lived v2 message policy/KRAM owner; input-specific Kevery handles KEL and legacy traffic. */
  messageKevery: Kevery = kevery,
  registry?: RegistryObserver,
): Operation<DispatchResult> {
  const serder = envelope.serder as SerderKERI | SerderACDC;
  if (serder instanceof SerderACDC) {
    if (serder.ilk === Ilks.rip || serder.ilk === Ilks.bup) {
      return {
        envelope,
        decision: registry?.processEvent(serder) ?? { kind: "drop", reason: "missingProcessor" },
      };
    }
    return {
      envelope,
      decision: serder.ilk === null ? verifier?.processACDC(acdcEnvelopeFromDispatch(envelope, serder)) : undefined,
    };
  }

  if (
    serder.pvrsn.major >= 2
    && [Ilks.qry, Ilks.rpy, Ilks.exn, Ilks.xip, Ilks.pro, Ilks.bar].some((ilk) => ilk === serder.ilk)
  ) {
    return yield* dispatchMessage(envelope, revery, messageKevery, exchanger, tevery, mailboxAid);
  }

  switch (serder.ilk) {
    case Ilks.rpy:
      return {
        envelope,
        decision: revery.processReply({
          serder,
          cigars: envelope.cigars,
          tsgs: envelope.tsgs,
        }),
      };
    case Ilks.qry:
      if (["tels", "tsn"].includes(serder.route ?? "")) {
        return { envelope, decision: dispatchTelQuery(queryEnvelopeFromDispatch(envelope), tevery) };
      }
      return { envelope, decision: kevery.processQuery(queryEnvelopeFromDispatch(envelope)) };
    case Ilks.rct:
      kevery.processReceipt(envelope);
      break;
    case Ilks.exn:
      // Frozen legacy intake requires a signature group even though the EXN kernel accepts source seals.
      if (serder.pvrsn.major === 1 && !envelope.tsgs.length && !envelope.cigars.length) break;
      if (exchanger) {
        return { envelope, decision: yield* dispatchExchange(envelope, exchanger, mailboxAid) };
      }
      break;
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      return { envelope, decision: tevery?.processEvent(telEnvelopeFromDispatch(envelope, serder)) };
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
      return { envelope, decision };
    }
    default:
      break;
  }
  return { envelope, decision: undefined };
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
  tevery: Tevery | undefined,
  mailboxAid?: string | null,
): Operation<DispatchResult> {
  const serder = envelope.serder;
  const sender = serder.pre;
  if (sender !== null) {
    if (kevery.denyList.has(sender)) return { envelope, decision: { kind: "drop", reason: "deniedSender" } };
    if (kevery.allowList.size && !kevery.allowList.has(sender)) {
      return { envelope, decision: { kind: "drop", reason: "senderNotAllowed" } };
    }
  }
  const result = kevery.kramer?.intake(envelope);
  if (result && result.kind !== "ready") return { envelope, decision: result };
  const ready = result?.envelope ?? envelope;
  const decision = yield* dispatchReadyMessage(
    ready,
    revery,
    kevery,
    exchanger,
    tevery,
    mailboxAid,
    result?.receiverTime,
  );
  return { envelope: ready, decision };
}

/** Delegate accepted evidence; downstream processors verify their own proof owners. */
function* dispatchReadyMessage(
  envelope: KeriDispatchEnvelope,
  revery: Revery,
  kevery: Kevery,
  exchanger: ExchangerLike | undefined,
  tevery: Tevery | undefined,
  mailboxAid?: string | null,
  receiverTime?: string,
): Operation<DispatchDecision> {
  const serder = envelope.serder;
  switch (serder.ilk) {
    case Ilks.qry: {
      const query = queryEnvelopeFromDispatch(envelope);
      if (!query.source && !query.cigars?.length) return { kind: "drop", reason: "missingAuthentication" };
      if (["logs", "ksn", "mbx"].includes(serder.route ?? "")) return kevery.processQuery(query);
      if (serder.route === "tels" || serder.route === "tsn") {
        return dispatchTelQuery(query, tevery);
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
      return yield* dispatchExchange(envelope, exchanger, mailboxAid, receiverTime);
    default:
      // processXip/processPro/processBar are pass stubs at the frozen reference.
      return { kind: "drop", reason: "referenceStub" };
  }
}

/** Both body versions preserve requester prerequisites and the TEL owner's typed refusal. */
function dispatchTelQuery(query: QueryEnvelope, tevery: Tevery | undefined): void | MessageDropDecision {
  if (!query.source && !query.cigars?.length) return { kind: "drop", reason: "missingAuthentication" };
  if (!tevery) return { kind: "drop", reason: "missingProcessor" };
  return tevery.processQuery(query);
}

/** Await the route owner while preserving parent, child and mailbox provenance. */
function* dispatchExchange(
  envelope: KeriDispatchEnvelope,
  exchanger: ExchangerLike,
  mailboxAid?: string | null,
  receiverTime?: string,
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
    essrs: envelope.essrs,
    gvrsn: envelope.gvrsn,
    nests: envelope.nests,
    mailboxAid,
    receiverTime,
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
    essrs: envelope.essrs,
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

/** Project one complete frame for message routing without an intermediate event array. */
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
    essrs: message.essrs,
    gvrsn: message.gvrsn,
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
