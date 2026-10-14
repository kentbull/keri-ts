/** Witness sequence replay borrows its Baser without retaining event bytes or read cursors. */
import { ResourceLimitError } from "cesr-ts";
import { DatabaseOperationError } from "../core/errors.ts";
import type { Baser } from "./basing.ts";

/** Captured KEL/FEL horizons; duplicate order and current proofs are read only during consumption. */
export class CapturedWitnessReplay implements Iterable<Uint8Array> {
  #db: Baser;

  /** Fixed primitive metadata only; the caller keeps the borrowed store open through response disposal. */
  constructor(
    db: Baser,
    readonly pre: string,
    readonly from: number,
    readonly end: number,
    readonly felEnd: number,
    readonly maxMessageBytes: number,
  ) {
    if (
      typeof pre !== "string" || !pre || !Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(end)
      || end < from
    ) {
      throw new RangeError("Invalid witness KEL sequence range");
    }
    if (!Number.isSafeInteger(felEnd) || felEnd < 0 || !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) {
      throw new RangeError("Invalid witness first-seen horizon or message ceiling");
    }
    this.#db = db;
    Object.freeze(this);
  }

  /** Reopen at one sequence/duplicate offset, closing that cursor before native body preflight or yield. */
  *[Symbol.iterator](): Generator<Uint8Array> {
    let next = this.from, offset = 0;
    while (next <= this.end) {
      const rows = this.#db.kels.getAllItemIter(this.pre, next);
      let row: [string[], number, string] | undefined;
      try {
        for (let i = 0; i <= offset; i++) {
          row = rows.next().value;
          if (!row || row[1] !== next) {
            offset = 0;
            break;
          }
        }
      } finally {
        rows.return(undefined);
      }
      if (!row || row[1] > this.end) break;
      const [, sn, said] = row;
      if (!Number.isSafeInteger(sn) || sn < next) throw new DatabaseOperationError("Corrupt witness KEL sequence");
      next = sn;
      offset++;
      const fn = this.#db.getFelFn(this.pre, said);
      if (fn === null) continue;
      if (!Number.isFinite(fn) || fn < 0) throw new DatabaseOperationError("Corrupt witness first-seen ordinal");
      if (!Number.isSafeInteger(fn)) throw new ResourceLimitError("Unsupported witness first-seen ordinal");
      // New accepted duplicates at an old sequence are outside this response's first-seen horizon.
      if (fn > this.felEnd) continue;
      yield this.#db.cloneEvtMsg(this.pre, fn, said, this.maxMessageBytes);
    }
  }
}
