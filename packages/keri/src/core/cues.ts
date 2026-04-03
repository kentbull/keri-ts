import type { Dater, SerderKERI, Siger } from "../../../cesr/mod.ts";
import type { DispatchOrdinal } from "./dispatch.ts";
import type { KeyStateRecord } from "./records.ts";

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

/**
 * Cue requesting one key-state or route-specific query.
 *
 * Gate E uses this primarily from `Revery` when reply verification is blocked
 * on missing signer establishment state.
 */
export interface QueryCue extends CueBase {
  kin: "query";
  pre?: string;
  src?: string;
  route?: string;
  query?: Record<string, unknown>;
  q?: Record<string, unknown>;
  dest?: string;
}

/** Cue carrying a prebuilt replay byte stream back to the host or transport layer. */
export interface ReplayCue extends CueBase {
  kin: "replay";
  msgs: Uint8Array;
  pre?: string;
  src?: string;
  dest?: string;
}

/**
 * Cue requesting that one local reply message be emitted.
 *
 * KERIpy producers sometimes hand back route/data pairs and sometimes a
 * prebuilt reply serder. `keri-ts` keeps both forms so later `/ksn` parity
 * does not need another cue-shape migration.
 */
export interface ReplyCue extends CueBase {
  kin: "reply";
  route: string;
  data?: Record<string, unknown>;
  serder?: SerderKERI;
  src?: string;
  dest?: string;
}

/** Cue carrying one streaming publication request plus its topic metadata. */
export interface StreamCue extends CueBase {
  kin: "stream";
  serder: SerderKERI;
  pre: string;
  src: string;
  topics: Record<string, number>;
}

/** Cue emitted when bootstrap `Kevery` persists a new key-state record. */
export interface KeyStateSavedCue extends CueBase {
  kin: "keyStateSaved";
  ksn: KeyStateRecord;
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
  msgs: Uint8Array[];
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
  | NoticeBadCloneFNCue
  | InvalidCue
  | PartialSigUnescrowCue
  | RemoteMemberedSigCue
  | OobiQueuedCue
  | OobiResolvedCue
  | OobiFailedCue;
