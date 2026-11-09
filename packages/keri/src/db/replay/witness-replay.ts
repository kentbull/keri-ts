/** Witness sequence replay borrows its Baser without retaining event bytes or read cursors. */
import { b, bytesEqual, t } from "cesr-ts";
import { DatabaseOperationError } from "../../core/errors.ts";
import type { Baser } from "../basing.ts";
import { onKey, splitOnKey } from "../core/keys.ts";

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
  ) {
    if (
      typeof pre !== "string" || !pre || !Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(end)
      || end < from
    ) {
      throw new RangeError("Invalid witness KEL sequence range");
    }
    if (!Number.isSafeInteger(felEnd) || felEnd < 0) {
      throw new RangeError("Invalid witness first-seen horizon");
    }
    this.#db = db;
    Object.freeze(this);
  }

  /** Seek after one physical insertion proem, closing every cursor before hydration or yield. */
  *[Symbol.iterator](): Generator<Uint8Array> {
    const prefix = b(this.pre);
    let next = this.from, start: Uint8Array | undefined, bucketDone = false;
    while (next <= this.end) {
      const key = onKey(prefix, next);
      const value = bucketDone ? undefined : this.#db.seekVal(this.#db.kels.sdb, key, start);
      if (!value) {
        const keys = this.#db.scanKeys(this.#db.kels.sdb, { start: key, exclusiveStart: true, limit: 1 })
          [Symbol.iterator]();
        let following: Uint8Array | undefined;
        try {
          const row = keys.next();
          if (!row.done) following = new Uint8Array(row.value);
        } finally {
          keys.return?.();
        }
        if (!following) break;
        const [top, sn] = splitOnKey(following);
        if (!bytesEqual(top, prefix)) break;
        if (!Number.isSafeInteger(sn) || sn <= next || !bytesEqual(following, onKey(top, sn))) {
          throw new DatabaseOperationError("Corrupt witness KEL sequence");
        }
        next = sn;
        start = undefined;
        bucketDone = false;
        continue;
      }
      const proem = t(value.subarray(0, 33));
      if (value.length <= 33 || !/^[0-9a-f]{32}\.$/.test(proem)) {
        throw new DatabaseOperationError("Corrupt witness KEL insertion proem");
      }
      // The physical ordinal, unlike a bucket offset, remains usable when earlier rows are deleted.
      const ordinal = BigInt(`0x${proem.slice(0, 32)}`) + 1n;
      bucketDone = ordinal >= 1n << 128n;
      start = bucketDone ? undefined : b(`${ordinal.toString(16).padStart(32, "0")}.`);
      const said = t(value.subarray(33));
      const fn = this.#db.getFelFn(this.pre, said);
      if (fn === null) continue;
      if (!Number.isFinite(fn) || fn < 0) throw new DatabaseOperationError("Corrupt witness first-seen ordinal");
      if (!Number.isSafeInteger(fn)) throw new RangeError("Unsupported witness first-seen ordinal");
      // New accepted duplicates at an old sequence are outside this response's first-seen horizon.
      if (fn > this.felEnd) continue;
      yield this.#db.cloneEvtMsg(this.pre, fn, said);
    }
  }
}
