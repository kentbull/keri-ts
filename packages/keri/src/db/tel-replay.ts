/** Captured TEL metadata is retained; the runtime-owned Reger and its readers remain borrowed. */
import type { Versionage } from "cesr-ts";
import type { Reger } from "./reger.ts";

/** Prefix and inclusive TEL ordinal horizon; every range starts at zero. */
export type TelReplayRange = readonly [pre: string, end: number];

/** Immutable wire settings for every range of one management/credential response. */
export interface TelReplaySettings {
  gvrsn: Readonly<Versionage>;
  genusify: boolean;
  maxMessageBytes: number;
}

/** A fixed single/pair TEL source; inspection never opens iterators or traverses its borrowed store. */
export class CapturedTelReplay implements Iterable<Uint8Array> {
  readonly ranges: readonly TelReplayRange[];
  readonly settings: Readonly<TelReplaySettings>;
  #db: Reger;

  /** Copy at most two range tuples and wire settings; caller keeps the store alive through consumption. */
  constructor(db: Reger, ranges: readonly TelReplayRange[], settings: TelReplaySettings) {
    const count = ranges.length;
    if (!Number.isSafeInteger(count) || count < 1 || count > 2) {
      throw new RangeError("TEL replay requires one range or a fixed pair");
    }
    const { gvrsn, genusify, maxMessageBytes } = settings;
    const major = gvrsn.major, minor = gvrsn.minor;
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) {
      throw new RangeError("TEL replay message limit must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(major) || major < 0 || !Number.isSafeInteger(minor) || minor < 0
      || typeof genusify !== "boolean"
    ) {
      throw new RangeError("Invalid TEL replay wire settings");
    }
    this.#db = db;
    const owned: TelReplayRange[] = [];
    for (let i = 0; i < count; i++) {
      const [pre, end] = ranges[i];
      if (typeof pre !== "string" || !pre || !Number.isSafeInteger(end) || end < 0) {
        throw new RangeError("Invalid captured TEL range");
      }
      owned.push(Object.freeze([pre, end] as const));
    }
    this.ranges = Object.freeze(owned);
    this.settings = Object.freeze({ gvrsn: Object.freeze({ major, minor }), genusify, maxMessageBytes });
    Object.freeze(this);
  }

  /** Require this private brand and exact prototype; subclass/opaque sources cannot hide retention. */
  static is(value: unknown): value is CapturedTelReplay {
    return typeof value === "object" && value !== null && #db in value
      && Object.getPrototypeOf(value) === CapturedTelReplay.prototype;
  }

  /** Compose only fixed metadata in management/credential order, preserving null and duplicate ranges. */
  static pair(first: CapturedTelReplay | null, second: CapturedTelReplay | null): CapturedTelReplay | null {
    if ((first === null || CapturedTelReplay.is(first)) && (second === null || CapturedTelReplay.is(second))) {
      if (first === null) return second;
      if (second === null) return first;
      const left = first.settings, right = second.settings;
      if (
        first.#db !== second.#db || left.maxMessageBytes !== right.maxMessageBytes
        || left.genusify !== right.genusify || left.gvrsn.major !== right.gvrsn.major
        || left.gvrsn.minor !== right.gvrsn.minor
      ) {
        throw new RangeError("TEL replay pair requires the same borrowed store and wire settings");
      }
      return new CapturedTelReplay(first.#db, [...first.ranges, ...second.ranges], left);
    }
    throw new RangeError("TEL replay pair requires canonical captures");
  }

  /** Open readers only during consumption; each closes its cursor before cloning/yielding an event. */
  *[Symbol.iterator](): Generator<Uint8Array> {
    for (const range of this.ranges) yield* this.#db.replayRange(range, this.settings);
  }
}
