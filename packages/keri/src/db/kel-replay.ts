/** Inspectable KEL replay metadata; event bytes and read cursors remain consumption-owned. */
import type { Baser } from "./basing.ts";

/** Captured prefix and inclusive first-seen ordinal range, in wire replay order. */
export type KelReplayRange = readonly [pre: string, from: number, end: number];

/** A reopenable captured extent borrowing one runtime-owned Baser, never its event cache. */
export class CapturedKelReplay implements Iterable<Uint8Array> {
  readonly ranges: readonly KelReplayRange[];
  readonly maxMessageBytes: number;
  #db: Baser;

  /** Transfer and freeze the capture array; callers retain the borrowed store through consumption. */
  constructor(db: Baser, ranges: KelReplayRange[], maxMessageBytes: number) {
    this.#db = db;
    for (const range of ranges) Object.freeze(range);
    this.ranges = Object.freeze(ranges);
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
