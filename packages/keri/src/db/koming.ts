import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { type Database } from "npm:lmdb@3.5.3";
import { b, decodeKeriCbor, encodeKeriCbor, type Kind, Kinds, t } from "../../../cesr/mod.ts";
import { RawRecord, type RawRecordClass, type RecordInputOf, type RecordShapeOf } from "../core/records.ts";
import { BinKey, BinVal, LMDBer } from "./core/lmdber.ts";

type KeyPart = string | Uint8Array;
type Keys = KeyPart | Iterable<KeyPart>;

/** Serialization kinds supported by `Komer` record payloads. */
export type KomerKind = Extract<Kind, "JSON" | "CBOR" | "MGPK">;

/** Plain stored-object projection returned by `getDict()`. */
export type KomerDictValue<TRecord extends RawRecord<any>> = RecordShapeOf<
  TRecord
>;

/** Shared constructor options for `KomerBase` variants. */
export interface KomerBaseOptions<TRecord extends RawRecord<any>> {
  subkey: string;
  sep?: string;
  kind?: KomerKind;
  dupsort?: boolean;
  recordClass: RawRecordClass<TRecord>;
}

/** Constructor options for non-duplicate `Komer` variants. */
export interface KomerOptions<TRecord extends RawRecord<any>> extends Omit<KomerBaseOptions<TRecord>, "dupsort"> {}

function assertKomerKind(kind: KomerKind): KomerKind {
  if (
    kind !== Kinds.json
    && kind !== Kinds.cbor
    && kind !== Kinds.mgpk
  ) {
    throw new Error(
      `Unsupported Komer serialization kind=${String(kind)}. Expected JSON, CBOR, or MGPK.`,
    );
  }
  return kind;
}

function toUint8Array(bytes: Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array
      && Object.getPrototypeOf(bytes) === Uint8Array.prototype
    ? bytes
    : new Uint8Array(bytes);
}

function asIterable<T>(value: T | Iterable<T> | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (
    Symbol.iterator in Object(value)
    && typeof value !== "string"
    && !(value instanceof Uint8Array)
  ) {
    return [...(value as Iterable<T>)];
  }
  return [value as T];
}

/**
 * Shared keyspace/object-mapper substrate for `Komer` variants.
 *
 * Responsibilities:
 * - open one named LMDB subdb and manage its key separator policy
 * - convert tuple-like keyspace paths to/from stored LMDB keys
 * - select JSON/CBOR/MGPK serializer functions for one record payload shape
 * - hydrate stored payloads through one record class and serialize them back
 * - expose KERIpy-style branch iteration and trim helpers used by subclasses
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.koming.KomerBase`
 *
 * Current `keri-ts` differences:
 * - callers may still write either a record instance or constructor-input
 *   shape, but the public model is the record class rather than arbitrary
 *   hydrator/normalizer hooks
 */
export class KomerBase<TRecord extends RawRecord<any>> {
  static readonly Sep = ".";

  readonly db: LMDBer;
  readonly sdb: Database<BinVal, BinKey>;
  readonly sep: string;
  readonly kind: KomerKind;
  readonly recordClass: RawRecordClass<TRecord>;
  protected readonly _ser: (val: RecordInputOf<TRecord>) => Uint8Array;
  protected readonly _des: (val: Uint8Array | null) => TRecord | null;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = KomerBase.Sep,
      kind = Kinds.json,
      dupsort = false,
      recordClass,
    }: KomerBaseOptions<TRecord>,
  ) {
    this.db = db;
    this.sdb = this.db.openDB(subkey, dupsort);
    this.sep = sep;
    this.kind = assertKomerKind(kind);
    this.recordClass = recordClass;
    this._ser = this._serializer(this.kind);
    this._des = this._deserializer(this.kind);
  }

  /**
   * Converts a key path to one LMDB key, optionally forcing a trailing
   * separator for top-branch scans.
   */
  _tokey(keys: Keys, topive = false): Uint8Array {
    if (typeof keys === "string") {
      return b(keys);
    }
    if (keys instanceof Uint8Array) {
      return keys;
    }

    const parts = [...keys].map((part) => typeof part === "string" ? part : t(part));
    if (topive && parts.at(-1) !== "") {
      parts.push("");
    }
    return b(parts.join(this.sep));
  }

  /** Converts one LMDB key back into its separator-delimited key path. */
  _tokeys(key: Uint8Array): string[] {
    return t(key).split(this.sep);
  }

  /** Materialize one caller-supplied value into the canonical record class. */
  protected coerceRecord(val: RecordInputOf<TRecord>): TRecord {
    return val instanceof this.recordClass
      ? val
      : this.recordClass.fromDict(val);
  }

  /** Project one normalized record into its persisted object representation. */
  protected toStoredValue(val: RecordInputOf<TRecord>): RecordShapeOf<TRecord> {
    return this.coerceRecord(val).asDict() as RecordShapeOf<TRecord>;
  }

  /** Rebuild one caller-facing record from a decoded stored object. */
  protected fromStoredValue(val: unknown): TRecord {
    return this.recordClass.fromDict(val);
  }

  /** Returns the serializer function for the requested storage encoding kind. */
  _serializer(kind: KomerKind): (val: RecordInputOf<TRecord>) => Uint8Array {
    switch (assertKomerKind(kind)) {
      case Kinds.mgpk:
        return this.serializeMGPK.bind(this);
      case Kinds.cbor:
        return this.serializeCBOR.bind(this);
      case Kinds.json:
        return this.serializeJSON.bind(this);
    }
  }

  /** Returns the deserializer function for the requested storage encoding kind. */
  _deserializer(kind: KomerKind): (val: Uint8Array | null) => TRecord | null {
    switch (assertKomerKind(kind)) {
      case Kinds.mgpk:
        return this.deserializeMGPK.bind(this);
      case Kinds.cbor:
        return this.deserializeCBOR.bind(this);
      case Kinds.json:
        return this.deserializeJSON.bind(this);
    }
  }

  /** Encode one logical record as UTF-8 JSON bytes. */
  protected serializeJSON(val: RecordInputOf<TRecord>): Uint8Array {
    return b(JSON.stringify(this.toStoredValue(val)));
  }

  /** Encode one logical record as MGPK/MessagePack bytes. */
  protected serializeMGPK(val: RecordInputOf<TRecord>): Uint8Array {
    return toUint8Array(encodeMsgpack(this.toStoredValue(val)));
  }

  /** Encode one logical record as KERI-compatible CBOR bytes. */
  protected serializeCBOR(val: RecordInputOf<TRecord>): Uint8Array {
    return encodeKeriCbor(this.toStoredValue(val));
  }

  /** Decode one JSON byte payload into the logical record type. */
  protected deserializeJSON(val: Uint8Array | null): TRecord | null {
    if (val === null) {
      return null;
    }
    return this.fromStoredValue(JSON.parse(t(val)));
  }

  /** Decode one MGPK/MessagePack payload into the logical record type. */
  protected deserializeMGPK(val: Uint8Array | null): TRecord | null {
    if (val === null) {
      return null;
    }
    return this.fromStoredValue(decodeMsgpack(val));
  }

  /** Decode one KERI-compatible CBOR payload into the logical record type. */
  protected deserializeCBOR(val: Uint8Array | null): TRecord | null {
    if (val === null) {
      return null;
    }
    return this.fromStoredValue(decodeKeriCbor(val));
  }

  /**
   * Removes every entry whose key starts with the provided branch prefix.
   *
   * This mirrors KERIpy `trim`, including the `topive` flag for forcing a
   * branch separator when the caller passes a partial key path.
   */
  trim(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): boolean {
    return this.db.delTop(this.sdb, this._tokey(keys, topive));
  }

  /** Convenience alias matching the KERIpy API surface. */
  remTop(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): boolean {
    return this.trim(keys, { topive });
  }

  /**
   * Iterates decoded records for one top-branch keyspace prefix.
   *
   * Subclasses that add hidden ordinal suffixes or other key/value transforms
   * should override this method and strip those hidden storage details.
   */
  *getTopItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], TRecord]> {
    for (
      const [key, val] of this.db.getTopItemIter(
        this.sdb,
        this._tokey(keys, topive),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), record];
    }
  }

  /**
   * Returns full stored items for debugging or testing.
   *
   * This is currently identical to `getTopItemIter()` because the single-value
   * `Komer` path has no hidden suffixes or value proems yet.
   */
  *getFullItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], TRecord]> {
    yield* this.getTopItemIter(keys, { topive });
  }
}

/**
 * Single-record keyspace/object mapper for one value per effective key.
 *
 * Responsibilities:
 * - expose the KERIpy `Komer` CRUD/count API for non-duplicate subdbs
 * - keep the active `Baser` and `Keeper` JSON-backed records on the KERIpy
 *   object-mapper path rather than raw LMDB access
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.koming.Komer`
 *
 * Current `keri-ts` differences:
 * - JSON remains the live-store default even though CBOR and MGPK are available
 * - callers may write constructor-input shapes directly, but reads always
 *   return hydrated record instances
 */
export class Komer<TRecord extends RawRecord<any>> extends KomerBase<TRecord> {
  constructor(
    db: LMDBer,
    { subkey, sep = KomerBase.Sep, kind = Kinds.json, ...options }: KomerOptions<TRecord>,
  ) {
    super(db, { subkey, sep, kind, dupsort: false, ...options });
  }

  /** Insert one record value at its effective key if absent. */
  put(keys: Keys, val: RecordInputOf<TRecord>): boolean {
    return this.db.putVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Upsert one record value at its effective key. */
  pin(keys: Keys, val: RecordInputOf<TRecord>): boolean {
    return this.db.setVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Read one record value by its effective key. */
  get(keys: Keys): TRecord | null {
    return this._des(this.db.getVal(this.sdb, this._tokey(keys)));
  }

  /**
   * Return the plain stored-object shape for one record.
   *
   * This mirrors KERIpy `getDict` for persisted record shapes even when reads
   * normally hydrate into richer record instances.
   */
  getDict(keys: Keys): KomerDictValue<TRecord> | null {
    const val = this.get(keys);
    if (val === null) {
      return null;
    }
    return val.asDict() as KomerDictValue<TRecord>;
  }

  /** Remove one record value by its effective key. */
  rem(keys: Keys): boolean {
    return this.db.delVal(this.sdb, this._tokey(keys));
  }

  /** Count all stored records in this `Komer` subdb. */
  cnt(): number {
    return this.db.cntAll(this.sdb);
  }

  /** Alias matching the normalized KERIpy counting surface. */
  cntAll(): number {
    return this.cnt();
  }
}

/**
 * Insertion-ordered set mapper for record payloads (`IoSetKomer`).
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.koming.IoSetKomer`
 */
export class IoSetKomer<TRecord extends RawRecord<any>> extends KomerBase<TRecord> {
  constructor(
    db: LMDBer,
    { subkey, sep = KomerBase.Sep, kind = Kinds.json, ...options }: KomerOptions<TRecord>,
  ) {
    super(db, { subkey, sep, kind, dupsort: false, ...options });
  }

  /**
   * Insert an insertion-ordered set of records for one effective key if absent.
   *
   * Each logical member becomes its own physical key through the `IoSet*`
   * storage model; duplicate values are deduplicated by the underlying LMDB
   * helper family.
   */
  put(
    keys: Keys,
    vals: RecordInputOf<TRecord> | Iterable<RecordInputOf<TRecord>> | null = null,
  ): boolean {
    return this.db.putIoSetVals(
      this.sdb,
      this._tokey(keys),
      asIterable(vals).map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Upsert an insertion-ordered set of records for one effective key. */
  pin(
    keys: Keys,
    vals: RecordInputOf<TRecord> | Iterable<RecordInputOf<TRecord>> | null = null,
  ): boolean {
    return this.db.pinIoSetVals(
      this.sdb,
      this._tokey(keys),
      asIterable(vals).map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Append one record member to the insertion-ordered set for an effective key. */
  add(keys: Keys, val: RecordInputOf<TRecord>): boolean {
    return this.db.addIoSetVal(
      this.sdb,
      this._tokey(keys),
      this._ser(val),
      b(this.sep),
    );
  }

  /** Read all logical members for one effective key in insertion order. */
  get(keys: Keys, { ion = 0 }: { ion?: number } = {}): TRecord[] {
    const out: TRecord[] = [];
    for (
      const [, val] of this.db.getIoSetItemIter(
        this.sdb,
        this._tokey(keys),
        ion,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record !== null) {
        out.push(record);
      }
    }
    return out;
  }

  /** Read the last logical member for one effective key. */
  getLast(keys: Keys): TRecord | null {
    const item = this.db.getIoSetLastItem(
      this.sdb,
      this._tokey(keys),
      b(this.sep),
    );
    if (item === null) {
      return null;
    }
    return this._des(item[1]);
  }

  /** Iterate logical members for one effective key in insertion order. */
  *getIter(keys: Keys): Generator<TRecord> {
    for (
      const [, val] of this.db.getIoSetItemIter(
        this.sdb,
        this._tokey(keys),
        0,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Remove one member, or all members when `val` is `null`, for an effective key. */
  rem(keys: Keys, val: RecordInputOf<TRecord> | null = null): boolean {
    return this.db.remIoSetVal(
      this.sdb,
      this._tokey(keys),
      val === null ? null : this._ser(val),
      b(this.sep),
    );
  }

  /** Count stored members for one effective key or the whole subdb. */
  cnt(keys: Keys = "", { ion = 0 }: { ion?: number } = {}): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return this.db.cntAll(this.sdb);
    }
    return this.db.cntIoSet(this.sdb, this._tokey(keys), ion, b(this.sep));
  }

  /** Iterate branch members while hiding the synthetic insertion-order suffix. */
  override *getTopItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], TRecord]> {
    for (
      const [key, val] of this.db.getTopIoSetItemIter(
        this.sdb,
        this._tokey(keys, topive),
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record !== null) {
        yield [this._tokeys(key), record];
      }
    }
  }
}

/**
 * Native duplicate-key object mapper (`DupKomer`).
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.koming.DupKomer`
 *
 * Ordering rule:
 * - duplicates are kept in LMDB duplicate-sort order, not insertion order
 * - values must remain under LMDB's dupsort value-size limits
 */
export class DupKomer<TRecord extends RawRecord<any>> extends KomerBase<TRecord> {
  constructor(
    db: LMDBer,
    { subkey, sep = KomerBase.Sep, kind = Kinds.json, ...options }: KomerOptions<TRecord>,
  ) {
    super(db, { subkey, sep, kind, dupsort: true, ...options });
  }

  /** Insert duplicate members at one effective key without overwriting existing values. */
  put(
    keys: Keys,
    vals: RecordInputOf<TRecord> | Iterable<RecordInputOf<TRecord>> | null = null,
  ): boolean {
    return this.db.putVals(
      this.sdb,
      this._tokey(keys),
      asIterable(vals).map((val) => this._ser(val)),
    );
  }

  /** Add one duplicate member if that exact stored value is absent. */
  add(keys: Keys, val: RecordInputOf<TRecord>): boolean {
    return this.db.addVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Replace the full duplicate set for one effective key. */
  pin(
    keys: Keys,
    vals: RecordInputOf<TRecord> | Iterable<RecordInputOf<TRecord>> | null = null,
  ): boolean {
    const key = this._tokey(keys);
    this.db.delVals(this.sdb, key);
    return this.db.putVals(
      this.sdb,
      key,
      asIterable(vals).map((val) => this._ser(val)),
    );
  }

  /** Read all duplicate members for one effective key. */
  get(keys: Keys): TRecord[] {
    const out: TRecord[] = [];
    for (const val of this.db.getValsIter(this.sdb, this._tokey(keys))) {
      const record = this._des(val);
      if (record !== null) {
        out.push(record);
      }
    }
    return out;
  }

  /** Read the lexicographically last duplicate member for one effective key. */
  getLast(keys: Keys): TRecord | null {
    return this._des(this.db.getValLast(this.sdb, this._tokey(keys)));
  }

  /** Iterate duplicate members at one effective key in LMDB duplicate order. */
  *getIter(keys: Keys): Generator<TRecord> {
    for (const val of this.db.getValsIter(this.sdb, this._tokey(keys))) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Count duplicate members at one effective key or across the whole subdb. */
  cnt(keys: Keys = ""): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return this.db.cntAll(this.sdb);
    }
    return this.db.cntVals(this.sdb, this._tokey(keys));
  }

  /** Remove one duplicate member, or the entire duplicate set when `val` is `null`. */
  rem(keys: Keys, val: RecordInputOf<TRecord> | null = null): boolean {
    const key = this._tokey(keys);
    if (val === null) {
      return this.db.delVals(this.sdb, key);
    }
    return this.db.delVal(this.sdb, key, this._ser(val));
  }
}
