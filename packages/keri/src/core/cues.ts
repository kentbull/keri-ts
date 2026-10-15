import type { Dater, SealEvent, SerderACDC, SerderKERI, Siger } from "cesr-ts";
import type { DispatchOrdinal } from "./dispatch.ts";
import type { MbxTopicCursor } from "./mailbox-topics.ts";
import type { KeyStateRecord, RegStateRecord, VcStateRecord } from "./records.ts";

/** Shared `kin` discriminator carried by all cue payloads. */
export interface CueBase {
  kin: string;
}

/** Cue requesting receipt-generation work for one accepted event. */
export interface ReceiptCue extends CueBase {
  kin: "receipt";
  serder: SerderKERI;
}

/** Cue carrying one notice-style follow-on message for later dissemination. */
export interface NoticeCue extends CueBase {
  kin: "notice";
  serder: SerderKERI;
}

/** Cue requesting witness-oriented follow-on work for one event. */
export interface WitnessCue extends CueBase {
  kin: "witness";
  serder: SerderKERI;
}

/** KEL wire filters; the target lives in the cue/request envelope. */
export type KelQueryFields = {
  fn?: string;
  s?: string;
  a?: ReturnType<typeof SealEvent.toSad>;
};

/** Concrete built-in outbound query routes, correlated with their actual bodies. */
export type QueryInstruction =
  | { route: "logs"; q: KelQueryFields }
  | { route: "ksn"; q: Pick<KelQueryFields, "fn" | "s"> & { a?: never } }
  | { route: "tels" | "tsn"; q: Pick<TelQueryCue["q"], "ri" | "i"> };

/** Deferred query work names its local signer and remote attester; it never borrows a Hab. */
export type QueryRequest = QueryInstruction & {
  pre: string;
  signer?: string;
  src?: string;
  wits?: string[];
};

/** Routed query work or an unresolved schema/credential-recovery notice, matching KERIpy cue records. */
export type QueryCue =
  | ({ kin: "query" } & QueryRequest)
  | {
    kin: "query";
    pre?: never;
    signer?: never;
    src?: never;
    route?: never;
    wits?: never;
    q: { r: "schema"; said: string } | { r: "tels"; pre: string };
  };

/** Cue carrying a reopenable replay of bounded complete messages back to the host or transport layer. */
export interface ReplayCue extends CueBase {
  /** Query SAID that requested this response, including deferred escrow results. */
  querySaid?: string;
  kin: "replay";
  /** Reiterating reopens the captured replay extent without collecting its event bytes. */
  messages: Iterable<Uint8Array>;
  pre?: string;
  src?: string;
  dest?: string;
}

/** Reply bodies already prepared by KEL processing, or concrete TSN state awaiting its local attester.
 * KSN uses its serder's authoritative route; TSN state is serialized only at Hab interpretation.
 */
export type ReplyCue =
  & {
    kin: "reply";
    /** Query SAID that requested this response, including deferred escrow results. */
    querySaid?: string;
    src?: string;
    dest?: string;
  }
  & (
    | { serder: SerderKERI; route?: never; data?: never }
    | { route: "/tsn/registry"; data: Required<RegStateRecord>; serder?: never; dest: string }
    | { route: "/tsn/credential"; data: Required<VcStateRecord>; serder?: never; dest: string }
  );

/** Cue carrying one streaming publication request plus its topic metadata. */
export interface StreamCue extends CueBase {
  kin: "stream";
  serder: SerderKERI;
  pre: string;
  src: string;
  topics: MbxTopicCursor;
}

/**
 * Cue emitted when runtime `Kevery` persists a new key-state record.
 *
 * This is primarily a continuation signal for `QueryCoordinator`, not a direct
 * wire cue.
 */
export interface KeyStateSavedCue extends CueBase {
  kin: "keyStateSaved";
  ksn: KeyStateRecord;
}

/** Cue emitted after a registry or credential transaction-state notice is saved. */
export interface TransactionStateSavedCue extends CueBase {
  kin: "txnStateSaved";
  record: RegStateRecord | VcStateRecord;
}

/** Cue requesting TEL replay or transaction-state lookup work. */
export interface TelQueryCue extends CueBase {
  kin: "telquery";
  /** Registry/credential recovery target; issuer is supplied when the registry itself is unknown. */
  q: { ri: string; i: string; issr?: string };
}

/** Cue emitted when a TEL revoke event is accepted. */
export interface CredentialRevokedCue extends CueBase {
  kin: "revoked";
  serder: SerderKERI;
}

/** Cue requesting source-credential proof recovery for a chained credential. */
export interface ProofCue extends CueBase {
  kin: "proof";
  said: string;
}

/** Cue emitted when the verifier saves one credential. */
export interface CredentialSavedCue extends CueBase {
  kin: "saved";
  creder: SerderACDC;
}

/** Cue notifying that a cloned event replay used the wrong first-seen ordinal. */
export interface NoticeBadCloneFNCue extends CueBase {
  kin: "noticeBadCloneFN";
  serder: SerderKERI;
  fn: number;
  firner: DispatchOrdinal;
  dater: Dater;
}

/** Cue notifying that one inbound query or routed message was invalid. */
export interface InvalidCue extends CueBase {
  kin: "invalid";
  serder: SerderKERI;
  reason?: string;
}

/** Cue reserved for future partial-signature escrow recovery flows. */
export interface PartialSigUnescrowCue extends CueBase {
  kin: "psUnescrow";
  serder: SerderKERI;
  sigers?: Siger[];
}

/**
 * Cue emitted when a remote event included locally membered signatures.
 *
 * KERIpy uses this as a diagnostic/security signal when remote events try to
 * satisfy threshold with signatures from keys that belong to a local group.
 */
export interface RemoteMemberedSigCue extends CueBase {
  kin: "remoteMemberedSig";
  serder: SerderKERI;
  index: number;
}

/** Cue emitted when an OOBI URL is accepted into the local resolution queue. */
export interface OobiQueuedCue extends CueBase {
  kin: "oobiQueued";
  url: string;
  alias?: string;
}

/** Cue emitted after one OOBI resolves through fetch, parse, and routing. */
export interface OobiResolvedCue extends CueBase {
  kin: "oobiResolved";
  url: string;
  cid?: string;
  role?: string;
  eid?: string;
}

/** Cue emitted when one OOBI fetch attempt fails before resolution. */
export interface OobiFailedCue extends CueBase {
  kin: "oobiFailed";
  url: string;
  reason: string;
}

/** Output category used by the runtime cue-delivery seam. */
export type CueEmissionKind = "wire" | "notify" | "transport";

/**
 * Structured cue interpretation result consumed by runtime hosts.
 *
 * `keri-ts` keeps the originating cue attached to any emitted wire messages so
 * command-local and long-lived hosts can observe KERI semantics without having
 * to reverse-engineer them back from raw bytes.
 */
export interface CueEmission {
  cue: AgentCue;
  /** Reopenable bounded messages; each iterator owns at most its current message. */
  messages: Iterable<Uint8Array>;
  kind: CueEmissionKind;
}

/**
 * Gate E runtime cue union.
 *
 * Maintainer rule:
 * - keep this union `kin`-first and cue-by-cue portable so KERIpy maintainers
 *   can map producers and consumers without re-deriving a new mental model
 */
export type AgentCue =
  | ReceiptCue
  | NoticeCue
  | WitnessCue
  | QueryCue
  | ReplayCue
  | ReplyCue
  | StreamCue
  | KeyStateSavedCue
  | TransactionStateSavedCue
  | TelQueryCue
  | CredentialRevokedCue
  | ProofCue
  | CredentialSavedCue
  | NoticeBadCloneFNCue
  | InvalidCue
  | PartialSigUnescrowCue
  | RemoteMemberedSigCue
  | OobiQueuedCue
  | OobiResolvedCue
  | OobiFailedCue;
