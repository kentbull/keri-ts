import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { type Database } from "npm:lmdb@3.5.2";
import { b, decodeKeriCbor, encodeKeriCbor, type Kind, Kinds, t } from "../../../cesr/mod.ts";
import { BinKey, BinVal, LMDBer } from "./core/lmdber.ts";

type KeyPart = string | Uint8Array;
type Keys = KeyPart | Iterable<KeyPart>;
/** Serialization kinds supported by `Komer` record payloads. */
export type KomerKind = Extract<Kind, "JSON" | "CBOR" | "MGPK">;

/** Shared constructor options for `KomerBase` variants. */
export interface KomerBaseOptions {
  subkey: string;
  sep?: string;
  kind?: KomerKind;
  dupsort?: boolean;
}

/** Constructor options for non-duplicate `Komer` variants. */
export interface KomerOptions extends Omit<KomerBaseOptions, "dupsort"> {}

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

/**
 * Shared keyspace/object-mapper substrate for single-value `Komer` variants.
 *
 * Responsibilities:
 * - open one named LMDB subdb and manage its key separator policy
 * - convert tuple-like keyspace paths to/from stored LMDB keys
 * - select JSON/CBOR/MGPK serializer functions for one record payload shape
 * - expose KERIpy-style branch iteration and trim helpers used by subclasses
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.koming.KomerBase`
 *
 * Current `keri-ts` differences:
 * - `Komer` is intentionally narrowed to one persisted value shape `T`
 * - only the single-record `Komer` subclass has been ported so far; the other
 *   KERIpy `KomerBase` subclasses still remain future work
 */
export class KomerBase<T> {
  static readonly Sep = ".";

  readonly db: LMDBer;
  readonly sdb: Database<BinVal, BinKey>;
  readonly sep: string;
  readonly kind: KomerKind;
  protected readonly _ser: (val: T) => Uint8Array;
  protected readonly _des: (val: Uint8Array | null) => T | null;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = KomerBase.Sep,
      kind = Kinds.json,
      dupsort = false,
    }: KomerBaseOptions,
  ) {
    this.db = db;
    this.sdb = this.db.openDB(subkey, dupsort);
    this.sep = sep;
    this.kind = assertKomerKind(kind);
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

  /** Returns the serializer function for the requested storage encoding kind. */
  _serializer(kind: KomerKind): (val: T) => Uint8Array {
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
  _deserializer(kind: KomerKind): (val: Uint8Array | null) => T | null {
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
  protected serializeJSON(val: T): Uint8Array {
    return b(JSON.stringify(val));
  }

  /** Encode one logical record as MGPK/MessagePack bytes. */
  protected serializeMGPK(val: T): Uint8Array {
    return toUint8Array(encodeMsgpack(val));
  }

  /** Encode one logical record as KERI-compatible CBOR bytes. */
  protected serializeCBOR(val: T): Uint8Array {
    return encodeKeriCbor(val);
  }

  /** Decode one JSON byte payload into the logical record type. */
  protected deserializeJSON(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return JSON.parse(t(val)) as T;
  }

  /** Decode one MGPK/MessagePack payload into the logical record type. */
  protected deserializeMGPK(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return decodeMsgpack(val) as T;
  }

  /** Decode one KERI-compatible CBOR payload into the logical record type. */
  protected deserializeCBOR(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return decodeKeriCbor(val) as T;
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
  ): Generator<[string[], T]> {
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
  ): Generator<[string[], T]> {
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
 * - callers are responsible for any domain-object adaptation above persisted
 *   value shape `T`
 */
export class Komer<T> extends KomerBase<T> {
  constructor(
    db: LMDBer,
    { subkey, sep = KomerBase.Sep, kind = Kinds.json }: KomerOptions,
  ) {
    super(db, { subkey, sep, kind, dupsort: false });
  }

  /** Insert one record value at its effective key if absent. */
  put(keys: Keys, val: T): boolean {
    return this.db.putVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Upsert one record value at its effective key. */
  pin(keys: Keys, val: T): boolean {
    return this.db.setVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Read one record value by its effective key. */
  get(keys: Keys): T | null {
    return this._des(this.db.getVal(this.sdb, this._tokey(keys)));
  }

  /**
   * Returns the plain stored-object shape for one record.
   *
   * This mirrors KERIpy `getDict` for plain persisted record shapes.
   */
  getDict(keys: Keys): T | null {
    return this.get(keys);
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
export class IoSetKomer<T> extends KomerBase<T> {
  constructor(
    db: LMDBer,
    { subkey, sep = KomerBase.Sep, kind = Kinds.json }: KomerOptions,
  ) {
    super(db, { subkey, sep, kind, dupsort: false });
  }

  /**
   * Insert an insertion-ordered set of records for one effective key if absent.
   *
   * Each logical member becomes its own physical key through the `IoSet*`
   * storage model; duplicate values are deduplicated by the underlying LMDB
   * helper family.
   */
  put(keys: Keys, vals: T | Iterable<T> | null = null): boolean {
    const items = vals === null || vals === undefined
      ? []
      : Symbol.iterator in Object(vals) && typeof vals !== "string"
          && !(vals instanceof Uint8Array)
      ? [...(vals as Iterable<T>)]
      : [vals as T];
    return this.db.putIoSetVals(
      this.sdb,
      this._tokey(keys),
      items.map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Upsert an insertion-ordered set of records for one effective key. */
  pin(keys: Keys, vals: T | Iterable<T> | null = null): boolean {
    const items = vals === null || vals === undefined
      ? []
      : Symbol.iterator in Object(vals) && typeof vals !== "string"
          && !(vals instanceof Uint8Array)
      ? [...(vals as Iterable<T>)]
      : [vals as T];
    return this.db.pinIoSetVals(
      this.sdb,
      this._tokey(keys),
      items.map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Append one record member to the insertion-ordered set for an effective key. */
  add(keys: Keys, val: T): boolean {
    return this.db.addIoSetVal(
      this.sdb,
      this._tokey(keys),
      this._ser(val),
      b(this.sep),
    );
  }

  /** Read all logical members for one effective key in insertion order. */
  get(keys: Keys, { ion = 0 }: { ion?: number } = {}): T[] {
    const out: T[] = [];
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
  getLast(keys: Keys): T | null {
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

  /** Remove one member, or all members when `val` is `null`, for an effective key. */
  rem(keys: Keys, val: T | null = null): boolean {
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
  ): Generator<[string[], T]> {
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
