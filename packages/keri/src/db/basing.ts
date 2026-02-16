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
import { consoleLogger, type Logger } from "../core/logger.ts";
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

  private encodeText(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  private decodeText(bytes: Uint8Array | null): string | null {
    if (bytes === null) return null;
    return new TextDecoder().decode(bytes);
  }

  private encodeJson(value: unknown): Uint8Array {
    return this.encodeText(JSON.stringify(value));
  }

  private decodeJson<T>(bytes: Uint8Array | null): T | null {
    const text = this.decodeText(bytes);
    if (text === null) return null;
    return JSON.parse(text) as T;
  }

  putHab(pre: string, record: unknown): boolean {
    return this.lmdber.putVal(
      this.habs,
      this.encodeText(pre),
      this.encodeJson(record),
    );
  }

  pinHab(pre: string, record: unknown): boolean {
    return this.lmdber.setVal(
      this.habs,
      this.encodeText(pre),
      this.encodeJson(record),
    );
  }

  getHab<T>(pre: string): T | null {
    return this.decodeJson<T>(
      this.lmdber.getVal(this.habs, this.encodeText(pre)),
    );
  }

  putName(ns: string, name: string, pre: string): boolean {
    const key = `${ns}:${name}`;
    return this.lmdber.putVal(
      this.names,
      this.encodeText(key),
      this.encodeText(pre),
    );
  }

  pinName(ns: string, name: string, pre: string): boolean {
    const key = `${ns}:${name}`;
    return this.lmdber.setVal(
      this.names,
      this.encodeText(key),
      this.encodeText(pre),
    );
  }

  getName(ns: string, name: string): string | null {
    const key = `${ns}:${name}`;
    return this.decodeText(
      this.lmdber.getVal(this.names, this.encodeText(key)),
    );
  }

  pinHby(name: string, value: string): boolean {
    return this.lmdber.setVal(
      this.hbys,
      this.encodeText(name),
      this.encodeText(value),
    );
  }

  getHby(name: string): string | null {
    return this.decodeText(
      this.lmdber.getVal(this.hbys, this.encodeText(name)),
    );
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
