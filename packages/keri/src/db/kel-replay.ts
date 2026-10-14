/** Inspectable KEL replay metadata; event bytes and read cursors remain consumption-owned. */
import type { Baser } from "./basing.ts";

/** Captured prefix and inclusive first-seen ordinal range, in wire replay order. */
export type KelReplayRange = readonly [pre: string, from: number, end: number];

/** A reopenable captured extent borrowing one runtime-owned Baser, never its event cache. */
export class CapturedKelReplay implements Iterable<Uint8Array> {
  readonly ranges: readonly KelReplayRange[];
  readonly maxMessageBytes: number;
  #db: Baser;

  /** Copy primitive ranges into plain frozen containers; caller keeps the borrowed store alive. */
  constructor(db: Baser, ranges: readonly KelReplayRange[], maxMessageBytes: number) {
    const count = ranges.length;
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) {
      throw new RangeError("Invalid KEL replay range count or message limit");
    }
    this.#db = db;
    const owned: KelReplayRange[] = [];
    for (let i = 0; i < count; i++) {
      const [pre, from, end] = ranges[i];
      if (
        typeof pre !== "string" || !pre || !Number.isSafeInteger(from) || from < 0
        || !Number.isSafeInteger(end) || end < from
      ) {
        throw new RangeError("Invalid captured KEL range");
      }
      owned.push(Object.freeze([pre, from, end] as const));
    }
    this.ranges = Object.freeze(owned);
    this.maxMessageBytes = maxMessageBytes;
    Object.freeze(this);
  }

  /** Recognize only this canonical owner, excluding prototype spoofs and additional subclass retention. */
  static is(value: unknown): value is CapturedKelReplay {
    return typeof value === "object" && value !== null && #db in value
      && Object.getPrototypeOf(value) === CapturedKelReplay.prototype;
  }

  /** Open no cursor until requested; each range reader joins its cursor before yielding an event. */
  *[Symbol.iterator](): Generator<Uint8Array> {
    for (const range of this.ranges) yield* this.#db.replayRange(range, this.maxMessageBytes);
  }
}
