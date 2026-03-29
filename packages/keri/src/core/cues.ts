import type { Siger, SerderKERI } from "../../../cesr/mod.ts";
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
  q?: Record<string, unknown>;
}

/** Cue carrying a prebuilt replay byte stream back to the host or transport layer. */
export interface ReplayCue extends CueBase {
  kin: "replay";
  msgs: Uint8Array;
}

/** Cue requesting that one new local reply message be built and emitted. */
export interface ReplyCue extends CueBase {
  kin: "reply";
  route: string;
  data: Record<string, unknown>;
}

/** Cue carrying one streaming publication request plus its topic metadata. */
export interface StreamCue extends CueBase {
  kin: "stream";
  serder: SerderKERI;
  pre: string;
  src: string;
  topics: string[];
}

/** Cue emitted when bootstrap `Kevery` persists a new key-state record. */
export interface KeyStateSavedCue extends CueBase {
  kin: "keyStateSaved";
  ksn: KeyStateRecord;
}

/** Cue reserved for future partial-signature escrow recovery flows. */
export interface PartialSigUnescrowCue extends CueBase {
  kin: "psUnescrow";
  serder: SerderKERI;
  sigers?: Siger[];
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
  | PartialSigUnescrowCue
  | OobiQueuedCue
  | OobiResolvedCue
  | OobiFailedCue;
