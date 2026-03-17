import {
  decode as decodeMsgpack,
  encode as encodeMsgpack,
} from "@msgpack/msgpack";
import { decode as decodeCbor } from "cbor-x/decode";
import { encode as encodeCbor } from "cbor-x/encode";
import { type Database } from "npm:lmdb@3.4.4";
import { b, type Kind, Kinds, t } from "../../../cesr/mod.ts";
import { BinKey, BinVal, LMDBer } from "./core/lmdber.ts";

type KeyPart = string | Uint8Array;
type Keys = KeyPart | Iterable<KeyPart>;
export type KomerKind = Extract<Kind, "JSON" | "CBOR" | "MGPK">;

/**
 * TypeScript-side schema hooks for `Komer` value validation and shape mapping.
 *
 * KERIpy uses a dataclass reference plus `dictify`/`datify` helpers. `keri-ts`
 * does not have an equivalent runtime dataclass system, so the same seam is
 * expressed as explicit hooks:
 * - `assert` validates a fully materialized domain value
 * - `toStored` maps a domain value to the plain serialized payload shape
 * - `fromStored` maps a decoded payload shape back into the domain value
 */
export interface KomerSchema<T, Stored = unknown> {
  assert?: (value: unknown) => asserts value is T;
  toStored?: (value: T) => Stored;
  fromStored?: (value: unknown) => T;
}

export interface KomerBaseOptions<T, Stored = unknown> {
  subkey: string;
  sep?: string;
  kind?: KomerKind;
  dupsort?: boolean;
  schema?: KomerSchema<T, Stored>;
}

export interface KomerOptions<T, Stored = unknown>
  extends Omit<KomerBaseOptions<T, Stored>, "dupsort"> {}

function assertKomerKind(kind: KomerKind): KomerKind {
  if (
    kind !== Kinds.json &&
    kind !== Kinds.cbor &&
    kind !== Kinds.mgpk
  ) {
    throw new Error(
      `Unsupported Komer serialization kind=${
        String(kind)
      }. Expected JSON, CBOR, or MGPK.`,
    );
  }
  return kind;
}

function toUint8Array(bytes: Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array &&
      Object.getPrototypeOf(bytes) === Uint8Array.prototype
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
 * - schema handling is expressed through explicit TS hooks instead of Python
 *   dataclass references plus `datify`/`dictify`
 * - only the single-record `Komer` subclass has been ported so far; the other
 *   KERIpy `KomerBase` subclasses still remain future work
 */
export class KomerBase<T, Stored = unknown> {
  static readonly Sep = ".";

  readonly db: LMDBer;
  readonly sdb: Database<BinVal, BinKey>;
  readonly sep: string;
  readonly kind: KomerKind;
  readonly schema?: KomerSchema<T, Stored>;
  protected readonly _ser: (val: T) => Uint8Array;
  protected readonly _des: (val: Uint8Array | null) => T | null;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = KomerBase.Sep,
      kind = Kinds.json,
      dupsort = false,
      schema,
    }: KomerBaseOptions<T, Stored>,
  ) {
    this.db = db;
    this.sdb = this.db.openDB(subkey, dupsort);
    this.sep = sep;
    this.kind = assertKomerKind(kind);
    this.schema = schema;
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

    const parts = [...keys].map((part) =>
      typeof part === "string" ? part : t(part)
    );
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

  protected toStored(val: T): Stored | T {
    this.schema?.assert?.(val);
    return this.schema?.toStored ? this.schema.toStored(val) : val;
  }

  protected fromStored(val: unknown): T {
    const record = this.schema?.fromStored
      ? this.schema.fromStored(val)
      : val as T;
    this.schema?.assert?.(record);
    return record;
  }

  protected serializeJSON(val: T): Uint8Array {
    return b(JSON.stringify(this.toStored(val)));
  }

  protected serializeMGPK(val: T): Uint8Array {
    return toUint8Array(encodeMsgpack(this.toStored(val)));
  }

  protected serializeCBOR(val: T): Uint8Array {
    return toUint8Array(encodeCbor(this.toStored(val)));
  }

  protected deserializeJSON(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return this.fromStored(JSON.parse(t(val)));
  }

  protected deserializeMGPK(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return this.fromStored(decodeMsgpack(val));
  }

  protected deserializeCBOR(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return this.fromStored(decodeCbor(val));
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
 * - validate and map domain values through the configured `KomerSchema`
 * - keep the active `Baser` and `Keeper` JSON-backed records on the KERIpy
 *   object-mapper path rather than raw LMDB access
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.koming.Komer`
 *
 * Current `keri-ts` differences:
 * - JSON remains the live-store default even though CBOR and MGPK are available
 * - schema validation/reconstruction is opt-in via `KomerSchema`
 */
export class Komer<T, Stored = unknown> extends KomerBase<T, Stored> {
  constructor(
    db: LMDBer,
    { subkey, sep = KomerBase.Sep, kind = Kinds.json, schema }: KomerOptions<
      T,
      Stored
    >,
  ) {
    super(db, { subkey, sep, kind, dupsort: false, schema });
  }

  put(keys: Keys, val: T): boolean {
    return this.db.putVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  pin(keys: Keys, val: T): boolean {
    return this.db.setVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  get(keys: Keys): T | null {
    return this._des(this.db.getVal(this.sdb, this._tokey(keys)));
  }

  /**
   * Returns the plain stored-object shape for one record.
   *
   * This mirrors KERIpy `getDict`. When a `KomerSchema` provides `toStored`,
   * the returned value is that mapped payload shape. Otherwise the domain value
   * itself is returned.
   */
  getDict(keys: Keys): Stored | T | null {
    const val = this.get(keys);
    if (val === null) {
      return null;
    }
    return this.toStored(val);
  }

  rem(keys: Keys): boolean {
    return this.db.delVal(this.sdb, this._tokey(keys));
  }

  cnt(): number {
    return this.db.cntAll(this.sdb);
  }
}
