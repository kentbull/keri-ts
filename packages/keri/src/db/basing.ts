/** KERI event-log databaser built on `LMDBer` composition. */

import { type Operation } from "npm:effection@^3.6.0";
import type { Database } from "npm:lmdb@3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import { BinKey, BinVal, LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";
import { Suber } from "./subing.ts";
import { b, t } from "../../../cesr/mod.ts";

export interface BaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * High-level event-log databaser for the current KERI bootstrap path.
 *
 * Responsibilities:
 * - own the LMDB environment used for KEL/event-adjacent state
 * - bind the named subdbs needed by current habitat visibility and event export
 * - expose a small, reviewable subset of `basing.py` behavior to the app layer
 *
 * Current `keri-ts` differences:
 * - only a narrow slice of the full `Baser` surface is implemented
 * - active habitat/name/habery stores now use `Komer`/`Suber`, but the broader
 *   record inventory and escrow-oriented basing surfaces are still pending
 */
export class Baser {
  private lmdber: LMDBer;
  private readonly logger: Logger;

  // Named sub-databases
  public evts!: Database<BinVal, BinKey>; // Events sub-database (dgKey: serialized KEL events)
  public habs!: Komer<unknown>; // Habitat records keyed by pre
  public names!: Suber; // (ns,name) -> pre
  public hbys!: Suber; // Habery-scoped values such as __signatory__

  // Class constants
  static readonly TailDirPath = "keri/db"; // TODO look at setting this TailDirPath to tufa/db and a compat path for the default KERIpy dir. cascade to other PathManager+subclasses for consistency
  static readonly AltTailDirPath = ".tufa/db";
  static readonly CompatAltTailDirPath = ".keri/db";
  static readonly TempPrefix = "keri_db_";
  static readonly MaxNamedDBs = 96;

  constructor(options: BaserOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    const compat = options.compat ?? false;
    // Create LMDBer with composition
    this.lmdber = new LMDBer(options, {
      tailDirPath: Baser.TailDirPath,
      cleanTailDirPath: "keri/clean/db",
      altTailDirPath: compat
        ? Baser.CompatAltTailDirPath
        : Baser.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/db" : ".tufa/clean/db",
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
      this.habs = new Komer(this.lmdber, { subkey: "habs." });
      this.names = new Suber(this.lmdber, { subkey: "names.", sep: "^" });
      this.hbys = new Suber(this.lmdber, { subkey: "hbys." });

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

  /** Insert habitat record for prefix if absent. */
  putHab(pre: string, record: unknown): boolean {
    return this.habs.put(pre, record);
  }

  /** Upsert habitat record for prefix. */
  pinHab(pre: string, record: unknown): boolean {
    return this.habs.pin(pre, record);
  }

  /** Read habitat record for prefix. */
  getHab<T>(pre: string): T | null {
    return this.habs.get(pre) as T | null;
  }

  /** Iterate persisted habitat records keyed by prefix. */
  *getHabItemIter<T>(
    top = "",
  ): Generator<[string, T]> {
    for (const [keys, record] of this.habs.getTopItemIter(top)) {
      const pre = keys[0];
      if (!pre) {
        continue;
      }
      yield [pre, record as T];
    }
  }

  /** Insert namespace/name -> prefix mapping if absent. */
  putName(ns: string, name: string, pre: string): boolean {
    return this.names.put([ns, name], pre);
  }

  /** Upsert namespace/name -> prefix mapping. */
  pinName(ns: string, name: string, pre: string): boolean {
    return this.names.pin([ns, name], pre);
  }

  /** Read namespace/name -> prefix mapping. */
  getName(ns: string, name: string): string | null {
    return this.names.get([ns, name]);
  }

  /** Upsert habery-scoped string setting in `hbys.`. */
  pinHby(name: string, value: string): boolean {
    return this.hbys.pin(name, value);
  }

  /** Read habery-scoped string setting from `hbys.`. */
  getHby(name: string): string | null {
    return this.hbys.get(name);
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
