/** Public registry evidence storage, exact opening verification and accepted replay. */
import {
  BlindState,
  BoundState,
  bytesEqual,
  Counter,
  type Diger,
  Ilks,
  isGroupTuple,
  type NumberPrimitive,
  parseBlinder,
  Saider,
  type SerderACDC,
  Vrsn_2_0,
} from "cesr-ts";
import type { Operation } from "effection";
import { DatabaseNotOpenError, DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { RawRecord } from "../core/records.ts";
import { Komer } from "../db/koming.ts";
import { RegBaser, type RegBaserOptions } from "./regbasing.ts";
import { type RegistryDisclosure, vetBlind } from "./regeventing.ts";

/** Encode one deliberately public opening using its exact primitive representations. */
export function publicOpeningAttachment(opening: RegistryDisclosure): Uint8Array {
  return Counter.enclose({
    code: "bn" in opening ? "BoundStateSextuples" : "BlindedStateQuadruples",
    version: Vrsn_2_0,
    qb64: "bn" in opening ? BoundState.qb64b(opening) : BlindState.qb64b(opening),
  });
}

/** Decode one retained counted tuple through the existing CESR codec and semantic descriptors. */
function retainedOpening(raw: Uint8Array): RegistryDisclosure {
  const parsed = parseBlinder(raw, Vrsn_2_0, "txt"), tuple = parsed.items[0];
  if (parsed.consumed !== raw.length || parsed.items.length !== 1 || !tuple || !isGroupTuple(tuple)) {
    throw new DatabaseOperationError("Corrupt retained public opening.");
  }
  const fields = tuple.map((field) => {
    if (isGroupTuple(field) || !("qb64b" in field)) throw new DatabaseOperationError("Corrupt retained opening tuple.");
    return field.qb64b;
  });
  if (
    (parsed.name === "BlindedStateQuadruples" || parsed.name === "BigBlindedStateQuadruples") && fields.length === 4
  ) {
    return BlindState.fromQb64bTuple([fields[0], fields[1], fields[2], fields[3]]);
  }
  if ((parsed.name === "BoundStateSextuples" || parsed.name === "BigBoundStateSextuples") && fields.length === 6) {
    return BoundState.fromQb64bTuple([fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]]);
  }
  throw new DatabaseOperationError("Corrupt retained public opening family.");
}

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
 * retain public bytes; retainOpening checks the exact body and BLID. Callers
 * authenticate KEL anchors and decide TEL acceptance.
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
  /** Read deliberately published opening bytes for this exact event, without creating evidence. */
  opening(said: string): Uint8Array | null {
    return this.baser.openings.get(said);
  }
  /** Retain one authentic public BUP opening only against its exact already-stored body. */
  retainOpening(event: SerderACDC, opening: RegistryDisclosure): RegistryDisclosure {
    if (event.ilk !== Ilks.bup || !event.verify()) throw new ValidationError("Public opening requires a verified BUP.");
    const stored = this.event(event.said!);
    if (!stored || !bytesEqual(stored.raw, event.raw)) {
      throw new ValidationError("Public opening requires the exact stored event body.");
    }
    if (!vetBlind(opening, event.sad!.b as string)) {
      throw new ValidationError("Public opening does not match the event commitment.");
    }
    const raw = publicOpeningAttachment(opening), old = this.opening(event.said!);
    if (old) {
      if (!bytesEqual(old, raw)) {
        throw new ValidationError("A different public opening is already retained for this event.");
      }
    } else if (!this.baser.openings.put(event.said!, raw)) {
      const retained = this.opening(event.said!);
      if (!retained || !bytesEqual(retained, raw)) {
        throw new ValidationError("A different public opening is already retained for this event.");
      }
    }
    return opening;
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
  /** Yield accepted public TEL frames, with a retained opening or an explicit empty attachment foot. */
  *cloneTelIter(regk: string, sn = 0): Generator<Uint8Array> {
    for (const [, , said] of this.baser.tels.getAllItemIter(regk, registryOrdinal(sn))) {
      const event = this.event(said.qb64);
      if (!event) continue;
      const raw = this.opening(event.said!);
      if (raw) {
        const opening = retainedOpening(raw);
        if (event.ilk !== Ilks.bup || !event.verify() || !vetBlind(opening, event.sad!.b as string)) {
          throw new DatabaseOperationError("Retained public opening does not authenticate its accepted event.");
        }
      }
      yield messagize(event, raw ?? new Uint8Array(), { gvrsn: Vrsn_2_0 });
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
