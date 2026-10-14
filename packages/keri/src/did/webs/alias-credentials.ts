/** Owned finite alias-ID metadata; credential hydration borrows the caller's runtime scope. */
import { b, ResourceAdmissionError, ResourceLimitError, type ResourceReservation, Saider } from "cesr-ts";
import * as lmdb from "npm:lmdb@3.5.3";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import { DatabaseOperationError, ValidationError } from "../../core/errors.ts";
import type { Reger } from "../../db/reger.ts";
import { DESIGNATED_ALIASES_SCHEMA_SAID } from "./designated-aliases.ts";

/** Configured local metadata/work limits; these do not classify protocol validity. */
export interface AliasIdLimits {
  maxIds?: number;
  maxMetadataBytes?: number;
  maxIdBytes?: number;
}

type DupStore = Reger["issus"]["sdb"] & {
  encoding: string;
  dupSort: boolean;
  compression?: object | false;
  useVersions?: boolean;
  encoder?: object;
  decoderCopies: boolean;
  decoder: { decode(bytes: Uint8Array, size: number): Uint8Array };
  _returnLargeBuffer: () => never;
};

/** Private snapshot of lexical issuer/schema membership; no bodies, TEL state or read cursors. */
export class CapturedAliasIds implements Iterable<string> {
  #ids: readonly string[];
  #credit: ResourceReservation | undefined;

  private constructor(ids: string[], credit: ResourceReservation) {
    this.#ids = Object.freeze(ids);
    this.#credit = credit;
  }

  /** Reserve before duplicate reads/copies; finite synchronous capture excludes later insertions. */
  static capture(runtime: AgentRuntime, aid: string, limits: AliasIdLimits = {}): CapturedAliasIds {
    const { maxIds = 4096, maxMetadataBytes = 1024 ** 2, maxIdBytes = 128 } = limits;
    for (const limit of [maxIds, maxMetadataBytes, maxIdBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid alias ID capture limit");
    }
    if (typeof aid !== "string" || !aid || aid.length > maxIdBytes) {
      throw new ResourceLimitError("Alias issuer exceeds configured identifier limit");
    }
    const bytes = 4 * maxMetadataBytes + 64 * maxIds + 1024;
    if (!Number.isSafeInteger(bytes)) throw new RangeError("Alias metadata charge exceeds supported range");
    const decision = runtime.resources.reserve({ bytes });
    if (decision.kind === "refuse") {
      throw new ResourceAdmissionError(`Alias metadata admission refused: ${decision.reason}`, decision.reason);
    }
    try {
      const reger = runtime.vdr.reger as Reger | null;
      if (!reger) throw new ValidationError("VDR runtime did not open Reger.");
      const native = reger.issus.sdb as DupStore;
      const schema = reger.schms.sdb as DupStore;
      const version = (lmdb as unknown as { version?: { nodeCompiledVersion?: number } }).version;
      if (
        !version || "nodeCompiledVersion" in version || native.encoding !== "binary" || !native.dupSort
        || native.compression || native.useVersions || schema.encoding !== "binary" || !schema.dupSort
        || schema.compression || schema.useVersions
      ) {
        throw new DatabaseOperationError("Alias capture requires lmdb 3.5.3 NAPI binary dupsort");
      }
      const ids: string[] = [];
      let count = 0, size = 0;
      // Native dupsort values are key-size bounded. This decoder receives native scratch BEFORE
      // read.js's ordinary binary slice: copies=true suppresses that earlier owned allocation.
      const read = Object.create(native) as DupStore;
      read.decoderCopies = true;
      read.decoder = {
        decode(value, extent) {
          if (!Number.isSafeInteger(extent) || extent < 1) throw new DatabaseOperationError("Corrupt alias ID extent");
          if (++count > maxIds || extent > maxIdBytes || (size += 64 + 4 * extent) > maxMetadataBytes) {
            throw new ResourceLimitError("Alias IDs exceed configured capture limits");
          }
          return new Uint8Array(value.subarray(0, extent));
        },
      };
      read._returnLargeBuffer = () => {
        throw new DatabaseOperationError("Unexpected large native duplicate row");
      };
      // 3.5.3 dereferences encoder.writeKey before its raw Uint8Array seek branch.
      const membership = Object.create(schema) as DupStore;
      membership.encoder = schema.encoder ?? {};
      const schemaKey = b(DESIGNATED_ALIASES_SCHEMA_SAID);
      const rows = read.getValues(b(aid))[Symbol.iterator]();
      const failures: unknown[] = [];
      try {
        for (let row = rows.next(); !row.done; row = rows.next()) {
          const match = { start: row.value, exactMatch: true };
          if (!membership.getValuesCount(schemaKey, match)) continue;
          const said = new Saider({ qb64b: row.value });
          if (said.fullSize !== row.value.length) throw new DatabaseOperationError("Corrupt alias ID trailing bytes");
          ids.push(said.qb64);
        }
      } catch (error) {
        failures.push(error);
      }
      try {
        rows.return?.();
      } catch (cleanup) {
        failures.push(cleanup);
      }
      if (failures.length > 1) throw new AggregateError(failures, "Alias cursor cleanup failed");
      if (failures.length) throw failures[0];
      return new CapturedAliasIds(ids, decision.reservation);
    } catch (error) {
      decision.reservation.release();
      throw error;
    }
  }

  /** Borrow captured primitives only while their metadata credit remains held. */
  *[Symbol.iterator](): Generator<string> {
    if (!this.#credit) throw new Error("Alias ID capture is released");
    for (const said of this.#ids) {
      if (!this.#credit) throw new Error("Alias ID capture is released");
      yield said;
    }
  }

  /** Release after consumer/source cleanup; no retained ID array survives in this owner. */
  release(): void {
    this.#ids = [];
    const credit = this.#credit;
    this.#credit = undefined;
    credit?.release();
  }
}

/** Consume one bounded credential synchronously; callback borrows hydrated values and must not retain them. */
export function consumeAliasCredential(
  runtime: AgentRuntime,
  said: string,
  consume: (credential: ReturnType<Reger["cloneCred"]>) => undefined,
  maxBodyBytes = runtime.replyStreams.messageByteLimit,
): void {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new RangeError("Invalid alias credential limit");
  if (typeof said !== "string" || !said) throw new RangeError("Invalid alias credential identifier");
  if (said.length > 512) throw new ResourceLimitError("Alias credential identifier exceeds local key limit");
  // Conservative decode/copy allowance; arbitrary CBOR/MGPK decoded growth is not yet qualified.
  const bytes = 8 * maxBodyBytes + 4096;
  if (!Number.isSafeInteger(bytes)) throw new RangeError("Alias credential charge exceeds supported range");
  const decision = runtime.resources.reserve({ bytes });
  if (decision.kind === "refuse") {
    throw new ResourceAdmissionError(`Alias credential admission refused: ${decision.reason}`, decision.reason);
  }
  try {
    const reger = runtime.vdr.reger as Reger | null;
    if (!reger) throw new ValidationError("VDR runtime did not open Reger.");
    if (consume(reger.cloneCredBounded(said, maxBodyBytes)) !== undefined) {
      throw new TypeError("Alias credential consumer must return undefined synchronously");
    }
  } finally {
    decision.reservation.release();
  }
}
