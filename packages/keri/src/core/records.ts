import { encode as encodeMsgpack } from "@msgpack/msgpack";
import {
  type Cigar,
  type Dater,
  type Diger,
  encodeKeriCbor,
  type Labeler,
  type Noncer,
  type NumberPrimitive,
  type Prefixer,
  type Siger,
  type Texter,
  type ThresholdSith,
  type Verfer,
  type Verser,
} from "../../../cesr/mod.ts";

const textEncoder = new TextEncoder();

function toUint8Array(bytes: Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array
      && Object.getPrototypeOf(bytes) === Uint8Array.prototype
    ? bytes
    : new Uint8Array(bytes);
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeRecordValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof RawRecord) {
    return value.asDict();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRecordValue(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, normalizeRecordValue(item)] as const)
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}

function cloneAssignedValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof RawRecord) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneAssignedValue(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, cloneAssignedValue(item)] as const)
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}

function assignDefined<T extends object>(
  target: T,
  data?: object | null,
): void {
  if (!data) {
    return;
  }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }
    Reflect.set(target, key, cloneAssignedValue(value));
  }
}

/** Constructor contract used by `Komer` hydrators for `RawRecord` families. */
export interface RawRecordCtor<TRecord extends RawRecord, TInput = unknown> {
  new(data?: TInput): TRecord;
  fromDict(data?: unknown): TRecord;
}

/**
 * Shared persisted-record helper base.
 *
 * KERIpy correspondence:
 * - mirrors `RawRecord` from `keri.recording`
 *
 * `keri-ts` difference:
 * - keeps current stored-shape stability by preserving omitted fields rather
 *   than eagerly materializing every KERIpy dataclass default into JSON
 */
export abstract class RawRecord {
  constructor(data?: object | null) {
    assignDefined(this, data);
  }

  /**
   * Hydrate one record instance from a plain stored object.
   *
   * Subclasses that carry nested record members should override this to
   * rehydrate those nested values explicitly.
   */
  static fromDict<TRecord extends RawRecord>(
    this: RawRecordCtor<TRecord, any>,
    data?: unknown,
  ): TRecord {
    if (data instanceof this) {
      return data;
    }
    return new this(data);
  }

  /** KERIpy-style underscore alias retained for parity-oriented call sites. */
  static _fromdict<TRecord extends RawRecord>(
    this: RawRecordCtor<TRecord, any>,
    data?: unknown,
  ): TRecord {
    return this.fromDict(data);
  }

  /** Iterate plain-record keys, matching KERIpy `__iter__` substance. */
  *[Symbol.iterator](): IterableIterator<string> {
    yield* Object.keys(this.asDict());
  }

  /** Return the plain stored-object projection for this record. */
  asDict(): Record<string, unknown> {
    return normalizeRecordValue(Object.fromEntries(Object.entries(this))) as Record<string, unknown>;
  }

  /** KERIpy-style underscore alias retained for parity-oriented call sites. */
  _asdict(): Record<string, unknown> {
    return this.asDict();
  }

  /** Return UTF-8 JSON bytes for this record. */
  asJSON(): Uint8Array {
    return textEncoder.encode(JSON.stringify(this.asDict()));
  }

  /** KERIpy-style underscore alias retained for parity-oriented call sites. */
  _asjson(): Uint8Array {
    return this.asJSON();
  }

  /** Return KERI-compatible CBOR bytes for this record. */
  asCBOR(): Uint8Array {
    return encodeKeriCbor(this.asDict());
  }

  /** KERIpy-style underscore alias retained for parity-oriented call sites. */
  _ascbor(): Uint8Array {
    return this.asCBOR();
  }

  /** Return MessagePack bytes for this record. */
  asMGPK(): Uint8Array {
    return toUint8Array(encodeMsgpack(this.asDict()));
  }

  /** KERIpy-style underscore alias retained for parity-oriented call sites. */
  _asmgpk(): Uint8Array {
    return this.asMGPK();
  }
}

export interface StateEERecordShape {
  s?: string;
  d?: string;
  br?: string[];
  ba?: string[];
}

/**
 * Latest establishment-event projection embedded inside a key-state record.
 *
 * KERIpy correspondence:
 * - mirrors `StateEERecord` from `keri.recording`
 *
 * This sub-record captures the latest establishment event referenced by the
 * current key state, including witness/backer cuts and adds.
 */
export class StateEERecord extends RawRecord implements StateEERecordShape {
  declare s?: string;
  declare d?: string;
  declare br?: string[];
  declare ba?: string[];

  constructor(data: StateEERecordShape = {}) {
    super();
    assignDefined(this, {
      ...data,
      br: data.br ? [...data.br] : data.br,
      ba: data.ba ? [...data.ba] : data.ba,
    });
  }
}

export interface KeyStateRecordShape {
  vn?: number[];
  i?: string;
  s?: string;
  p?: string;
  d?: string;
  f?: string;
  dt?: string;
  et?: string;
  kt?: ThresholdSith;
  k?: string[];
  nt?: ThresholdSith;
  n?: string[];
  bt?: string;
  b?: string[];
  c?: string[];
  ee?: StateEERecordShape;
  di?: string;
}

/**
 * Current key-state record for one identifier prefix.
 *
 * KERIpy correspondence:
 * - mirrors `KeyStateRecord` from `keri.recording`
 *
 * Stored in `Baser.states` / `stts.` and used as the durable source of truth
 * for accepted current key state. Live `Kever` instances are reloaded from
 * this record rather than treating in-memory habitat wrappers as authoritative.
 */
export class KeyStateRecord extends RawRecord implements KeyStateRecordShape {
  declare vn?: number[];
  declare i?: string;
  declare s?: string;
  declare p?: string;
  declare d?: string;
  declare f?: string;
  declare dt?: string;
  declare et?: string;
  declare kt?: ThresholdSith;
  declare k?: string[];
  declare nt?: ThresholdSith;
  declare n?: string[];
  declare bt?: string;
  declare b?: string[];
  declare c?: string[];
  declare ee?: StateEERecord;
  declare di?: string;

  constructor(data: KeyStateRecordShape = {}) {
    super();
    assignDefined(this, {
      ...data,
      vn: data.vn ? [...data.vn] : data.vn,
      k: data.k ? [...data.k] : data.k,
      n: data.n ? [...data.n] : data.n,
      b: data.b ? [...data.b] : data.b,
      c: data.c ? [...data.c] : data.c,
      ee: data.ee ? StateEERecord.fromDict(data.ee) : data.ee,
    });
  }
}

export interface EventSourceRecordShape {
  local?: boolean;
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
export class EventSourceRecord extends RawRecord implements EventSourceRecordShape {
  declare local?: boolean;
}

export interface HabitatRecordShape {
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
 * Habitat application metadata keyed by habitat identifier prefix.
 *
 * KERIpy correspondence:
 * - mirrors `HabitatRecord` from `keri.recording`
 *
 * This record is intentionally metadata-only. Durable event/key state belongs
 * in `states.`/`kels.`/`fels.` and signatures belong in separate DB families.
 */
export class HabitatRecord extends RawRecord implements HabitatRecordShape {
  declare hid: string;
  declare name?: string;
  declare domain?: string;
  declare mid?: string;
  declare smids?: string[];
  declare rmids?: string[];
  declare sid?: string;
  declare watchers?: string[];

  constructor(data?: HabitatRecordShape) {
    super();
    assignDefined(this, {
      ...data,
      smids: data?.smids ? [...data.smids] : data?.smids,
      rmids: data?.rmids ? [...data.rmids] : data?.rmids,
      watchers: data?.watchers ? [...data.watchers] : data?.watchers,
    });
  }
}

export interface TopicsRecordShape {
  topics: Record<string, number>;
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
export class TopicsRecord extends RawRecord implements TopicsRecordShape {
  declare topics: Record<string, number>;
}

export interface OobiQueryRecordShape {
  cid?: string | null;
  role?: string | null;
  eids?: string[];
  scheme?: string | null;
}

/**
 * Constraint record for responding to OOBI endpoint queries.
 *
 * KERIpy correspondence:
 * - mirrors `OobiQueryRecord` from `keri.recording`
 *
 * Current `keri-ts` difference:
 * - the record contract is ported, but `Baser` does not yet bind an `oobiq`
 *   store because current KERIpy does not actively wire that family either
 */
export class OobiQueryRecord extends RawRecord implements OobiQueryRecordShape {
  declare cid?: string | null;
  declare role?: string | null;
  declare eids?: string[];
  declare scheme?: string | null;

  constructor(data: OobiQueryRecordShape = {}) {
    super();
    assignDefined(this, {
      ...data,
      eids: data.eids ? [...data.eids] : data.eids,
    });
  }
}

export interface OobiRecordShape {
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
 * Minimal OOBI tracking record.
 *
 * KERIpy correspondence:
 * - mirrors `OobiRecord` from `keri.recording`
 *
 * Shared by the active, escrowed, resolved, MFA, and related OOBI stores.
 */
export class OobiRecord extends RawRecord implements OobiRecordShape {
  declare oobialias?: string | null;
  declare said?: string | null;
  declare cid?: string | null;
  declare eid?: string | null;
  declare role?: string | null;
  declare date?: string | null;
  declare state?: string | null;
  declare urls?: string[] | null;

  constructor(data: OobiRecordShape = {}) {
    super();
    assignDefined(this, {
      ...data,
      urls: data.urls ? [...data.urls] : data.urls,
    });
  }
}

export interface EndpointRecordShape {
  allowed?: boolean | null;
  enabled?: boolean | null;
  name?: string;
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
export class EndpointRecord extends RawRecord implements EndpointRecordShape {
  declare allowed?: boolean | null;
  declare enabled?: boolean | null;
  declare name?: string;
}

export interface EndAuthRecordShape {
  cid?: string;
  roles?: string[];
}

/**
 * Embedded endpoint-authorization cross-reference record.
 *
 * KERIpy correspondence:
 * - mirrors `EndAuthRecord` from `keri.recording`
 */
export class EndAuthRecord extends RawRecord implements EndAuthRecordShape {
  declare cid?: string;
  declare roles?: string[];

  constructor(data: EndAuthRecordShape = {}) {
    super();
    assignDefined(this, {
      ...data,
      roles: data.roles ? [...data.roles] : data.roles,
    });
  }
}

export interface LocationRecordShape {
  url: string;
}

/**
 * Service-endpoint location record keyed by `(eid, scheme)`.
 *
 * KERIpy correspondence:
 * - mirrors `LocationRecord` from `keri.recording`
 */
export class LocationRecord extends RawRecord implements LocationRecordShape {
  declare url: string;
}

export interface ObservedRecordShape {
  enabled?: boolean | null;
  name?: string;
  datetime?: string | null;
}

/**
 * Watcher-observed identifier record.
 *
 * KERIpy correspondence:
 * - mirrors `ObservedRecord` from `keri.recording`
 *
 * Stored in `Baser.obvs` for `(cid, aid, oid)` paths.
 */
export class ObservedRecord extends RawRecord implements ObservedRecordShape {
  declare enabled?: boolean | null;
  declare name?: string;
  declare datetime?: string | null;
}

export interface CacheTypeRecordShape {
  d?: number;
  sl?: number;
  ll?: number;
  xl?: number;
  psl?: number;
  pll?: number;
  pxl?: number;
}

/**
 * KRAM cache policy parameters for one cache-type expression.
 *
 * KERIpy correspondence:
 * - mirrors `CacheTypeRecord` from `keri.recording`
 */
export class CacheTypeRecord extends RawRecord implements CacheTypeRecordShape {
  declare d?: number;
  declare sl?: number;
  declare ll?: number;
  declare xl?: number;
  declare psl?: number;
  declare pll?: number;
  declare pxl?: number;
}

export interface MsgCacheRecordShape {
  mdt?: string;
  d?: number;
  ml?: number;
  pml?: number;
  xl?: number;
  pxl?: number;
}

/**
 * KRAM message-cache entry keyed by `(AID, MID)`.
 *
 * KERIpy correspondence:
 * - mirrors `MsgCacheRecord` from `keri.recording`
 */
export class MsgCacheRecord extends RawRecord implements MsgCacheRecordShape {
  declare mdt?: string;
  declare d?: number;
  declare ml?: number;
  declare pml?: number;
  declare xl?: number;
  declare pxl?: number;
}

export interface TxnMsgCacheRecordShape {
  mdt?: string;
  xdt?: string;
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
export class TxnMsgCacheRecord extends RawRecord implements TxnMsgCacheRecordShape {
  declare mdt?: string;
  declare xdt?: string;
  declare d?: number;
  declare ml?: number;
  declare pml?: number;
  declare xl?: number;
  declare pxl?: number;
}

export interface WellKnownAuthNShape {
  url: string;
  dt: string;
}

/**
 * Successfully resolved `.well-known` OOBI record.
 *
 * KERIpy correspondence:
 * - mirrors `WellKnownAuthN` from `keri.recording`
 *
 * Stored through `IoSetKomer` in `Baser.wkas`.
 */
export class WellKnownAuthN extends RawRecord implements WellKnownAuthNShape {
  declare url: string;
  declare dt: string;
}

/** Authorizing/source event seal tuple used by `aess.`, `udes.`, and related escrows. */
export type EventSealTuple = [NumberPrimitive, Diger];
/** Non-transferable receipt couple stored in `rcts.`. */
export type ReceiptCouple = [Prefixer, Cigar];
/** Unverified non-transferable receipt triple stored in `ures.`. */
export type UnverifiedReceiptTriple = [Diger, Prefixer, Cigar];
/** Transferable validator receipt quadruple stored in `vrcs.`, `trqs.`, and `tsgs.`. */
export type ValidatorReceiptQuadruple = [
  Prefixer,
  NumberPrimitive,
  Diger,
  Siger,
];
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
/** Verfer+cigar storage couple stored in `scgs.` and `ecigs.`. */
export type VerferCigarCouple = [Verfer, Cigar];
/** Typed-media quadruple stored in `tmqs.`. */
export type TypedMediaQuadrupleTuple = [Diger, Noncer, Labeler, Texter];
/** Blinded-state quadruple stored in `bsqs.`. */
export type BlindedStateQuadrupleTuple = [Diger, Noncer, Noncer, Labeler];
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
