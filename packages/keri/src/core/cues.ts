import type { Dater, SealEvent, SerderACDC, SerderKERI, Siger } from "cesr-ts";
import type { DispatchOrdinal } from "./dispatch.ts";
import type { MbxTopicCursor } from "./mailbox-topics.ts";
import type { KeyStateRecord, RegStateRecord, VcStateRecord } from "./records.ts";

/** Shared `kin` discriminator carried by all cue payloads. */
export interface CueBase {
  /** Discriminator used by the exclusive cue consumer to select handling. */
  kin: string;
}

/** Cue requesting receipt-generation work for one accepted event. */
export interface ReceiptCue extends CueBase {
  /** Discriminator used by the exclusive cue consumer to select handling. */
  kin: "receipt";
  /** Accepted event body whose receipt is constructed by the interpreting Hab. */
  serder: SerderKERI;
}

/** Cue carrying one notice-style follow-on message for later dissemination. */
export interface NoticeCue extends CueBase {
  kin: "notice";
  serder: SerderKERI;
}

/** Cue requesting witness-oriented follow-on work for one event. */
export interface WitnessCue extends CueBase {
  /** Discriminator used by the exclusive cue consumer to select handling. */
  kin: "witness";
  /** Accepted event body requiring witness receipt/publication handling. */
  serder: SerderKERI;
}

/** KEL wire filters; the target lives in the cue/request envelope. */
export type KelQueryFields = {
  /** Optional lowercase hexadecimal first-seen ordinal at which replay starts. */
  fn?: string;
  /** Optional hexadecimal sequence-number selector. */
  s?: string;
  /** Optional event-seal SAD to locate an anchoring event; nested fields remain borrowed immutable data. */
  a?: ReturnType<typeof SealEvent.toSad>;
};

/** Concrete built-in outbound query routes, correlated with their actual bodies. */
export type QueryInstruction =
  | {
    /** Built-in route selecting the corresponding query-body shape. */
    route: "logs";
    /** Route-specific wire filters; the subject AID is supplied separately by QueryRequest. */
    q: KelQueryFields;
  }
  | {
    /** Built-in route selecting the corresponding query-body shape. */
    route: "ksn";
    /** Route-specific wire filters; the subject AID is supplied separately by QueryRequest. */
    q: Pick<KelQueryFields, "fn" | "s"> & {
      /** Forbidden for ksn requests; anchor search belongs to logs. */
      a?: never;
    };
  }
  | {
    /** Built-in route selecting the corresponding query-body shape. */
    route: "tels" | "tsn";
    /** Route-specific wire filters; the subject AID is supplied separately by QueryRequest. */
    q: Pick<TelQueryCue["q"], "ri" | "i">;
  };

/** Deferred query work names its local signer and remote attester; it never borrows a Hab. */
export type QueryRequest = QueryInstruction & {
  /** Subject AID whose state is requested. */
  pre: string;
  /** Explicit local signer; unavailable means unresolved, without fallback. */
  signer?: string;
  /** Remote attester receiving the query, not the local signer. */
  src?: string;
  /** Ordered witness/attester overrides; copied when the request is queued. */
  wits?: string[];
};

/** Routed query work or an unresolved schema/credential-recovery notice, matching KERIpy cue records. */
export type QueryCue =
  | ({
    /** Discriminator used by the exclusive cue consumer to select handling. */
    kin: "query";
  } & QueryRequest)
  | {
    /** Discriminator used by the exclusive cue consumer to select handling. */
    kin: "query";
    /** Unavailable on recovery notices; a notice is not a routable subject request. */
    pre?: never;
    /** Unavailable on recovery notices; correspondence does not invent a signer. */
    signer?: never;
    /** Unavailable on recovery notices; no remote attester is selected here. */
    src?: never;
    /** Unavailable on recovery notices; q.r is a recovery hint, not a delivery route. */
    route?: never;
    /** Unavailable on recovery notices; no endpoint selection is requested. */
    wits?: never;
    /** Schema/credential recovery hint retained as an observation, not sent by QueryCoordinator. */
    q: {
      /** Recovery family; unlike routed queries this names the hint within q. */
      r: "schema";
      /** Schema SAID whose definition is missing. */
      said: string;
    } | {
      /** Recovery family; unlike routed queries this names the hint within q. */
      r: "tels";
      /** Credential/subject prefix named by the TEL recovery hint. */
      pre: string;
    };
  };

/** Cue carrying a reopenable replay of bounded complete messages back to the host or transport layer. */
export interface ReplayCue extends CueBase {
  /** Query SAID that requested this response, including deferred escrow results. */
  querySaid?: string;
  /**
   * Selects replay handling in the cue router.
   */
  kin: "replay";
  /**
   * Reopenable bounded local replay. Respondant materializes the complete sequence before Poster admission; request-owned readers may consume it lazily.
   */
  msgs: Iterable<Uint8Array>;
  /**
   * Subject AID whose local history is being replayed, when supplied.
   */
  pre?: string;
  /**
   * Local attester/sender AID for reply production, when supplied.
   */
  src?: string;
  /**
   * Remote requester AID for outbound delivery, when supplied.
   */
  dest?: string;
}

/** Reply bodies already prepared by KEL processing, or concrete TSN state awaiting its local attester.
 * KSN uses its serder's authoritative route; TSN state is serialized only at Hab interpretation.
 */
export type ReplyCue =
  & {
    /** Discriminator used by the exclusive cue consumer to select handling. */
    kin: "reply";
    /** Query SAID that requested this response, including deferred escrow results. */
    querySaid?: string;
    /** Optional local attester AID for selecting the producing Hab. */
    src?: string;
    /** Requester AID; required for lazy TSN construction and optional for a prepared reply. */
    dest?: string;
  }
  & (
    | {
      /** Prepared reply body for KEL output; absent on the mutually exclusive lazy TSN variants. */
      serder: SerderKERI;
      /** TSN route awaiting the local attester suffix; forbidden when the prepared serder already owns its route. */
      route?: never;
      /** Required registry or credential state for lazy TSN serialization; forbidden for prepared serder replies. */
      data?: never;
    }
    | {
      /** TSN route awaiting the local attester suffix; forbidden when the prepared serder already owns its route. */
      route: "/tsn/registry";
      /** Required registry or credential state for lazy TSN serialization; forbidden for prepared serder replies. */
      data: Required<RegStateRecord>;
      /** Prepared reply body for KEL output; absent on the mutually exclusive lazy TSN variants. */
      serder?: never;
      /** Requester AID; required for lazy TSN construction and optional for a prepared reply. */
      dest: string;
    }
    | {
      /** TSN route awaiting the local attester suffix; forbidden when the prepared serder already owns its route. */
      route: "/tsn/credential";
      /** Required registry or credential state for lazy TSN serialization; forbidden for prepared serder replies. */
      data: Required<VcStateRecord>;
      /** Prepared reply body for KEL output; absent on the mutually exclusive lazy TSN variants. */
      serder?: never;
      /** Requester AID; required for lazy TSN construction and optional for a prepared reply. */
      dest: string;
    }
  );

/** Cue carrying one streaming publication request plus its topic metadata. */
export interface StreamCue extends CueBase {
  /** Discriminator used by the exclusive cue consumer to select handling. */
  kin: "stream";
  /** Signed mailbox query body whose SAID provides response correlation. */
  serder: SerderKERI;
  /** Mailbox subject AID whose stored messages are selected. */
  pre: string;
  /** Queried attester/provider AID copied from q.src; requester authorization comes from the signed query evidence. */
  src: string;
  /** Topic names mapped to inclusive next-wanted mailbox ordinals. */
  topics: MbxTopicCursor;
}

/**
 * Cue emitted when runtime `Kevery` persists a new key-state record.
 *
 * This is primarily a continuation signal for `QueryCoordinator`, not a direct
 * wire cue.
 */
export interface KeyStateSavedCue extends CueBase {
  /** Discriminator used by the exclusive cue consumer to select handling. */
  kin: "keyStateSaved";
  /** Accepted key-state notice used to advance query continuations. */
  ksn: KeyStateRecord;
}

/** Cue emitted after a registry or credential transaction-state notice is saved. */
export interface TransactionStateSavedCue extends CueBase {
  kin: "txnStateSaved";
  record: RegStateRecord | VcStateRecord;
}

/** Cue requesting TEL replay or transaction-state lookup work. */
export interface TelQueryCue extends CueBase {
  /** Discriminator used by the exclusive cue consumer to select handling. */
  kin: "telquery";
  /** Registry/credential recovery target; issuer is supplied when the registry itself is unknown. */
  q: {
    /** Registry identifier whose transaction state is needed. */
    ri: string;
    /** Credential SAID whose transaction history is needed. */
    i: string;
    /** Optional issuer AID supplied when the registry is unknown. */
    issr?: string;
  };
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
