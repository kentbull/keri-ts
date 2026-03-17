import type {
  Cigar,
  Dater,
  Diger,
  Labeler,
  Noncer,
  NumberPrimitive,
  Prefixer,
  Siger,
  Texter,
  Verfer,
  Verser,
} from "../../../cesr/mod.ts";

/**
 * Latest establishment-event projection embedded inside a key-state record.
 *
 * KERIpy correspondence:
 * - mirrors `StateEERecord` from `keri.recording`
 *
 * This sub-record captures the latest establishment event referenced by the
 * current key state, including witness/backer cuts and adds.
 */
export interface StateEERecord {
  s?: string;
  d?: string;
  br?: string[];
  ba?: string[];
}

/**
 * Current key-state record for one identifier prefix.
 *
 * KERIpy correspondence:
 * - mirrors `KeyStateRecord` from `keri.recording`
 *
 * Stored in `Baser.states` / `stts.` and used as the durable source of truth
 * for current local habitat state. `Hab.kever` is reconstructed from this
 * record rather than treated as independently authoritative state.
 */
export interface KeyStateRecord {
  vn?: number[];
  i?: string;
  s?: string;
  p?: string;
  d?: string;
  f?: string;
  dt?: string;
  et?: string;
  kt?: string;
  k?: string[];
  nt?: string;
  n?: string[];
  bt?: string;
  b?: string[];
  c?: string[];
  ee?: StateEERecord;
  di?: string;
}

/**
 * Tracks whether a stored event originated from a local/protected source.
 *
 * KERIpy correspondence:
 * - mirrors `EventSourceRecord` from `keri.recording`
 *
 * Used in `Baser.esrs` to distinguish locally protected events from remote
 * events that may still require stronger validation/authentication treatment.
 */
export interface EventSourceRecord {
  local?: boolean;
}

/**
 * Habitat application metadata keyed by habitat identifier prefix.
 *
 * KERIpy correspondence:
 * - mirrors `HabitatRecord` from `keri.recording`
 *
 * This record is intentionally metadata-only. Durable event/key state belongs
 * in `states.`/`kels.`/`fels.` and signatures belong in separate DB families.
 */
export interface HabitatRecord {
  hid: string;
  name?: string;
  domain?: string;
  mid?: string;
  smids?: string[];
  rmids?: string[];
  sid?: string;
  watchers?: string[];
}

/**
 * Witness-mailbox topic cursor record.
 *
 * KERIpy correspondence:
 * - mirrors `TopicsRecord` from `keri.recording`
 *
 * Used in `Baser.tops` to track last-seen per-topic indices for witness mailbox
 * retrieval flows.
 */
export interface TopicsRecord {
  topics: Record<string, number>;
}

/**
 * Minimal OOBI tracking record.
 *
 * KERIpy correspondence:
 * - mirrors `OobiRecord` from `keri.recording`
 *
 * Shared by the active, escrowed, resolved, MFA, and related OOBI stores.
 */
export interface OobiRecord {
  oobialias?: string | null;
  said?: string | null;
  cid?: string | null;
  eid?: string | null;
  role?: string | null;
  date?: string | null;
  state?: string | null;
  urls?: string[] | null;
}

/**
 * Endpoint authorization/enablement record.
 *
 * KERIpy correspondence:
 * - mirrors `EndpointRecord` from `keri.recording`
 *
 * Stored in `Baser.ends` for `(cid, role, eid)` paths and populated from
 * reply/expose message processing when those higher-layer flows are ported.
 */
export interface EndpointRecord {
  allowed?: boolean | null;
  enabled?: boolean | null;
  name?: string;
}

/**
 * Embedded endpoint-authorization cross-reference record.
 *
 * KERIpy correspondence:
 * - mirrors `EndAuthRecord` from `keri.recording`
 */
export interface EndAuthRecord {
  cid?: string;
  roles?: string[];
}

/**
 * Service-endpoint location record keyed by `(eid, scheme)`.
 *
 * KERIpy correspondence:
 * - mirrors `LocationRecord` from `keri.recording`
 */
export interface LocationRecord {
  url: string;
}

/**
 * Watcher-observed identifier record.
 *
 * KERIpy correspondence:
 * - mirrors `ObservedRecord` from `keri.recording`
 *
 * Stored in `Baser.obvs` for `(cid, aid, oid)` paths.
 */
export interface ObservedRecord {
  enabled?: boolean | null;
  name?: string;
  datetime?: string | null;
}

/**
 * KRAM cache policy parameters for one cache-type expression.
 *
 * KERIpy correspondence:
 * - mirrors `CacheTypeRecord` from `keri.recording`
 */
export interface CacheTypeRecord {
  d?: number;
  sl?: number;
  ll?: number;
  xl?: number;
  psl?: number;
  pll?: number;
  pxl?: number;
}

/**
 * KRAM message-cache entry keyed by `(AID, MID)`.
 *
 * KERIpy correspondence:
 * - mirrors `MsgCacheRecord` from `keri.recording`
 */
export interface MsgCacheRecord {
  mdt?: string;
  d?: number;
  ml?: number;
  pml?: number;
  xl?: number;
  pxl?: number;
}

/**
 * KRAM transactioned message-cache entry keyed by `(AID, XID, MID)`.
 *
 * KERIpy correspondence:
 * - mirrors `TxnMsgCacheRecord` from `keri.recording`
 */
export interface TxnMsgCacheRecord {
  mdt?: string;
  xdt?: string;
  d?: number;
  ml?: number;
  pml?: number;
  xl?: number;
  pxl?: number;
}

/**
 * Successfully resolved `.well-known` OOBI record.
 *
 * KERIpy correspondence:
 * - mirrors `WellKnownAuthN` from `keri.recording`
 *
 * Stored through `IoSetKomer` in `Baser.wkas`.
 */
export interface WellKnownAuthN {
  url: string;
  dt: string;
}

/** Authorizing/source event seal tuple used by `aess.`, `udes.`, and related escrows. */
export type EventSealTuple = [NumberPrimitive, Diger];
/** Non-transferable receipt couple stored in `rcts.`. */
export type ReceiptCouple = [Prefixer, Cigar];
/** Unverified non-transferable receipt triple stored in `ures.`. */
export type UnverifiedReceiptTriple = [Diger, Prefixer, Cigar];
/** Transferable validator receipt quadruple stored in `vrcs.`, `trqs.`, and `tsgs.`. */
export type ValidatorReceiptQuadruple = [Prefixer, NumberPrimitive, Diger, Siger];
/** Escrowed transferable validator receipt quintuple stored in `vres.`. */
export type EscrowedValidatorReceiptQuintuple = [
  Diger,
  Prefixer,
  NumberPrimitive,
  Diger,
  Siger,
];
/** Group-signify member tuple used by `Keeper.smids` and `Keeper.rmids`. */
export type GroupMemberTuple = [Prefixer, NumberPrimitive];
/** Source-seal triple stored in `ssts.`. */
export type SourceSealTriple = [Prefixer, NumberPrimitive, Diger];
/** First-seen replay couple stored in `frcs.`. */
export type FirstSeenReplayCouple = [NumberPrimitive, Dater];
/** Typed-digest seal couple stored in `tdcs.`. */
export type TypedDigestSealCouple = [Verser, Diger];
/** Transferable/non-indexed signature couple stored in `scgs.` and `ecigs.`. */
export type TransferableSignatureCouple = [Verfer, Cigar];
/** Type-media quadruple stored in `tmqs.`. */
export type TypeMediaQuadruple = [Diger, Noncer, Labeler, Texter];
/** Blind-state quadruple stored in `bsqs.`. */
export type BoundStateQuadruple = [Diger, Noncer, Noncer, Labeler];
/** Bound-state sextuple stored in `bsss.`. */
export type BoundStateSextuple = [
  Diger,
  Noncer,
  Noncer,
  Labeler,
  NumberPrimitive,
  Noncer,
];
/** Blinded-image/media tuple stored in `imgs.` and `iimgs.`. */
export type BlindedImageTuple = [Noncer, Noncer, Labeler, Texter];
