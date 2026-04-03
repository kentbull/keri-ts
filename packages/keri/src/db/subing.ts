import { type Database } from "npm:lmdb@3.4.4";
import {
  b,
  Cipher,
  type Counter,
  type Decrypter,
  type Encrypter,
  type Indexer,
  Matter,
  parseSerder,
  type Serder,
  SerderKERI,
  Signer,
  smell,
  t,
  Verfer,
} from "../../../cesr/mod.ts";
import { BinKey, BinVal, LMDBer } from "./core/lmdber.ts";

type KeyPart = string | Uint8Array;
type Keys = KeyPart | Iterable<KeyPart>;
type CesrValue = Matter | Indexer | Counter;
type QualifiedCtor<T extends CesrValue> = new(
  init: { qb64b: Uint8Array } | { qb64: string },
) => T;
type SerderCtor<T extends Serder> = {
  new(init?: unknown): T;
  name: string;
};

function isKeysIterable(value: Keys): value is Iterable<KeyPart> {
  return typeof value !== "string" && !(value instanceof Uint8Array);
}

function isNonStringIterable<T>(
  value: T | Iterable<T> | null | undefined,
): value is Iterable<T> {
  return value !== null && value !== undefined && typeof value !== "string"
    && !(value instanceof Uint8Array)
    && Symbol.iterator in Object(value);
}

function asIterable<T>(
  value: T | Iterable<T> | null | undefined,
): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return isNonStringIterable(value) ? [...value] : [value];
}

function asUint8Array(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array
      && Object.getPrototypeOf(value) === Uint8Array.prototype
    ? value
    : new Uint8Array(value);
}

function isBase64UrlSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/u.test(value);
}

function splitQualified<T extends CesrValue>(
  val: Uint8Array,
  ctors: readonly QualifiedCtor<T>[],
): T[] {
  const out: T[] = [];
  let offset = 0;
  while (offset < val.length) {
    for (const ctor of ctors) {
      if (offset >= val.length) {
        break;
      }
      const item = new ctor({ qb64b: val.slice(offset) });
      out.push(item);
      offset += item.fullSize;
    }
  }
  return out;
}

function signerToStored(
  value: Signer | Cipher | string | Uint8Array,
): Uint8Array {
  if (value instanceof Signer || value instanceof Cipher) {
    return value.qb64b;
  }
  if (typeof value === "string") {
    return b(value);
  }
  return value;
}

function signerFromStored(
  keyParts: string[],
  val: Uint8Array,
): Signer {
  const verkey = keyParts.at(-1);
  if (!verkey) {
    return new Signer({ qb64b: val });
  }
  const verfer = new Verfer({ qb64: verkey });
  return new Signer({ qb64b: val, transferable: verfer.transferable });
}

/**
 * Shared keyspace/value-shape adapter base for KERIpy-style sub-databases.
 *
 * Responsibilities:
 * - open one named LMDB subdb from an owning `LMDBer`
 * - convert tuple-like keyspace paths into separator-delimited LMDB keys
 * - provide KERIpy-style branch helpers shared across all `Suber` families
 */
export class SuberBase<T = string> {
  static readonly Sep = ".";

  protected readonly db: LMDBer;
  readonly sdb: Database<BinVal, BinKey>;
  readonly sep: string;
  readonly verify: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      dupsort = false,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      dupsort?: boolean;
      sep?: string;
      verify?: boolean;
    },
  ) {
    this.db = db;
    this.sdb = this.db.openDB(subkey, dupsort);
    this.sep = sep;
    this.verify = verify;
  }

  /** Convert one logical key path into one physical LMDB key. */
  protected _tokey(keys: Keys, topive = false): Uint8Array {
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

  /** Convert one physical LMDB key back into its logical key path. */
  protected _tokeys(key: Uint8Array): string[] {
    return t(key).split(this.sep);
  }

  /** Serialize one logical value into the raw LMDB byte representation. */
  protected _ser(val: T): Uint8Array {
    return b(String(val));
  }

  /** Deserialize one raw LMDB byte value into the logical wrapper type. */
  protected _des(val: Uint8Array | null): T | null {
    return val === null ? null : t(val) as T;
  }

  /** Remove all stored entries under one logical branch prefix. */
  trim(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): boolean {
    return this.db.delTop(this.sdb, this._tokey(keys, topive));
  }

  /** KERIpy-style alias for `trim()`. */
  remTop(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): boolean {
    return this.trim(keys, { topive });
  }

  /** Count all physical entries under one logical branch prefix. */
  cntTop(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): number {
    return this.db.cntTop(this.sdb, this._tokey(keys, topive));
  }

  /** Count every stored entry in this subdb family. */
  cntAll(): number {
    return this.db.cntAll(this.sdb);
  }

  /** Alias matching KERIpy's mixed wrapper counting vocabulary. */
  cnt(): number {
    return this.cntAll();
  }

  /** Iterate logical branch items for one key prefix. */
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
   * Iterate the full stored item view for this family.
   *
   * Families that hide suffixes or proems override this to expose those
   * details when tests or debuggers need the physical-storage view.
   */
  *getFullItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], T]> {
    yield* this.getTopItemIter(keys, { topive });
  }
}

/**
 * Single-value non-duplicate subdb family (`Suber`).
 */
export class Suber<T = string> extends SuberBase<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, dupsort: false, sep, verify });
  }

  /** Insert one single-value record if the effective key is absent. */
  put(keys: Keys, val: T): boolean {
    return this.db.putVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Upsert one single-value record at its effective key. */
  pin(keys: Keys, val: T): boolean {
    return this.db.setVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Read one single-value record from its effective key. */
  get(keys: Keys): T | null {
    return this._des(this.db.getVal(this.sdb, this._tokey(keys)));
  }

  /** Remove one single-value record by its effective key. */
  rem(keys: Keys): boolean {
    return this.db.delVal(this.sdb, this._tokey(keys));
  }

  /** Compatibility alias; `getTopItemIter()` is the parity branch iterator. */
  *getItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], T]> {
    yield* this.getTopItemIter(keys, { topive });
  }
}

/**
 * Exposed-ordinal key family (`On*`).
 *
 * Maintainer note:
 * - KERIpy normalized this family around `getTopItemIter` / `getAllItemIter` /
 *   `getAllIter`
 * - the older `getOn*` names remain here as compatibility wrappers so current
 *   `keri-ts` call sites do not need to migrate yet
 */
export class OnSuberBase<T = string> extends SuberBase<T> {
  /** Insert one value at an exposed ordinal bucket if that exact bucket is empty. */
  putOn(keys: Keys, on = 0, val: T | null = null): boolean {
    if (val === null) {
      return false;
    }
    return this.db.putOnVal(
      this.sdb,
      this._tokey(keys),
      on,
      this._ser(val),
      b(this.sep),
    );
  }

  /** Upsert one value at an exposed ordinal bucket. */
  pinOn(keys: Keys, on = 0, val: T | null = null): boolean {
    if (val === null) {
      return false;
    }
    return this.db.pinOnVal(
      this.sdb,
      this._tokey(keys),
      on,
      this._ser(val),
      b(this.sep),
    );
  }

  /** Append one value at the next exposed ordinal bucket for a logical key path. */
  appendOn(keys: Keys, val: T): number {
    return this.db.appendOnVal(
      this.sdb,
      this._tokey(keys),
      this._ser(val),
      b(this.sep),
    );
  }

  /** Read the full `(keys, on, value)` triple for one exact exposed ordinal bucket. */
  getOnItem(keys: Keys, on = 0): [string[], number, T] | null {
    const item = this.db.getOnItem(
      this.sdb,
      this._tokey(keys),
      on,
      b(this.sep),
    );
    if (item === null) {
      return null;
    }
    const [key, currentOn, val] = item;
    const record = this._des(val);
    if (record === null) {
      return null;
    }
    return [this._tokeys(key), currentOn, record];
  }

  /** Read the value stored at one exact exposed ordinal bucket. */
  getOn(keys: Keys, on = 0): T | null {
    return this._des(
      this.db.getOnVal(this.sdb, this._tokey(keys), on, b(this.sep)),
    );
  }

  /** Remove one exact exposed ordinal bucket. */
  remOn(keys: Keys, on = 0): boolean {
    return this.db.remOn(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  /** Remove all ordinal buckets from `on` onward under one logical branch. */
  remOnAll(keys: Keys = "", on = 0): boolean {
    return this.db.remOnAll(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  /** Count ordinal buckets from one starting ordinal under a logical key path. */
  cntOn(keys: Keys = "", on = 0): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return 0;
    }
    return this.db.cntOnAll(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  /** Count ordinal buckets from one starting ordinal across a branch or whole db. */
  cntOnAll(keys: Keys = "", on = 0): number {
    return this.db.cntOnAll(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  override getTopItemIter(keys?: Keys): Generator<[string[], number, T]>;
  override getTopItemIter(
    keys?: Keys,
    _options?: { topive?: boolean },
  ): Generator<[string[], T]>;
  override *getTopItemIter(
    keys: Keys = "",
    _options?: { topive?: boolean },
  ): Generator<[string[], number, T] | [string[], T]> {
    for (
      const [key, on, val] of this.db.getOnTopItemIter(
        this.sdb,
        this._tokey(keys),
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), on, record];
    }
  }

  /** Compatibility alias for the normalized ordinal-branch iterator. */
  *getOnTopItemIter(keys: Keys = ""): Generator<[string[], number, T]> {
    yield* this.getTopItemIter(keys);
  }

  /** Older alias retained for parity with pre-normalization ordinal scans. */
  *getOnItemIter(keys: Keys = ""): Generator<[string[], number, T]> {
    yield* this.getTopItemIter(keys);
  }

  /** Iterate all ordinal buckets from `on` onward, preserving the exposed ordinal. */
  *getAllItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnAllItemIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Compatibility alias for `getAllItemIter()`. */
  *getOnAllItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    yield* this.getAllItemIter(keys, on);
  }

  /** Older alias for full ordinal scans across a branch. */
  *getOnItemIterAll(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    yield* this.getAllItemIter(keys, on);
  }

  /** Iterate only values across ordinal buckets from `on` onward. */
  *getAllIter(keys: Keys = "", on = 0): Generator<T> {
    for (const [, , val] of this.getAllItemIter(keys, on)) {
      yield val;
    }
  }

  /** Compatibility alias for `getAllIter()`. */
  *getOnAllIter(keys: Keys = "", on = 0): Generator<T> {
    yield* this.getAllIter(keys, on);
  }

  /** Older alias for the normalized value-only ordinal scan. */
  *getOnIterAll(keys: Keys = "", on = 0): Generator<T> {
    yield* this.getAllIter(keys, on);
  }
}

/** Concrete exposed-ordinal single-value family. */
export class OnSuber<T = string> extends OnSuberBase<T> {}

/**
 * Base64 tuple value family (`B64*`).
 */
export class B64SuberBase<T extends string[] = string[]> extends Suber<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    if (isBase64UrlSegment(this.sep)) {
      throw new Error(`Invalid sep=${this.sep}. Separator may not be Base64.`);
    }
  }

  /** Join one Base64-url tuple into its stored byte representation. */
  protected _toval(
    vals: string | Uint8Array | Iterable<string | Uint8Array>,
  ): Uint8Array {
    if (typeof vals === "string") {
      if (!isBase64UrlSegment(vals)) {
        throw new Error(`Non Base64 value=${vals}.`);
      }
      return b(vals);
    }
    if (vals instanceof Uint8Array) {
      const txt = t(vals);
      if (!isBase64UrlSegment(txt)) {
        throw new Error(`Non Base64 value=${txt}.`);
      }
      return vals;
    }
    const items = [...vals].map((item) => typeof item === "string" ? item : t(item));
    for (const item of items) {
      if (!isBase64UrlSegment(item)) {
        throw new Error(`Non Base64 value=${item}.`);
      }
    }
    return b(items.join(this.sep));
  }

  /** Split one stored Base64-url tuple payload back into logical string parts. */
  protected _tovals(val: Uint8Array): T {
    return t(val).split(this.sep) as T;
  }

  /** Serialize one Base64-url tuple using the configured non-Base64 separator. */
  protected override _ser(val: T): Uint8Array {
    return this._toval(val);
  }

  /** Deserialize one stored Base64-url tuple payload into logical tuple parts. */
  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : this._tovals(val);
  }
}

/** Concrete Base64 tuple-value family. */
export class B64Suber<T extends string[] = string[]> extends B64SuberBase<T> {}

/**
 * Qualified CESR primitive family (`Cesr*`).
 */
export class CesrSuberBase<T extends CesrValue = CesrValue> extends Suber<T> {
  protected readonly ctor: QualifiedCtor<T>;
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<T>;
      strict?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctor = ctor;
    this.strict = strict;
  }

  protected override _ser(val: T): Uint8Array {
    if (this.strict && !(val instanceof this.ctor)) {
      throw new TypeError(`Expected ${this.ctor.name}, got ${typeof val}.`);
    }
    return val.qb64b;
  }

  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : new this.ctor({ qb64b: val });
  }
}

/** Concrete qualified-CESR single-value family. */
export class CesrSuber<T extends CesrValue = CesrValue> extends CesrSuberBase<T> {}

/**
 * Qualified CESR primitive family with an exposed ordinal in the keyspace.
 *
 * Storage model:
 * - exposed ordinal in the physical key (`On*`)
 * - one qualified CESR primitive per logical item
 */
export class CesrOnSuber<T extends CesrValue = CesrValue> extends OnSuberBase<T> {
  protected readonly ctor: QualifiedCtor<T>;
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<T>;
      strict?: boolean;
    },
  ) {
    super(db, { subkey, dupsort: false, sep, verify });
    this.ctor = ctor;
    this.strict = strict;
  }

  protected override _ser(val: T): Uint8Array {
    if (this.strict && !(val instanceof this.ctor)) {
      throw new TypeError(`Expected ${this.ctor.name}, got ${typeof val}.`);
    }
    return val.qb64b;
  }

  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : new this.ctor({ qb64b: val });
  }
}

/**
 * Concatenated qualified CESR tuple family (`CatCesr*`).
 */
export class CatCesrSuberBase<
  T extends readonly CesrValue[] = readonly CesrValue[],
> extends Suber<T> {
  protected readonly ctors: readonly QualifiedCtor<CesrValue>[];
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<CesrValue> | readonly QualifiedCtor<CesrValue>[];
      strict?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctors = Array.isArray(ctor) ? ctor : [ctor];
    this.strict = strict;
  }

  protected override _ser(val: T): Uint8Array {
    const items = isNonStringIterable(val) ? [...val] : [val];
    if (this.strict && items.length !== this.ctors.length) {
      throw new Error(
        `Expected ${this.ctors.length} CESR tuple elements, got ${items.length}.`,
      );
    }
    if (this.strict) {
      items.forEach((item, index) => {
        const ctor = this.ctors[index];
        if (ctor && !(item instanceof ctor)) {
          throw new TypeError(`Expected ${ctor.name} at slot ${index}.`);
        }
      });
    }
    const size = items.reduce((sum, item) => sum + item.qb64b.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const item of items) {
      out.set(item.qb64b, offset);
      offset += item.qb64b.length;
    }
    return out;
  }

  protected override _des(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    return splitQualified(val, this.ctors) as unknown as T;
  }
}

/** Concrete concatenated-CESR tuple family for one logical item per key. */
export class CatCesrSuber<
  T extends readonly CesrValue[] = readonly CesrValue[],
> extends CatCesrSuberBase<T> {}

/**
 * Insertion-ordered synthetic set family (`IoSet*`).
 */
export class IoSetSuber<T = string> extends SuberBase<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, dupsort: false, sep, verify });
  }

  /** Insert a logical insertion-ordered set for one effective key if absent. */
  put(keys: Keys, vals: T | Iterable<T> | null = null): boolean {
    const items = asIterable(vals).map((val) => this._ser(val));
    return this.db.putIoSetVals(
      this.sdb,
      this._tokey(keys),
      items,
      b(this.sep),
    );
  }

  /** Upsert a logical insertion-ordered set for one effective key. */
  pin(keys: Keys, vals: T | Iterable<T> | null = null): boolean {
    const items = asIterable(vals).map((val) => this._ser(val));
    return this.db.pinIoSetVals(
      this.sdb,
      this._tokey(keys),
      items,
      b(this.sep),
    );
  }

  /** Append one logical member to the insertion-ordered set for an effective key. */
  add(keys: Keys, val: T | null = null): boolean {
    if (val === null) {
      return false;
    }
    return this.db.addIoSetVal(
      this.sdb,
      this._tokey(keys),
      this._ser(val),
      b(this.sep),
    );
  }

  /** Materialize the logical `(keys, value)` view for one insertion-ordered set bucket. */
  getItem(keys: Keys, { ion = 0 }: { ion?: number } = {}): [string[], T][] {
    return [...this.getItemIter(keys, { ion })];
  }

  /** Read all logical members for one effective key, hiding synthetic suffixes. */
  get(keys: Keys, { ion = 0 }: { ion?: number } = {}): T[] {
    return [...this.getIter(keys, { ion })];
  }

  /** Iterate logical `(keys, value)` members for one insertion-ordered set bucket. */
  *getItemIter(
    keys: Keys,
    { ion = 0 }: { ion?: number } = {},
  ): Generator<[string[], T]> {
    for (
      const [key, val] of this.db.getIoSetItemIter(
        this.sdb,
        this._tokey(keys),
        ion,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), record];
    }
  }

  /** Iterate only logical values for one insertion-ordered set bucket. */
  *getIter(keys: Keys, { ion = 0 }: { ion?: number } = {}): Generator<T> {
    for (const [, val] of this.getItemIter(keys, { ion })) {
      yield val;
    }
  }

  /** Read the last logical member for one effective key. */
  getLastItem(keys: Keys): [string[], T] | null {
    const item = this.db.getIoSetLastItem(
      this.sdb,
      this._tokey(keys),
      b(this.sep),
    );
    if (item === null) {
      return null;
    }
    const [key, val] = item;
    const record = this._des(val);
    return record === null ? null : [this._tokeys(key), record];
  }

  /** Read only the value component of `getLastItem()`. */
  getLast(keys: Keys): T | null {
    const item = this.getLastItem(keys);
    return item ? item[1] : null;
  }

  /** Remove one member, or all members when `val` is `null`, from one effective key. */
  rem(keys: Keys, val: T | null = null): boolean {
    return this.db.remIoSetVal(
      this.sdb,
      this._tokey(keys),
      val === null ? null : this._ser(val),
      b(this.sep),
    );
  }

  /** Count members for one effective key, or the whole subdb when the key is empty. */
  override cnt(keys: Keys = "", { ion = 0 }: { ion?: number } = {}): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return this.db.cntAll(this.sdb);
    }
    return this.db.cntIoSet(this.sdb, this._tokey(keys), ion, b(this.sep));
  }

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
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), record];
    }
  }

  /** Iterate the last logical value from each effective key in a branch. */
  *getLastIter(keys: Keys = ""): Generator<T> {
    for (
      const val of this.db.getIoSetLastIterAll(
        this.sdb,
        this._tokey(keys),
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Iterate the last logical member for each effective key in a branch. */
  *getLastItemIter(keys: Keys = ""): Generator<[string[], T]> {
    for (
      const [key, val] of this.db.getIoSetLastItemIterAll(
        this.sdb,
        this._tokey(keys),
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), record];
    }
  }

  /** Iterate the physical-storage view, including synthetic insertion suffixes. */
  override *getFullItemIter(
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
}

/**
 * Base64 tuple family over synthetic insertion-ordered sets.
 *
 * Storage model:
 * - synthetic keyspace virtualization (`IoSet*`)
 * - Base64-only tuple-like text payloads
 */
export class B64IoSetSuber<T extends string[] = string[]> extends IoSetSuber<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    if (isBase64UrlSegment(this.sep)) {
      throw new Error(`Invalid sep=${this.sep}. Separator may not be Base64.`);
    }
  }

  /** Serialize one Base64-url tuple duplicate member with the configured separator. */
  protected override _ser(val: T): Uint8Array {
    const items = asIterable(val).map((item) => String(item));
    for (const item of items) {
      if (!isBase64UrlSegment(item)) {
        throw new Error(`Non Base64 value=${item}.`);
      }
    }
    return b(items.join(this.sep));
  }

  /** Deserialize one stored Base64-url duplicate member into logical tuple parts. */
  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : t(val).split(this.sep) as T;
  }
}

/**
 * Qualified CESR primitive family over synthetic insertion-ordered sets.
 *
 * Storage model:
 * - synthetic keyspace virtualization (`IoSet*`)
 * - one qualified CESR primitive per logical member
 */
export class CesrIoSetSuber<T extends CesrValue = CesrValue> extends IoSetSuber<T> {
  protected readonly ctor: QualifiedCtor<T>;
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<T>;
      strict?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctor = ctor;
    this.strict = strict;
  }

  protected override _ser(val: T): Uint8Array {
    if (this.strict && !(val instanceof this.ctor)) {
      throw new TypeError(`Expected ${this.ctor.name}, got ${typeof val}.`);
    }
    return val.qb64b;
  }

  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : new this.ctor({ qb64b: val });
  }
}

/**
 * Concatenated CESR tuple family over synthetic insertion-ordered sets.
 *
 * Storage model:
 * - synthetic keyspace virtualization (`IoSet*`)
 * - fixed-order tuples encoded as concatenated qb64 payloads
 */
export class CatCesrIoSetSuber<
  T extends readonly CesrValue[] = readonly CesrValue[],
> extends IoSetSuber<T> {
  protected readonly ctors: readonly QualifiedCtor<CesrValue>[];
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<CesrValue> | readonly QualifiedCtor<CesrValue>[];
      strict?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctors = Array.isArray(ctor) ? ctor : [ctor];
    this.strict = strict;
  }

  /**
   * Serialize one fixed-order CESR tuple into concatenated qb64 bytes.
   *
   * In strict mode, both tuple length and per-slot primitive class must match
   * the configured constructor sequence.
   */
  protected override _ser(val: T): Uint8Array {
    const items = isNonStringIterable(val) ? [...val] : [val];
    if (this.strict && items.length !== this.ctors.length) {
      throw new Error(
        `Expected ${this.ctors.length} CESR tuple elements, got ${items.length}.`,
      );
    }
    if (this.strict) {
      items.forEach((item, index) => {
        const ctor = this.ctors[index];
        if (ctor && !(item instanceof ctor)) {
          throw new TypeError(`Expected ${ctor.name} at slot ${index}.`);
        }
      });
    }
    const size = items.reduce((sum, item) => sum + item.qb64b.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const item of items) {
      out.set(item.qb64b, offset);
      offset += item.qb64b.length;
    }
    return out;
  }

  /** Hydrate one concatenated CESR tuple from stored qb64 bytes. */
  protected override _des(val: Uint8Array | null): T | null {
    return val === null
      ? null
      : splitQualified(val, this.ctors) as unknown as T;
  }
}

/**
 * Signer storage family keyed by verifier qb64.
 *
 * Maintainer model:
 * - stored value bytes are always the qualified signer seed payload
 * - the final keyspace segment is the authoritative verifier qb64
 * - signer hydration must therefore recover transferability from that verifier
 *   so `Signer.verfer` and `Signer.transferable` survive round-trips
 */
export class SignerSuber extends CesrSuberBase<Signer> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify, ctor: Signer });
  }

  /** Read one signer without local decryption support. */
  override get(keys: Keys, _decrypter?: Decrypter): Signer | null {
    const key = this._tokey(keys);
    const val = this.db.getVal(this.sdb, key);
    if (val === null) {
      return null;
    }
    return signerFromStored(this._tokeys(key), val);
  }

  /** Iterate signer items while preserving `Signer` hydration semantics. */
  override *getTopItemIter(
    keys: Keys = "",
    _decrypterOrOptions?: Decrypter | { topive?: boolean },
    maybeOptions: { topive?: boolean } = {},
  ): Generator<[string[], Signer]> {
    const options = _decrypterOrOptions instanceof Matter
      ? maybeOptions
      : _decrypterOrOptions ?? {};
    const { topive = false } = options;
    for (
      const [key, val] of this.db.getTopItemIter(
        this.sdb,
        this._tokey(keys, topive),
      )
    ) {
      yield [this._tokeys(key), signerFromStored(this._tokeys(key), val)];
    }
  }
}

/**
 * Signer family that preserves KERIpy's encrypted-signer API surface.
 *
 * Storage model:
 * - single-value CESR family over signer payloads
 * - hydrates stored values as `Signer` instances on read
 *
 * KERIpy correspondence:
 * - mirrors the role of `CryptSignerSuber` for stores like keeper `pris.`
 *
 * Current `keri-ts` difference:
 * - encrypted signer payloads are now handled directly by CESR
 *   `Encrypter`/`Decrypter` primitives instead of a keeper-local crypto shim
 *
 * Maintainer model:
 * - callers still interact in terms of logical signer seeds
 * - this subdb decides whether those logical seeds are stored directly or as
 *   ciphertext based on whether an encrypter/decrypter is supplied
 * - `pris.` therefore stays one logical "public key -> signer seed" map even
 *   though the at-rest bytes change under Gate D
 */
export class CryptSignerSuber extends SignerSuber {
  /**
   * Store one signer/cipher payload.
   *
   * When an encrypter is provided, the stored payload is a CESR `Cipher`
   * containing the sealed-box ciphertext of the signer's qb64 seed.
   *
   * Why encrypt the qualified seed text instead of raw bytes:
   * - the decrypt path can reconstruct the original CESR `Signer` without extra
   *   side-channel metadata
   * - the encrypted payload remains aligned with KERIpy's qualified-material
   *   round-trip model
   */
  override put(
    keys: Keys,
    val: Signer | Cipher | string | Uint8Array,
    encrypter?: Encrypter,
  ): boolean {
    const stored = encrypter && !(val instanceof Cipher)
      ? encrypter.encrypt({
        prim: val instanceof Signer
          ? val
          : typeof val === "string" || val instanceof Uint8Array
          ? new Signer({ qb64b: signerToStored(val) })
          : new Signer({ qb64b: signerToStored(val) }),
      })
      : val;
    return this.db.putVal(this.sdb, this._tokey(keys), signerToStored(stored));
  }

  /**
   * Upsert one signer/cipher payload with optional sealed-box encryption.
   *
   * `put()` and `pin()` intentionally share the same encryption semantics so
   * callers do not need separate "encrypted update" code paths.
   */
  override pin(
    keys: Keys,
    val: Signer | Cipher | string | Uint8Array,
    encrypter?: Encrypter,
  ): boolean {
    const stored = encrypter && !(val instanceof Cipher)
      ? encrypter.encrypt({
        prim: val instanceof Signer
          ? val
          : typeof val === "string" || val instanceof Uint8Array
          ? new Signer({ qb64b: signerToStored(val) })
          : new Signer({ qb64b: signerToStored(val) }),
      })
      : val;
    return this.db.setVal(this.sdb, this._tokey(keys), signerToStored(stored));
  }

  /**
   * Read one signer, decrypting the stored ciphertext when a decrypter exists.
   *
   * Failure interpretation:
   * - `null` still means "no record at this key"
   * - decrypt failure means "record exists but current auth material is wrong"
   */
  override get(keys: Keys, decrypter?: Decrypter): Signer | null {
    if (!decrypter) {
      return super.get(keys);
    }
    const key = this._tokey(keys);
    const val = this.db.getVal(this.sdb, key);
    if (val === null) {
      return null;
    }
    return signerFromStored(
      this._tokeys(key),
      decrypter.decrypt({ qb64: val, bare: true }) as Uint8Array,
    );
  }

  /**
   * Iterate signer items, decrypting stored ciphertext when requested.
   *
   * Maintainer note:
   * AEID re-encryption walks this iterator so it can migrate the whole `pris.`
   * surface without learning any keeper-specific key semantics here.
   */
  override *getTopItemIter(
    keys: Keys = "",
    decrypterOrOptions?: Decrypter | { topive?: boolean },
    maybeOptions: { topive?: boolean } = {},
  ): Generator<[string[], Signer]> {
    const decrypter = decrypterOrOptions instanceof Matter
      ? decrypterOrOptions
      : undefined;
    const options = decrypter
      ? maybeOptions
      : (decrypterOrOptions ?? {}) as { topive?: boolean };
    const { topive = false } = options;
    for (
      const [key, val] of this.db.getTopItemIter(
        this.sdb,
        this._tokey(keys, topive),
      )
    ) {
      const keyParts = this._tokeys(key);
      yield [
        keyParts,
        decrypter
          ? signerFromStored(
            keyParts,
            decrypter.decrypt({ qb64: val, bare: true }) as Uint8Array,
          )
          : signerFromStored(keyParts, val),
      ];
    }
  }
}

/**
 * Serder/Schemer families.
 */
export class SerderSuberBase<T extends Serder = SerderKERI> extends Suber<T> {
  protected readonly ctor: SerderCtor<T>;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor = SerderKERI as unknown as SerderCtor<T>,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor?: SerderCtor<T>;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctor = ctor;
  }

  protected override _ser(val: T): Uint8Array {
    return asUint8Array(val.raw);
  }

  protected override _des(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    const { smellage } = smell(val);
    const serder = parseSerder(val, smellage);
    if (
      (this.ctor as unknown) === SerderKERI && !(serder instanceof SerderKERI)
    ) {
      throw new TypeError(
        `Expected ${this.ctor.name}, got ${serder.constructor.name}.`,
      );
    }
    return serder as T;
  }
}

/** Concrete single-value serder family. */
export class SerderSuber<T extends Serder = SerderKERI> extends SerderSuberBase<T> {}

/**
 * Serder family over synthetic insertion-ordered sets.
 *
 * Storage model:
 * - synthetic keyspace virtualization (`IoSet*`)
 * - typed serder hydration through `smell()` + `parseSerder()`
 */
export class SerderIoSetSuber<T extends Serder = SerderKERI> extends IoSetSuber<T> {
  protected readonly ctor: SerderCtor<T>;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor = SerderKERI as unknown as SerderCtor<T>,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor?: SerderCtor<T>;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctor = ctor;
  }

  /** Serialize one serder body as its raw bytes. */
  protected override _ser(val: T): Uint8Array {
    return asUint8Array(val.raw);
  }

  /** Hydrate one stored raw body through the shared serder parser. */
  protected override _des(val: Uint8Array | null): T | null {
    if (val === null) {
      return null;
    }
    const { smellage } = smell(val);
    const serder = parseSerder(val, smellage);
    if (
      (this.ctor as unknown) === SerderKERI && !(serder instanceof SerderKERI)
    ) {
      throw new TypeError(
        `Expected ${this.ctor.name}, got ${serder.constructor.name}.`,
      );
    }
    return serder as T;
  }
}

/** Concrete schemer-style family built on the single-value serder adapter. */
export class SchemerSuber<T extends Serder = SerderKERI> extends SerderSuberBase<T> {}

/**
 * Native dupsort duplicate families (`Dup*` / `IoDup*`).
 */
export class DupSuber<T = string> extends SuberBase<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, dupsort: true, sep, verify });
  }

  /** Insert all duplicate values at one key if none of those values already exist. */
  put(keys: Keys, vals: T | Iterable<T>): boolean {
    return this.db.putVals(
      this.sdb,
      this._tokey(keys),
      asIterable(vals).map((val) => this._ser(val)),
    );
  }

  /** Replace the entire duplicate set at one key. */
  pin(keys: Keys, vals: T | Iterable<T>): boolean {
    const key = this._tokey(keys);
    this.db.delVals(this.sdb, key);
    return this.put(keys, vals);
  }

  /** Add one duplicate value if it is not already present at the key. */
  add(keys: Keys, val: T): boolean {
    return this.db.addVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Read all duplicate values stored at one effective key. */
  get(keys: Keys): T[] {
    return this.db.getVals(this.sdb, this._tokey(keys)).flatMap((val) => {
      const record = this._des(val);
      return record === null ? [] : [record];
    });
  }

  /** Read the lexicographically last duplicate value for one effective key. */
  getLast(keys: Keys): T | null {
    return this._des(this.db.getValLast(this.sdb, this._tokey(keys)));
  }

  /** Iterate duplicate values at one effective key in LMDB duplicate order. */
  *getIter(keys: Keys): Generator<T> {
    for (const val of this.db.getValsIter(this.sdb, this._tokey(keys))) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Count duplicate values at one key, or the whole subdb when the key is empty. */
  override cnt(keys: Keys = ""): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return this.db.cntAll(this.sdb);
    }
    return this.db.cntVals(this.sdb, this._tokey(keys));
  }

  /** Remove one duplicate value, or the whole duplicate set when `val` is `null`. */
  rem(keys: Keys, val: T | null = null): boolean {
    if (val === null) {
      return this.db.delVals(this.sdb, this._tokey(keys));
    }
    return this.db.delVal(this.sdb, this._tokey(keys), this._ser(val));
  }
}

/** Qualified CESR primitive family over native LMDB dupsort duplicates. */
export class CesrDupSuber<T extends CesrValue = CesrValue> extends DupSuber<T> {
  protected readonly ctor: QualifiedCtor<T>;
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<T>;
      strict?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctor = ctor;
    this.strict = strict;
  }

  protected override _ser(val: T): Uint8Array {
    if (this.strict && !(val instanceof this.ctor)) {
      throw new TypeError(`Expected ${this.ctor.name}, got ${typeof val}.`);
    }
    return val.qb64b;
  }

  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : new this.ctor({ qb64b: val });
  }
}

/** Concatenated CESR tuple family over native LMDB dupsort duplicates. */
export class CatCesrDupSuber<
  T extends readonly CesrValue[] = readonly CesrValue[],
> extends DupSuber<T> {
  protected readonly ctors: readonly QualifiedCtor<CesrValue>[];
  protected readonly strict: boolean;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
      ctor,
      strict = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
      ctor: QualifiedCtor<CesrValue> | readonly QualifiedCtor<CesrValue>[];
      strict?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    this.ctors = Array.isArray(ctor) ? ctor : [ctor];
    this.strict = strict;
  }

  protected override _ser(val: T): Uint8Array {
    const items = isNonStringIterable(val) ? [...val] : [val];
    if (this.strict && items.length !== this.ctors.length) {
      throw new Error(
        `Expected ${this.ctors.length} CESR tuple elements, got ${items.length}.`,
      );
    }
    const size = items.reduce((sum, item) => sum + item.qb64b.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const item of items) {
      out.set(item.qb64b, offset);
      offset += item.qb64b.length;
    }
    return out;
  }

  protected override _des(val: Uint8Array | null): T | null {
    return val === null
      ? null
      : splitQualified(val, this.ctors) as unknown as T;
  }
}

/**
 * Insertion-ordered duplicate family using native dupsort plus a hidden value proem.
 *
 * Storage model:
 * - native LMDB duplicates (`dupsort=true`)
 * - hidden insertion-order proem in stored duplicate values
 */
export class IoDupSuber<T = string> extends DupSuber<T> {
  /** Insert insertion-ordered duplicate values if their logical members are absent. */
  override put(keys: Keys, vals: T | Iterable<T>): boolean {
    return this.db.putIoDupVals(
      this.sdb,
      this._tokey(keys),
      asIterable(vals).map((val) => this._ser(val)),
    );
  }

  /** Replace the entire insertion-ordered duplicate set for one effective key. */
  override pin(keys: Keys, vals: T | Iterable<T>): boolean {
    const key = this._tokey(keys);
    this.db.delIoDupVals(this.sdb, key);
    return this.put(keys, vals);
  }

  /** Add one logical member if it is not already present in the insertion-ordered set. */
  override add(keys: Keys, val: T): boolean {
    return this.db.addIoDupVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Read all logical members for one insertion-ordered duplicate set. */
  override get(keys: Keys): T[] {
    return this.db.getIoDupVals(this.sdb, this._tokey(keys)).flatMap((val) => {
      const record = this._des(val);
      return record === null ? [] : [record];
    });
  }

  /** Iterate logical members for one insertion-ordered duplicate set. */
  override *getIter(keys: Keys): Generator<T> {
    for (const val of this.db.getIoDupValsIter(this.sdb, this._tokey(keys))) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Read the last inserted logical member for one insertion-ordered duplicate set. */
  override getLast(keys: Keys): T | null {
    return this._des(this.db.getIoDupValLast(this.sdb, this._tokey(keys)));
  }

  /** Remove one logical member, or the whole duplicate set when `val` is `null`. */
  override rem(keys: Keys, val: T | null = null): boolean {
    if (val === null) {
      return this.db.delIoDupVals(this.sdb, this._tokey(keys));
    }
    return this.db.delIoDupVal(this.sdb, this._tokey(keys), this._ser(val));
  }

  /** Count insertion-ordered duplicate members at one key or across the whole subdb. */
  override cnt(keys: Keys = ""): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return this.db.cntAll(this.sdb);
    }
    return this.db.cntIoDups(this.sdb, this._tokey(keys));
  }

  /** Iterate logical branch items while stripping the hidden insertion-order proem. */
  override *getTopItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], T]> {
    for (
      const [key, val] of this.db.getTopIoDupItemIter(
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
}

/** Base64 tuple family over insertion-ordered native duplicates. */
export class B64IoDupSuber<T extends string[] = string[]> extends IoDupSuber<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    if (isBase64UrlSegment(this.sep)) {
      throw new Error(`Invalid sep=${this.sep}. Separator may not be Base64.`);
    }
  }

  /** Serialize one Base64-url tuple member for an exposed-ordinal insertion-ordered set. */
  protected override _ser(val: T): Uint8Array {
    const items = asIterable(val).map((item) => String(item));
    for (const item of items) {
      if (!isBase64UrlSegment(item)) {
        throw new Error(`Non Base64 value=${item}.`);
      }
    }
    return b(items.join(this.sep));
  }

  /** Deserialize one stored Base64-url ordinal-set member into logical tuple parts. */
  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : t(val).split(this.sep) as T;
  }
}

/**
 * Exposed-ordinal plus insertion-ordered duplicate family.
 *
 * Storage model:
 * - exposed ordinal in the physical key (`On*`)
 * - native dupsort duplicates carrying a hidden insertion-order proem
 *
 * Maintainer note:
 * - KERIpy now prefers normalized names such as `put`, `getTopItemIter`,
 *   `getAllItemIter`, and `getAllIter`
 * - the older `*On*` names stay available here until upper layers migrate
 */
export class OnIoDupSuber<T = string> extends SuberBase<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, dupsort: true, sep, verify });
  }

  /** Insert all logical duplicate members into one exact exposed ordinal bucket if absent. */
  put(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    return this.db.putOnIoDupVals(
      this.sdb,
      this._tokey(keys),
      on,
      asIterable(vals).map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Compatibility alias retained while higher layers still call the older name. */
  putOn(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    return this.put(keys, on, vals);
  }

  /** Replace the entire logical duplicate set at one exact exposed ordinal bucket. */
  pinOn(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    this.db.delOnIoDups(this.sdb, this._tokey(keys), on, b(this.sep));
    return this.put(keys, on, vals);
  }

  /** Add one logical duplicate member to one exact exposed ordinal bucket if absent. */
  addOn(keys: Keys, on = 0, val: T): boolean {
    return this.db.addOnIoDupVal(
      this.sdb,
      this._tokey(keys),
      on,
      this._ser(val),
      b(this.sep),
    );
  }

  /** Append one value at the next exposed ordinal bucket. */
  appendOn(keys: Keys, val: T): number {
    return this.db.appendOnIoDupVal(
      this.sdb,
      this._tokey(keys),
      this._ser(val),
      b(this.sep),
    );
  }

  /** Read all logical duplicate members for one exact exposed ordinal bucket. */
  getOn(keys: Keys, on = 0): T[] {
    return this.db.getOnIoDupVals(
      this.sdb,
      this._tokey(keys),
      on,
      b(this.sep),
    ).flatMap((val) => {
      const record = this._des(val);
      return record === null ? [] : [record];
    });
  }

  /** Iterate logical duplicate members for one exact exposed ordinal bucket. */
  *getOnIter(keys: Keys, on = 0): Generator<T> {
    for (
      const val of this.db.getOnIoDupValsIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Read the last inserted logical duplicate member for one exposed ordinal bucket. */
  getOnLast(keys: Keys, on = 0): T | null {
    return this._des(
      this.db.getOnIoDupLast(this.sdb, this._tokey(keys), on, b(this.sep)),
    );
  }

  /** Remove one logical member, or the whole exposed-ordinal duplicate bucket. */
  remOn(keys: Keys, on = 0, val: T | null = null): boolean {
    if (val === null) {
      return this.db.delOnIoDups(this.sdb, this._tokey(keys), on, b(this.sep));
    }
    return this.db.delOnIoDupVal(
      this.sdb,
      this._tokey(keys),
      on,
      this._ser(val),
      b(this.sep),
    );
  }

  /** Count logical duplicate members for one exposed ordinal bucket or branch. */
  cntOn(keys: Keys = "", on = 0): number {
    if (
      (typeof keys === "string" && keys.length === 0)
      || (keys instanceof Uint8Array && keys.length === 0)
    ) {
      return this.db.cntAll(this.sdb);
    }
    return this.db.cntOnIoDups(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  override getTopItemIter(keys?: Keys): Generator<[string[], number, T]>;
  override getTopItemIter(
    keys?: Keys,
    _options?: { topive?: boolean },
  ): Generator<[string[], T]>;
  override *getTopItemIter(
    keys: Keys = "",
    _options?: { topive?: boolean },
  ): Generator<[string[], number, T] | [string[], T]> {
    for (
      const [key, currentOn, val] of this.db.getOnTopIoDupItemIter(
        this.sdb,
        this._tokey(keys),
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Compatibility alias for the normalized top-branch ordinal iterator. */
  *getOnTopItemIter(keys: Keys = ""): Generator<[string[], number, T]> {
    yield* this.getTopItemIter(keys);
  }

  /** Iterate logical items across ordinal buckets in forward order. */
  *getAllItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnIoDupItemIterAll(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  *getOnItemIterAll(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    yield* this.getAllItemIter(keys, on);
  }

  /** Iterate only logical values across ordinal buckets from `on` onward. */
  *getAllIter(keys: Keys = "", on = 0): Generator<T> {
    for (const [, , val] of this.getAllItemIter(keys, on)) {
      yield val;
    }
  }

  /** Compatibility alias for `getAllIter()`. */
  *getOnIterAll(keys: Keys = "", on = 0): Generator<T> {
    yield* this.getAllIter(keys, on);
  }

  /** Iterate the last logical duplicate value from each ordinal bucket. */
  *getOnLastIter(keys: Keys = "", on = 0): Generator<T> {
    for (
      const val of this.db.getOnIoDupLastValIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record !== null) {
        yield record;
      }
    }
  }

  /** Iterate the last logical item for each ordinal bucket. */
  *getOnLastItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnIoDupLastItemIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate logical duplicate items in reverse exposed-ordinal order. */
  *getOnItemBackIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnIoDupItemBackIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate only logical values in reverse exposed-ordinal order. */
  *getOnBackIter(keys: Keys = "", on = 0): Generator<T> {
    for (const [, , val] of this.getOnItemBackIter(keys, on)) {
      yield val;
    }
  }
}

/** Base64 tuple family over exposed-ordinal insertion-ordered duplicates. */
export class B64OnIoDupSuber<T extends string[] = string[]> extends OnIoDupSuber<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    if (isBase64UrlSegment(this.sep)) {
      throw new Error(`Invalid sep=${this.sep}. Separator may not be Base64.`);
    }
  }

  /** Serialize one Base64-url tuple member for an exposed-ordinal duplicate bucket. */
  protected override _ser(val: T): Uint8Array {
    const items = asIterable(val).map((item) => String(item));
    for (const item of items) {
      if (!isBase64UrlSegment(item)) {
        throw new Error(`Non Base64 value=${item}.`);
      }
    }
    return b(items.join(this.sep));
  }

  /** Deserialize one stored Base64-url ordinal-duplicate member into logical tuple parts. */
  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : t(val).split(this.sep) as T;
  }
}

/**
 * Exposed-ordinal insertion-ordered synthetic sets (`OnIoSet*`).
 *
 * Maintainer note:
 * - KERIpy normalized this family onto the same public verb set used by the
 *   simpler Suber families, with `on` remaining an explicit parameter
 * - the older `*On*` names remain here as compatibility wrappers for existing
 *   `keri-ts` DB call sites
 */
export class OnIoSetSuber<T = string> extends SuberBase<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, dupsort: false, sep, verify });
  }

  /** Insert an exposed-ordinal insertion-ordered set bucket if absent. */
  putOn(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    return this.db.putOnIoSetVals(
      this.sdb,
      this._tokey(keys),
      on,
      asIterable(vals).map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Replace the insertion-ordered set members for one exact exposed ordinal bucket. */
  pinOn(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    return this.db.pinOnIoSetVals(
      this.sdb,
      this._tokey(keys),
      on,
      asIterable(vals).map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Add one logical set member to one exact exposed ordinal bucket if absent. */
  addOn(keys: Keys, on = 0, val: T): boolean {
    return this.db.addOnIoSetVal(
      this.sdb,
      this._tokey(keys),
      on,
      this._ser(val),
      b(this.sep),
    );
  }

  /** Append a new exposed ordinal bucket populated with one or more logical set members. */
  appendOn(keys: Keys, vals: T | Iterable<T> | null = null): number {
    return this.db.appendOnIoSetVals(
      this.sdb,
      this._tokey(keys),
      asIterable(vals).map((val) => this._ser(val)),
      b(this.sep),
    );
  }

  /** Normalized alias for `putOn()` matching later KERIpy `OnIoSetSuber`. */
  put(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    return this.putOn(keys, on, vals);
  }

  /** Normalized alias for `pinOn()`. */
  pin(keys: Keys, on = 0, vals: T | Iterable<T> | null = null): boolean {
    return this.pinOn(keys, on, vals);
  }

  /** Normalized alias for `addOn()`. */
  add(keys: Keys, on = 0, val: T): boolean {
    return this.addOn(keys, on, val);
  }

  /** Normalized alias for `appendOn()`. */
  append(keys: Keys, vals: T | Iterable<T> | null = null): number {
    return this.appendOn(keys, vals);
  }

  /** Materialize the logical `(keys, on, value)` view for one ordinal-set bucket. */
  getItem(keys: Keys, on = 0, ion = 0): [string[], number, T][] {
    return [...this.getItemIter(keys, on, ion)];
  }

  /** Read all logical members from one exposed-ordinal insertion-ordered set bucket. */
  get(keys: Keys, on = 0, ion = 0): T[] {
    return [...this.getIter(keys, on, ion)];
  }

  /** Iterate logical `(keys, on, value)` triples for one ordinal-set bucket. */
  *getItemIter(
    keys: Keys,
    on = 0,
    ion = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnIoSetItemIter(
        this.sdb,
        this._tokey(keys),
        on,
        ion,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate only logical values from one ordinal-set bucket. */
  *getIter(keys: Keys, on = 0, ion = 0): Generator<T> {
    for (const [, , val] of this.getItemIter(keys, on, ion)) {
      yield val;
    }
  }

  /** Read the last logical member from one exact exposed ordinal-set bucket. */
  getLastItem(keys: Keys, on = 0): [string[], number, T] | null {
    const item = this.db.getOnIoSetLastItem(
      this.sdb,
      this._tokey(keys),
      on,
      b(this.sep),
    );
    if (item === null) {
      return null;
    }
    const [key, currentOn, val] = item;
    const record = this._des(val);
    return record === null ? null : [this._tokeys(key), currentOn, record];
  }

  /** Read only the value component of `getLastItem()`. */
  getLast(keys: Keys, on = 0): T | null {
    const item = this.getLastItem(keys, on);
    return item ? item[2] : null;
  }

  /** Remove one logical member from an ordinal-set bucket, or the whole bucket when `val` is `null`. */
  rem(keys: Keys, on = 0, val: T | null = null): boolean {
    return this.remOn(keys, on, val);
  }

  /** Remove all ordinal-set buckets from `on` onward under a branch. */
  remAll(keys: Keys = "", on = 0): boolean {
    return this.db.remOnAllIoSet(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  override cnt(): number;
  override cnt(keys: Keys, on?: number, ion?: number): number;
  /** Count logical members inside one exact ordinal-set bucket. */
  override cnt(keys: Keys = "", on = 0, ion = 0): number {
    return this.db.cntOnIoSet(
      this.sdb,
      this._tokey(keys),
      on,
      ion,
      b(this.sep),
    );
  }

  override cntAll(): number;
  override cntAll(keys?: Keys, on?: number): number;
  /** Count logical members across ordinal buckets from `on` onward. */
  override cntAll(keys: Keys = "", on = 0): number {
    return this.db.cntOnAllIoSet(this.sdb, this._tokey(keys), on, b(this.sep));
  }

  override getTopItemIter(keys?: Keys): Generator<[string[], number, T]>;
  override getTopItemIter(
    keys?: Keys,
    _options?: { topive?: boolean },
  ): Generator<[string[], T]>;
  override *getTopItemIter(
    keys: Keys = "",
    _options?: { topive?: boolean },
  ): Generator<[string[], number, T] | [string[], T]> {
    for (
      const [key, currentOn, val] of this.db.getOnTopIoSetItemIter(
        this.sdb,
        this._tokey(keys),
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate logical members across ordinal buckets from `on` onward. */
  *getAllItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnAllIoSetItemIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate only logical values across ordinal-set buckets from `on` onward. */
  *getAllIter(keys: Keys = "", on = 0): Generator<T> {
    for (const [, , val] of this.getAllItemIter(keys, on)) {
      yield val;
    }
  }

  /** Iterate the last logical member from each ordinal-set bucket. */
  *getAllLastItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnAllIoSetLastItemIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate only the last logical values from each ordinal-set bucket. */
  *getAllLastIter(keys: Keys = "", on = 0): Generator<T> {
    for (const [, , val] of this.getAllLastItemIter(keys, on)) {
      yield val;
    }
  }

  /** Iterate logical members in reverse exposed-ordinal order across a branch. */
  *getAllItemBackIter(
    keys: Keys = "",
    on: number | null = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnAllIoSetItemBackIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate only logical values in reverse exposed-ordinal order. */
  *getAllBackIter(keys: Keys = "", on: number | null = 0): Generator<T> {
    for (const [, , val] of this.getAllItemBackIter(keys, on)) {
      yield val;
    }
  }

  /** Iterate the last logical member from each ordinal bucket in reverse order. */
  *getAllLastItemBackIter(
    keys: Keys = "",
    on: number | null = 0,
  ): Generator<[string[], number, T]> {
    for (
      const [key, currentOn, val] of this.db.getOnAllIoSetLastItemBackIter(
        this.sdb,
        this._tokey(keys),
        on,
        b(this.sep),
      )
    ) {
      const record = this._des(val);
      if (record === null) {
        continue;
      }
      yield [this._tokeys(key), currentOn, record];
    }
  }

  /** Iterate only the last logical values from each ordinal bucket in reverse order. */
  *getAllLastBackIter(keys: Keys = "", on: number | null = 0): Generator<T> {
    for (const [, , val] of this.getAllLastItemBackIter(keys, on)) {
      yield val;
    }
  }

  /** Legacy alias for `getItem()`. */
  getOnItem(keys: Keys, on = 0): [string[], number, T][] {
    return this.getItem(keys, on);
  }

  /** Legacy alias for `get()`. */
  getOn(keys: Keys, on = 0): T[] {
    return this.get(keys, on);
  }

  /** Legacy alias for `getItemIter()`. */
  *getOnItemIter(keys: Keys, on = 0): Generator<[string[], number, T]> {
    yield* this.getItemIter(keys, on);
  }

  /** Legacy alias for `getIter()`. */
  *getOnIter(keys: Keys, on = 0): Generator<T> {
    yield* this.getIter(keys, on);
  }

  /** Legacy alias for `getLastItem()`. */
  getOnLastItem(keys: Keys, on = 0): [string[], number, T] | null {
    return this.getLastItem(keys, on);
  }

  /** Legacy alias for `getLast()`. */
  getOnLast(keys: Keys, on = 0): T | null {
    return this.getLast(keys, on);
  }

  /** Legacy removal surface that still mirrors current upstream call sites. */
  remOn(keys: Keys, on = 0, val: T | null = null): boolean {
    return this.db.remOnIoSetVal(
      this.sdb,
      this._tokey(keys),
      on,
      val === null ? null : this._ser(val),
      b(this.sep),
    );
  }

  /** Legacy alias for `cnt()`. */
  cntOn(keys: Keys, on = 0): number {
    return this.cnt(keys, on);
  }

  /** Legacy alias for `cntAll()`. */
  cntOnAll(keys: Keys = "", on = 0): number {
    return this.cntAll(keys, on);
  }

  /** Legacy alias for `getTopItemIter()`. */
  *getOnTopItemIter(keys: Keys = ""): Generator<[string[], number, T]> {
    yield* this.getTopItemIter(keys);
  }

  /** Legacy alias for `getAllItemIter()`. */
  *getOnAllItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    yield* this.getAllItemIter(keys, on);
  }

  /** Legacy alias for `getAllLastItemIter()`. */
  *getOnLastItemIter(
    keys: Keys = "",
    on = 0,
  ): Generator<[string[], number, T]> {
    yield* this.getAllLastItemIter(keys, on);
  }

  /** Legacy alias for `getAllItemBackIter()`. */
  *getOnItemBackIter(
    keys: Keys = "",
    on: number | null = 0,
  ): Generator<[string[], number, T]> {
    yield* this.getAllItemBackIter(keys, on);
  }

  /** Legacy alias for `getAllBackIter()`. */
  *getOnBackIter(keys: Keys = "", on: number | null = 0): Generator<T> {
    yield* this.getAllBackIter(keys, on);
  }
}

/** Base64 tuple family over exposed-ordinal synthetic insertion-ordered sets. */
export class B64OnIoSetSuber<T extends string[] = string[]> extends OnIoSetSuber<T> {
  constructor(
    db: LMDBer,
    {
      subkey,
      sep = SuberBase.Sep,
      verify = false,
    }: {
      subkey: string;
      sep?: string;
      verify?: boolean;
    },
  ) {
    super(db, { subkey, sep, verify });
    if (isBase64UrlSegment(this.sep)) {
      throw new Error(`Invalid sep=${this.sep}. Separator may not be Base64.`);
    }
  }

  protected override _ser(val: T): Uint8Array {
    const items = asIterable(val).map((item) => String(item));
    for (const item of items) {
      if (!isBase64UrlSegment(item)) {
        throw new Error(`Non Base64 value=${item}.`);
      }
    }
    return b(items.join(this.sep));
  }

  protected override _des(val: Uint8Array | null): T | null {
    return val === null ? null : t(val).split(this.sep) as T;
  }
}
