import type { Dater, Diger, SerderKERI, Siger } from "../../../cesr/mod.ts";
import type { AgentCue } from "./cues.ts";
import type {
  FirstSeenReplayCouple,
  SourceSealCouple,
  SourceSealTriple,
} from "./dispatch.ts";
import type { KeyStateRecord } from "./records.ts";

/** Escrow bucket names used by typed KEL validation decisions. */
export type EscrowKind =
  | "ooo"
  | "partialSigs"
  | "partialWigs"
  | "partialDels"
  | "delegables"
  | "duplicitous"
  | "misfit"
  | "queryNotFound";

/** Duplicate acceptance categories that remain non-fatal to processing. */
export type DuplicateKind = "sameSaid" | "lateAttachments";

/** Rejection categories for events that are invalid rather than repairable. */
export type RejectKind =
  | "invalidPre"
  | "invalidIlk"
  | "invalidSn"
  | "invalidPriorDigest"
  | "invalidThreshold"
  | "invalidWitnessSet"
  | "invalidWitnessThreshold"
  | "nontransferableViolation"
  | "estOnlyViolation"
  | "invalidRecovery"
  | "delegationPolicyViolation"
  | "invalidDelegation"
  | "unsupported"
  | "stale";

/** Durable event/log material shared by accept, duplicate, and escrow flows. */
export interface KELEventState {
  serder: SerderKERI;
  sigers: readonly Siger[];
  wigers: readonly Siger[];
  wits?: readonly string[];
  first?: boolean;
  frc?: FirstSeenReplayCouple | null;
  sourceSeal?: SourceSealCouple | SourceSealTriple | null;
  local: boolean;
}

/** Validated attachment result reused by event-acceptance plans. */
export interface VerifiedAttachments {
  sigers: readonly Siger[];
  wigers: readonly Siger[];
  wits: readonly string[];
  delpre?: string | null;
  sourceSeal?: SourceSealCouple | SourceSealTriple | null;
  cues?: readonly AgentCue[];
}

/** Accepted-state transition assembled during non-mutating event evaluation. */
export interface KeverTransition {
  mode: "create" | "update";
  acceptKind: "inception" | "update" | "recovery";
  pre: string;
  said: string;
  sn: number;
  state: KeyStateRecord;
  log: KELEventState;
}

/** Idempotent logging plan used when duplicates arrive with late attachments. */
export interface DuplicateLogPlan extends KELEventState {}

/** Escrow instruction produced by typed validation decisions. */
export interface EscrowInstruction {
  escrow: EscrowKind;
  pre: string;
  said: string;
  sn: number;
  log: KELEventState;
  existingEscrow?: EscrowKind;
}

/** Attachment validation variant for verified material. */
export interface AttachmentVerified {
  kind: "verified";
  attachments: VerifiedAttachments;
}

/** Attachment validation variant for repairable escrow outcomes. */
export interface AttachmentEscrow {
  kind: "escrow";
  reason: EscrowKind;
  message: string;
  instruction: EscrowInstruction;
  cues?: readonly AgentCue[];
  context?: Record<string, unknown>;
}

/** Attachment validation variant for terminal rejection outcomes. */
export interface AttachmentReject {
  kind: "reject";
  code: RejectKind;
  message: string;
  context?: Record<string, unknown>;
}

/** Result of attachment validation prior to full event-state acceptance. */
export type AttachmentDecision =
  | AttachmentVerified
  | AttachmentEscrow
  | AttachmentReject;

/** Top-level kever decision variant for accepted transitions. */
export interface KeverAccept {
  kind: "accept";
  transition: KeverTransition;
  cues?: readonly AgentCue[];
}

/** Top-level kever decision variant for duplicate events. */
export interface KeverDuplicate {
  kind: "duplicate";
  duplicate: DuplicateKind;
  log?: DuplicateLogPlan;
  cues?: readonly AgentCue[];
}

/** Top-level kever decision variant for escrow outcomes. */
export interface KeverEscrow {
  kind: "escrow";
  reason: EscrowKind;
  message: string;
  instruction: EscrowInstruction;
  cues?: readonly AgentCue[];
  context?: Record<string, unknown>;
}

/** Top-level kever decision variant for terminal rejection outcomes. */
export interface KeverReject {
  kind: "reject";
  code: RejectKind;
  message: string;
  context?: Record<string, unknown>;
}

/** Top-level typed outcome returned by `Kevery.processEvent()`. */
export type KeverDecision =
  | KeverAccept
  | KeverDuplicate
  | KeverEscrow
  | KeverReject;

/** Recoverable escrow-processing reasons that keep one escrow row in place for a later pass. */
export type EscrowKeepReason =
  | "missingReceiptedEvent"
  | "missingReceiptorEstablishment"
  | "queryNotFound"
  | "unverifiedReply"
  | "recoverableError";

/** Terminal escrow-processing reasons that drop one escrow row on this pass. */
export type EscrowDropReason =
  | "missingDater"
  | "stale"
  | "invalidWitnessSet"
  | "invalidWitnessIndex"
  | "invalidReceiptSignature"
  | "invalidReceiptDigest"
  | "invalidReceiptorSeal"
  | "invalidReceiptorEstablishment"
  | "missingEscrowArtifact"
  | "malformedEscrowedQuery"
  | "malformedEscrowedReply"
  | "processingError"
  | "outerCorruption";

/** Escrow-processing variant for one escrow row that has now been successfully applied. */
export interface EscrowAccept {
  kind: "accept";
}

/** Escrow-processing variant for one escrow row that should remain in escrow. */
export interface EscrowKeep {
  kind: "keep";
  reason: EscrowKeepReason;
}

/** Escrow-processing variant for one escrow row that should be removed. */
export interface EscrowDrop {
  kind: "drop";
  reason: EscrowDropReason;
}

/** Typed result of processing one escrow row on one pass. */
export type EscrowProcessDecision =
  | EscrowAccept
  | EscrowKeep
  | EscrowDrop;

/** Builder for one successfully applied escrow row. */
export function acceptEscrow(): EscrowAccept {
  return { kind: "accept" };
}

/** Builder for one recoverable miss that should remain escrowed. */
export function keepEscrow(
  reason: EscrowKeepReason,
): EscrowKeep {
  return { kind: "keep", reason };
}

/** Builder for one terminal outcome that should remove the escrow row. */
export function dropEscrow(
  reason: EscrowDropReason,
): EscrowDrop {
  return { kind: "drop", reason };
}

/** Recoverable live-receipt outcomes that require escrowing attached material. */
export type ReceiptEscrowReason =
  | "missingReceiptedEvent"
  | "missingReceiptorEstablishment";

/** Terminal live-receipt outcomes that mirror KERIpy's dropped `ValidationError` paths. */
export type ReceiptDropReason =
  | "staleReceipt"
  | "ownTransferableReceiptorConflict"
  | "invalidReceiptorSeal"
  | "invalidReceiptorEstablishment"
  | "invalidReceiptorIndex";

/** Live-receipt outcome for successfully applied receipt material. */
export interface ReceiptAccept {
  kind: "accept";
}

/** Live-receipt outcome for receipt material that should be ignored but not escrowed or dropped. */
export interface ReceiptIgnore {
  kind: "ignore";
}

/** Live-receipt outcome for material that should be escrowed for a later pass. */
export interface ReceiptEscrow {
  kind: "escrow";
  reason: ReceiptEscrowReason;
}

/** Live-receipt outcome for terminal invalid receipt material. */
export interface ReceiptDrop {
  kind: "drop";
  reason: ReceiptDropReason;
}

/** Typed result of processing one live receipt branch or attachment group. */
export type ReceiptProcessDecision =
  | ReceiptAccept
  | ReceiptIgnore
  | ReceiptEscrow
  | ReceiptDrop;

/** Builder for live receipt material that was successfully applied. */
export function acceptReceipt(): ReceiptAccept {
  return { kind: "accept" };
}

/** Builder for one live receipt branch that should be ignored. */
export function ignoreReceipt(): ReceiptIgnore {
  return { kind: "ignore" };
}

/** Builder for one live receipt branch that must be escrowed. */
export function escrowReceipt(
  reason: ReceiptEscrowReason,
): ReceiptEscrow {
  return { kind: "escrow", reason };
}

/** Builder for one terminal live receipt outcome that should be dropped. */
export function dropReceipt(
  reason: ReceiptDropReason,
): ReceiptDrop {
  return { kind: "drop", reason };
}

/** Recoverable live-query outcomes that require query-not-found escrow. */
export type QueryEscrowReason =
  | "missingKever"
  | "missingAnchor"
  | "unmetSequenceGate"
  | "notFullyWitnessed";

/** Terminal live-query outcomes that mirror KERIpy parser-dropped validation errors. */
export type QueryDropReason =
  | "malformedQuery"
  | "missingRequesterSignatureMaterial"
  | "invalidLogsGate"
  | "unsupportedRoute";

/** Live-query outcome for successfully handled query material. */
export interface QueryAccept {
  kind: "accept";
  cues?: readonly AgentCue[];
}

/** Live-query outcome for material that should be escrowed for a later pass. */
export interface QueryEscrow {
  kind: "escrow";
  reason: QueryEscrowReason;
}

/** Live-query outcome for terminal invalid query material. */
export interface QueryDrop {
  kind: "drop";
  reason: QueryDropReason;
}

/** Typed result of processing one live query message. */
export type QueryProcessDecision =
  | QueryAccept
  | QueryEscrow
  | QueryDrop;

/** Builder for one successfully handled live query. */
export function acceptQuery(cues?: readonly AgentCue[]): QueryAccept {
  return cues && cues.length > 0
    ? { kind: "accept", cues }
    : { kind: "accept" };
}

/** Builder for one live query that should be escrowed. */
export function escrowQuery(reason: QueryEscrowReason): QueryEscrow {
  return { kind: "escrow", reason };
}

/** Builder for one live query that should be dropped. */
export function dropQuery(reason: QueryDropReason): QueryDrop {
  return { kind: "drop", reason };
}

/** Finalized log result returned after accepted-event persistence. */
export interface KeverLogResult {
  fn: number | null;
  dater: Dater;
}
