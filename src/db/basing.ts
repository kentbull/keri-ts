/**
 * Baser - KERI Event Log Database
 *
 * Manages KEL events and related data using composition with LMDBer.
 * Sets up named sub-databases for key event logs.
 */

import { type Operation } from "effection";
import { Database } from "lmdb";
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
  public evts: Database<BinVal, BinKey> | null; // Events sub-database (dgKey: serialized KEL events)

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

    this.evts = null;
  }

  get name(): string {
    return this.lmdber.name;
  }

  get base(): string {
    return this.lmdber.base;
  }

  get opened(): boolean {
    return this.lmdber.opened && this.evts !== null;
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

    if (!opened || !this.lmdber.env) {
      return false;
    }

    // Open named sub-databases
    // Names end with "." to avoid namespace collisions with Base64 identifier prefixes
    try {
      this.evts = this.lmdber.openDB("evts.", false);

      return this.opened;
    } catch (error) {
      console.error(`Failed to open Baser sub-databases: ${error}`);
      return false;
    }
  }

  /**
   * Close the database
   */
  *close(clear = false): Operation<boolean> {
    this.evts = null;
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
    if (!this.evts) {
      throw new Error("evts sub-database not opened");
    }
    return this.lmdber.cnt(this.evts);
  }

  /**
   * Put value in evts sub-database
   */
  putEvt(key: Uint8Array, val: Uint8Array): boolean {
    if (!this.evts) {
      throw new Error("evts sub-database not opened");
    }
    return this.lmdber.putVal(this.evts, key, val);
  }

  /**
   * Set value in evts sub-database
   */
  setEvt(key: Uint8Array, val: Uint8Array): boolean {
    if (!this.evts) {
      throw new Error("evts sub-database not opened");
    }
    return this.lmdber.setVal(this.evts, key, val);
  }

  /**
   * Get value from evts sub-database
   */
  getEvt(key: Uint8Array): Uint8Array | null {
    if (!this.evts) {
      throw new Error("evts sub-database not opened");
    }
    return this.lmdber.getVal(this.evts, key);
  }

  /**
   * Delete value from evts sub-database
   */
  delEvt(key: Uint8Array): boolean {
    if (!this.evts) {
      throw new Error("evts sub-database not opened");
    }
    return this.lmdber.delVal(this.evts, key);
  }

  /**
   * Get iterator over items in evts sub-database
   *
   * @param top - Key prefix to filter by (empty to get all items)
   * @returns Generator yielding (key, val) tuples
   */
  *getAllEvtsIter(top: Uint8Array = new Uint8Array(0)): Generator<[Uint8Array, Uint8Array]> {
    if (!this.evts) {
      throw new Error("evts sub-database not opened");
    }
    yield* this.lmdber.getTopItemIter(this.evts, top);
  }
}
