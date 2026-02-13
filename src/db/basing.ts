/**
 * Baser - KERI Event Log Database
 *
 * Manages KEL events and related data using composition with LMDBer.
 * Sets up named sub-databases for key event logs.
 */

import { type Operation } from "npm:effection@^3.6.0";
import { Database } from "npm:lmdb@^3.4.4";
import {
  DatabaseNotOpenError,
  DatabaseOperationError,
} from "../core/errors.ts";
import { BinKey, BinVal, LMDBer, LMDBerOptions } from "./core/lmdber.ts";

export interface BaserOptions extends LMDBerOptions {
  // Baser-specific options can be added here
}

/**
 * Baser manages KERI event logs
 * Uses composition with LMDBer instead of inheritance
 */
export class Baser {
  private lmdber: LMDBer;

  // Named sub-databases
  public evts!: Database<BinVal, BinKey>; // Events sub-database (dgKey: serialized KEL events)

  // Class constants
  static readonly TailDirPath = "keri/db";
  static readonly AltTailDirPath = ".keri/db";
  static readonly TempPrefix = "keri_db_";
  static readonly MaxNamedDBs = 96;

  constructor(options: BaserOptions = {}) {
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

  /**
   * Reopen the database and initialize sub-databases
   */
  *reopen(options: Partial<BaserOptions> = {}): Operation<boolean> {
    const opened = yield* this.lmdber.reopen(options);

    if (!opened) {
      return false;
    }

    // Open named sub-databases
    // Names end with "." to avoid namespace collisions with Base64 identifier prefixes
    try {
      this.evts = this.lmdber.openDB("evts.", false);

      return this.opened;
    } catch (error) {
      console.error(`Failed to open Baser sub-databases: ${error}`);
      throw new DatabaseOperationError(
        "Failed to open Baser sub-databases",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Close the database
   */
  *close(clear = false): Operation<boolean> {
    return yield* this.lmdber.close(clear);
  }

  /**
   * Get version
   */
  getVer(): string | null {
    return this.lmdber.getVer();
  }

  /**
   * Set version
   */
  setVer(val: string): void {
    this.lmdber.setVer(val);
  }

  /**
   * Count entries in evts sub-database
   */
  cntEvts(): number {
    return this.lmdber.cnt(this.evts);
  }

  /**
   * Put value in evts sub-database
   */
  putEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.putVal(this.evts, key, val);
  }

  /**
   * Set value in evts sub-database
   */
  setEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.setVal(this.evts, key, val);
  }

  /**
   * Get value from evts sub-database
   */
  getEvt(key: Uint8Array): Uint8Array | null {
    return this.lmdber.getVal(this.evts, key);
  }

  /**
   * Delete value from evts sub-database
   */
  delEvt(key: Uint8Array): boolean {
    return this.lmdber.delVal(this.evts, key);
  }

  /**
   * Get iterator over items in evts sub-database
   *
   * @param top - Key prefix to filter by (empty to get all items)
   * @returns Generator yielding (key, val) tuples
   */
  *getAllEvtsIter(
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    yield* this.lmdber.getTopItemIter(this.evts, top);
  }
}

/**
 * Create and open a Baser instance.
 *
 * Constructors cannot be async, so call this factory where an opened Baser is required.
 */
export function* createBaser(options: BaserOptions = {}): Operation<Baser> {
  const baser = new Baser(options);
  const opened = yield* baser.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Baser");
  }
  return baser;
}
