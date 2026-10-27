/** Storage-only facade for public registry evidence and local registry aliases. */
import { type Diger, type NumberPrimitive, Saider, type SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { DatabaseNotOpenError, DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { RawRecord } from "../core/records.ts";
import { Komer } from "../db/koming.ts";
import { RegBaser, type RegBaserOptions } from "./regbasing.ts";

/** Local v2 aliases store only their public registry key, separately from legacy VDR records. */
export interface RegistryRecordShape {
  registryKey: string;
}
/** Persisted local registry alias, matching frozen registering.RegistryRecord. */
export class RegistryRecord extends RawRecord<RegistryRecordShape> implements RegistryRecordShape {
  declare registryKey: string;
}
/** Constructor-safe LMDB opening; the reference web backend remains unsupported. */
export interface OpenRegistryOptions extends RegBaserOptions {
  web?: boolean;
  reopen?: boolean;
}

/** Acquire one backing owner; failures/cancellation join cleanup before ownership transfers. */
export function* openRegistry(
  { web = false, reopen = true, ...options }: OpenRegistryOptions = {},
): Operation<RegBaser> {
  if (web) throw new ValidationError("web registry backend is not yet supported by V2 Regery");
  const baser = new RegBaser(options);
  let delivered = false;
  try {
    if (reopen && !(yield* baser.reopen())) throw new DatabaseNotOpenError("Registry backing store could not open.");
    delivered = true;
    return baser;
  } finally {
    if (!delivered) yield* baser.close(baser.temp);
  }
}

/** The existing database ordinal seam cannot represent negative or unsafe integers. */
function registryOrdinal(sn: number): number {
  if (!Number.isSafeInteger(sn) || sn < 0) {
    throw new RangeError("Registry ordinal must be a non-negative safe integer.");
  }
  return sn;
}

/**
 * Wrap a supplied RegBaser without opening another environment. Reads and writes
 * are storage operations: callers authenticate events/anchors and decide acceptance.
 * Explicit close delegates to the supplied owner; construction adds no lifetime scope.
 * Local aliases are optional; public observer stores need only evidence tables.
 */
export class RegistryStore {
  private aliases: Komer<RegistryRecord> | null = null;
  private aliasEnv: RegBaser["env"] = null;

  constructor(readonly baser: RegBaser) {}

  /** Local alias mapper is optional; refresh it after the owner's reopen. */
  get records(): Komer<RegistryRecord> | null {
    if (!this.baser.env) throw new DatabaseNotOpenError("Registry backing store is closed.");
    if (this.aliasEnv !== this.baser.env) {
      this.aliases = this.baser.hasTable("regs.")
        ? new Komer(this.baser, { subkey: "regs.", recordClass: RegistryRecord })
        : null;
      this.aliasEnv = this.baser.env;
    }
    return this.aliases;
  }

  /** Explicit alias write creates regs. only when needed, for local registry management. */
  putRecord(name: string, record: RegistryRecordShape): boolean {
    return this.initializeRecords().pin(name, record);
  }

  /** Bind aliases before a rollback-capable transaction; opening and reads never call this. */
  initializeRecords(): Komer<RegistryRecord> {
    let records = this.records;
    if (!records) {
      if (this.baser.readonly) throw new DatabaseOperationError("Cannot create readonly registry aliases.");
      records = this.aliases = new Komer(this.baser, { subkey: "regs.", recordClass: RegistryRecord });
    }
    return records;
  }

  /** Report the supplied backing owner's lifecycle state. */
  get opened(): boolean {
    return this.baser.opened;
  }
  /** Join explicit closure of the supplied owner, clearing temporary backing paths. */
  *close(): Operation<void> {
    yield* this.baser.close(this.baser.temp);
  }
  /** Return the stored event body; membership alone does not establish acceptance. */
  event(said: string): SerderACDC | null {
    return this.baser.evts.get(said);
  }
  /** Store an event body without authenticating it or marking it accepted. */
  putEvent(serder: SerderACDC): boolean {
    return this.baser.evts.pin(serder.said!, serder);
  }
  /** Read a stored source couple. */
  anchor(said: string): [NumberPrimitive, Diger] | null {
    if (!this.baser.opened) throw new DatabaseNotOpenError("Registry backing store is closed.");
    return this.baser.ancs.get(said);
  }
  /** Retain the first caller-verified anchor pair; later presentations cannot replace it. */
  putAnchor(said: string, number: NumberPrimitive, diger: Diger): boolean {
    return this.baser.ancs.put(said, [number, diger]);
  }
  /** Read the accepted-head cache without verifying the event. */
  head(regk: string): Saider | null {
    return this.baser.heads.get(regk);
  }
  /** Resolve the cached head's body, or null when absent. */
  headEvent(regk: string): SerderACDC | null {
    const head = this.head(regk);
    return head ? this.event(head.qb64) : null;
  }
  /** Read an accepted ordinal marker. Database ordinals use the existing safe-number API. */
  seqSaider(regk: string, sn: number): Saider | null {
    return this.baser.tels.getOn(regk, registryOrdinal(sn));
  }
  /** Resolve an accepted ordinal's body, or null when absent. */
  seqEvent(regk: string, sn: number): SerderACDC | null {
    const said = this.seqSaider(regk, sn);
    return said ? this.event(said.qb64) : null;
  }
  /** Publish caller-approved storage markers; validation and duplicate/head policy belong to the engine. */
  accept(regk: string, sn: number, serder: SerderACDC): void {
    sn = registryOrdinal(sn);
    const said = new Saider({ qb64: serder.said! });
    this.putEvent(serder);
    this.baser.tels.putOn(regk, sn, said);
    this.baser.heads.pin(regk, said);
  }
  /** Yield stored accepted bodies from the inclusive ordinal; skip missing bodies like the reference. */
  *cloneTelIter(regk: string, sn = 0): Generator<Uint8Array> {
    for (const [, , said] of this.baser.tels.getAllItemIter(regk, registryOrdinal(sn))) {
      const event = this.event(said.qb64);
      if (event) yield event.raw;
    }
  }
  /** Eagerly collect accepted TEL bytes in ordinal order. */
  cloneTel(regk: string, sn = 0): Uint8Array {
    const chunks = [...this.cloneTelIter(regk, sn)];
    const stream = new Uint8Array(chunks.reduce((size, raw) => size + raw.length, 0));
    let offset = 0;
    for (const raw of chunks) {
      stream.set(raw, offset);
      offset += raw.length;
    }
    return stream;
  }
  /** Add one missing-anchor candidate in insertion order, deduplicating its SAID. */
  escrowMissingAnchor(regk: string, sn: number, said: string): boolean {
    sn = registryOrdinal(sn);
    return this.baser.maes.add(regk, sn, [said]);
  }
  /** Add one out-of-order candidate in insertion order, deduplicating its SAID. */
  escrowOutOfOrder(regk: string, sn: number, said: string): boolean {
    sn = registryOrdinal(sn);
    return this.baser.ooes.add(regk, sn, [said]);
  }
  /**
   * Remove this candidate from both escrow families.
   * @param regk Registry identifier whose candidate slots are being cleared.
   * @param sn TEL ordinal shared by the candidate's escrow memberships.
   * @param said Candidate event SAID; other candidates in the slot remain.
   * @returns Whether either family contained a removed membership.
   */
  clearEscrows(regk: string, sn: number, said: string): boolean {
    sn = registryOrdinal(sn);
    const missingAnchor = this.baser.maes.rem(regk, sn, [said]);
    const outOfOrder = this.baser.ooes.rem(regk, sn, [said]);
    return missingAnchor || outOfOrder;
  }
}
