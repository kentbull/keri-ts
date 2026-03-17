import { type Database } from "npm:lmdb@3.4.4";
import { b, t } from "../../../cesr/mod.ts";
import { BinKey, BinVal, LMDBer } from "./core/lmdber.ts";

type KeyPart = string | Uint8Array;
type Keys = KeyPart | Iterable<KeyPart>;

function isIterableKeys(value: Keys): value is Iterable<KeyPart> {
  return typeof value !== "string" && !(value instanceof Uint8Array);
}

/**
 * Minimal base wrapper for KERIpy-style named LMDB sub-databases.
 *
 * Responsibilities:
 * - open one named subdb from an owning `LMDBer`
 * - convert tuple-like keyspace paths into separator-joined LMDB keys
 * - provide prefix iteration over the resulting branch layout
 *
 * Current `keri-ts` differences:
 * - this is the bootstrap slice of `subing.py`, not the full family surface
 * - only the value shapes needed on the current Gate B/C path are implemented
 */
export class SuberBase {
  protected readonly db: LMDBer;
  protected readonly sdb: Database<BinVal, BinKey>;
  readonly sep: string;

  constructor(
    db: LMDBer,
    {
      subkey,
      sep = ".",
      dupsort = false,
    }: {
      subkey: string;
      sep?: string;
      dupsort?: boolean;
    },
  ) {
    this.db = db;
    this.sdb = this.db.openDB(subkey, dupsort);
    this.sep = sep;
  }

  protected toKey(keys: Keys, topive = false): Uint8Array {
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

  protected toKeys(key: Uint8Array): string[] {
    return t(key).split(this.sep);
  }

  protected ser(val: string): Uint8Array {
    return b(val);
  }

  protected des(val: Uint8Array | null): string | null {
    return val === null ? null : t(val);
  }

  *getItemIter(
    keys: Keys = "",
    { topive = false }: { topive?: boolean } = {},
  ): Generator<[string[], string]> {
    for (
      const [key, val] of this.db.getTopItemIter(
        this.sdb,
        this.toKey(keys, topive),
      )
    ) {
      const text = this.des(val);
      if (text === null) {
        continue;
      }
      yield [this.toKeys(key), text];
    }
  }
}

/**
 * Plain single-value subdb wrapper for text/qb64 payloads.
 *
 * Use this when the logical contract is "one serialized value per effective
 * key" and no native dupsort or insertion-ordered set behavior is required.
 */
export class Suber extends SuberBase {
  constructor(
    db: LMDBer,
    { subkey, sep = "." }: { subkey: string; sep?: string },
  ) {
    super(db, { subkey, sep, dupsort: false });
  }

  put(keys: Keys, val: string): boolean {
    return this.db.putVal(this.sdb, this.toKey(keys), this.ser(val));
  }

  pin(keys: Keys, val: string): boolean {
    return this.db.setVal(this.sdb, this.toKey(keys), this.ser(val));
  }

  get(keys: Keys): string | null {
    return this.des(this.db.getVal(this.sdb, this.toKey(keys)));
  }

  rem(keys: Keys): boolean {
    return this.db.delVal(this.sdb, this.toKey(keys));
  }
}

/**
 * CESR-shaped subdb seam for values that should eventually round-trip through
 * CESR primitives.
 *
 * Current `keri-ts` difference:
 * - this is still a string pass-through wrapper; it marks the storage boundary
 *   but does not yet hydrate/verify rich CESR objects like KERIpy does.
 */
export class CesrSuber extends Suber {}

/**
 * Signer/cipher store seam for keeper secret material.
 *
 * Current `keri-ts` difference:
 * - intentionally pass-through for now; Gate D will add real AEID-backed
 *   encrypt/decrypt semantics on top of the same storage contract.
 */
export class CryptSignerSuber extends Suber {}
