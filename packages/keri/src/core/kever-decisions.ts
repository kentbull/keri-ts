import type { Dater, Diger, SerderKERI, Siger } from "../../../cesr/mod.ts";
import type { AgentCue } from "./cues.ts";
import type { FirstSeenReplayCouple, SourceSealCouple, SourceSealTriple } from "./dispatch.ts";
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

/** Finalized log result returned after accepted-event persistence. */
export interface KeverLogResult {
  fn: number | null;
  dater: Dater;
}
