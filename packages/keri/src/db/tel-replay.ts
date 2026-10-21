/** Captured TEL metadata is retained; the runtime-owned Reger and its readers remain borrowed. */
import type { Versionage } from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import type { Reger } from "./reger.ts";

/** Requested replay cannot represent this stored body/proof; its signed bytes are never rewritten. */
export class UnsupportedTelReplayError extends ValidationError {
  readonly requested: Readonly<Versionage>;
  readonly required: Readonly<Versionage>;

  /** Retain the refused event and owned version values for a local caller or transport boundary. */
  constructor(readonly pre: string, readonly said: string, requested: Versionage, required: Versionage) {
    super(
      `TEL replay ${pre}/${said} requires version ${required.major}.${required.minor}; requested ${requested.major}.${requested.minor}.`,
    );
    this.requested = Object.freeze({ ...requested });
    this.required = Object.freeze({ ...required });
  }
}

/** Prefix and inclusive TEL ordinal horizon; every range starts at zero. */
export type TelReplayRange = readonly [pre: string, end: number];

/** Immutable wire settings for every range of one management/credential response. */
export interface TelReplaySettings {
  gvrsn: Readonly<Versionage>;
  genusify: boolean;
}

/** A captured TEL source; readers borrow the store without retaining event bytes. */
export class CapturedTelReplay implements Iterable<Uint8Array> {
  readonly ranges: readonly TelReplayRange[];
  readonly settings: Readonly<TelReplaySettings>;
  #db: Reger;

  /** Copy range tuples and wire settings; caller keeps the store alive through consumption. */
  constructor(db: Reger, ranges: readonly TelReplayRange[], settings: TelReplaySettings) {
    const count = ranges.length;
    const { gvrsn, genusify } = settings;
    const major = gvrsn.major, minor = gvrsn.minor;
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
    this.settings = Object.freeze({ gvrsn: Object.freeze({ major, minor }), genusify });
    Object.freeze(this);
  }

  /** Open readers only during consumption; each closes its cursor before cloning/yielding an event. */
  *[Symbol.iterator](): Generator<Uint8Array> {
    for (const range of this.ranges) yield* this.#db.replayRange(range, this.settings);
  }
}
