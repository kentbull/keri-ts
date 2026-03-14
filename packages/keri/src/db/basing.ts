/** KERI event-log databaser built on `LMDBer` composition. */

import { type Operation } from "npm:effection@^3.6.0";
import type { Database } from "npm:lmdb@3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import { BinKey, BinVal, LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { b, t } from "../../../cesr/mod.ts";

export interface BaserOptions extends LMDBerOptions {
  // Baser-specific options can be added here
}

/** High-level wrapper around core KEL-related sub-databases. */
export class Baser {
  private lmdber: LMDBer;
  private readonly logger: Logger;

  // Named sub-databases
  public evts!: Database<BinVal, BinKey>; // Events sub-database (dgKey: serialized KEL events)
  public habs!: Database<BinVal, BinKey>; // Habitat records keyed by pre
  public names!: Database<BinVal, BinKey>; // (ns,name) -> pre
  public hbys!: Database<BinVal, BinKey>; // Habery-scoped values such as __signatory__

  // Class constants
  static readonly TailDirPath = "keri/db";
  static readonly AltTailDirPath = ".tufa/db";
  static readonly TempPrefix = "keri_db_";
  static readonly MaxNamedDBs = 96;

  constructor(options: BaserOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    // Create LMDBer with composition
    this.lmdber = new LMDBer(options, {
      tailDirPath: Baser.TailDirPath,
      altTailDirPath: Baser.AltTailDirPath,
      tempPrefix: Baser.TempPrefix,
      maxNamedDBs: Baser.MaxNamedDBs,
    });
  }

  get name(): string {
    return this.lmdber.name;
  }

  get base(): string {
    return this.lmdber.base;
  }

  get opened(): boolean {
    return this.lmdber.opened;
  }

  get temp(): boolean {
    return this.lmdber.temp;
  }

  get path(): string | null {
    return this.lmdber.path;
  }

  get env() {
    return this.lmdber.env;
  }

  /** Reopen base LMDB env and bind named sub-databases. */
  *reopen(options: Partial<BaserOptions> = {}): Operation<boolean> {
    const opened = yield* this.lmdber.reopen(options);

    if (!opened) {
      return false;
    }

    // Open named sub-databases
    // Names end with "." to avoid namespace collisions with Base64 identifier prefixes
    try {
      this.evts = this.lmdber.openDB("evts.", false);
      this.habs = this.lmdber.openDB("habs.", false);
      this.names = this.lmdber.openDB("names.", false);
      this.hbys = this.lmdber.openDB("hbys.", false);

      return this.opened;
    } catch (error) {
      this.logger.error(`Failed to open Baser sub-databases: ${error}`);
      throw new DatabaseOperationError(
        "Failed to open Baser sub-databases",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /** Close the underlying LMDB resources. */
  *close(clear = false): Operation<boolean> {
    return yield* this.lmdber.close(clear);
  }

  /** Read root DB version marker. */
  getVer(): string | null {
    return this.lmdber.getVer();
  }

  /** Write root DB version marker. */
  setVer(val: string): void {
    this.lmdber.setVer(val);
  }

  /** Count event entries in `evts.`. */
  cntEvts(): number {
    return this.lmdber.cnt(this.evts);
  }

  /** Insert event value at key if absent. */
  putEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.putVal(this.evts, key, val);
  }

  /** Upsert event value at key. */
  setEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.setVal(this.evts, key, val);
  }

  /** Fetch event value by key. */
  getEvt(key: Uint8Array): Uint8Array | null {
    return this.lmdber.getVal(this.evts, key);
  }

  /** Delete event value by key. */
  delEvt(key: Uint8Array): boolean {
    return this.lmdber.delVal(this.evts, key);
  }

  /** Iterate `evts.` entries with optional byte-prefix filter. */
  *getAllEvtsIter(
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    yield* this.lmdber.getTopItemIter(this.evts, top);
  }

  /** UTF-8 encode helper. */
  private encodeText(text: string): Uint8Array {
    return b(text);
  }

  /** UTF-8 decode helper; returns `null` on missing bytes. */
  private decodeText(bytes: Uint8Array | null): string | null {
    if (bytes === null) return null;
    return t(bytes);
  }

  /** JSON encode helper. */
  private encodeJson(value: unknown): Uint8Array {
    return this.encodeText(JSON.stringify(value));
  }

  /** JSON decode helper; returns `null` on missing bytes. */
  private decodeJson<T>(bytes: Uint8Array | null): T | null {
    const text = this.decodeText(bytes);
    if (text === null) return null;
    return JSON.parse(text) as T;
  }

  /** Insert habitat record for prefix if absent. */
  putHab(pre: string, record: unknown): boolean {
    return this.lmdber.putVal(
      this.habs,
      this.encodeText(pre),
      this.encodeJson(record),
    );
  }

  /** Upsert habitat record for prefix. */
  pinHab(pre: string, record: unknown): boolean {
    return this.lmdber.setVal(
      this.habs,
      this.encodeText(pre),
      this.encodeJson(record),
    );
  }

  /** Read habitat record for prefix. */
  getHab<T>(pre: string): T | null {
    return this.decodeJson<T>(
      this.lmdber.getVal(this.habs, this.encodeText(pre)),
    );
  }

  /** Insert namespace/name -> prefix mapping if absent. */
  putName(ns: string, name: string, pre: string): boolean {
    const key = `${ns}:${name}`;
    return this.lmdber.putVal(
      this.names,
      this.encodeText(key),
      this.encodeText(pre),
    );
  }

  /** Upsert namespace/name -> prefix mapping. */
  pinName(ns: string, name: string, pre: string): boolean {
    const key = `${ns}:${name}`;
    return this.lmdber.setVal(
      this.names,
      this.encodeText(key),
      this.encodeText(pre),
    );
  }

  /** Read namespace/name -> prefix mapping. */
  getName(ns: string, name: string): string | null {
    const key = `${ns}:${name}`;
    return this.decodeText(
      this.lmdber.getVal(this.names, this.encodeText(key)),
    );
  }

  /** Upsert habery-scoped string setting in `hbys.`. */
  pinHby(name: string, value: string): boolean {
    return this.lmdber.setVal(
      this.hbys,
      this.encodeText(name),
      this.encodeText(value),
    );
  }

  /** Read habery-scoped string setting from `hbys.`. */
  getHby(name: string): string | null {
    return this.decodeText(
      this.lmdber.getVal(this.hbys, this.encodeText(name)),
    );
  }
}

/** Create/open a `Baser` (constructor-safe async factory). */
export function* createBaser(options: BaserOptions = {}): Operation<Baser> {
  const baser = new Baser(options);
  const opened = yield* baser.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Baser");
  }
  return baser;
}
