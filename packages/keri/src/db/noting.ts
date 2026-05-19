/**
 * Dedicated notification databaser.
 *
 * KERIpy correspondence:
 * - ports the `Noter` sidecar and `Notice` storage model from
 *   `keri.app.notifying`
 *
 * Ownership rule:
 * - this is a separate additive sidecar like `Mailboxer`, not a `Baser`
 *   family
 * - higher-level notification policy lives in `app/notifying.ts`
 */
import type { Operation } from "npm:effection@^3.6.0";
import { Cigar, MtrDex, Salter } from "../../../cesr/mod.ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { CesrSuber, Suber } from "./subing.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Notification attribute payload stored inside a `Notice`. */
export type NoticeAttrs = Record<string, unknown>;

/** Durable notice pad matching KERIpy `Notice.pad`. */
export interface NoticePad<T extends NoticeAttrs = NoticeAttrs> {
  i: string;
  dt: string;
  r: boolean;
  a: T;
}

/** Options for opening the dedicated notification sidecar. */
export interface NoterOptions extends LMDBerOptions {
  compat?: boolean;
}

function randomNonce(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return new Salter({ code: MtrDex.Salt_128, raw }).qb64;
}

function encodePad<T extends object>(pad: T): Uint8Array {
  return textEncoder.encode(JSON.stringify(pad));
}

function decodePad<T extends object>(raw: Uint8Array): T {
  return JSON.parse(textDecoder.decode(raw)) as T;
}

/**
 * Signed durable controller notification.
 *
 * KERIpy correspondence:
 * - mirrors `Notice` from `keri.app.notifying`
 * - `i` is a random notice id, not a KEL SAID
 */
export class Notice<T extends NoticeAttrs = NoticeAttrs> {
  #raw!: Uint8Array;
  #pad!: NoticePad<T>;

  constructor(
    init:
      | { raw: Uint8Array }
      | { pad: Omit<Partial<NoticePad<T>>, "a"> & { a: T } },
  ) {
    if ("raw" in init) {
      this.raw = init.raw;
      return;
    }
    this.pad = init.pad;
  }

  /** Serialized raw JSON bytes used for signing and storage. */
  get raw(): Uint8Array {
    return new Uint8Array(this.#raw);
  }

  set raw(raw: Uint8Array) {
    this.pad = decodePad<NoticePad<T>>(raw);
  }

  /** Parsed mutable pad view. */
  get pad(): NoticePad<T> {
    return {
      ...this.#pad,
      a: { ...this.#pad.a },
    };
  }

  set pad(
    pad: Omit<Partial<NoticePad<T>>, "a"> & { a: T },
  ) {
    const normalized: NoticePad<T> = {
      i: typeof pad.i === "string" && pad.i.length > 0 ? pad.i : randomNonce(),
      dt: typeof pad.dt === "string" && pad.dt.length > 0
        ? pad.dt
        : new Date().toISOString(),
      r: typeof pad.r === "boolean" ? pad.r : false,
      a: { ...pad.a },
    };
    this.#pad = normalized;
    this.#raw = encodePad(normalized);
  }

  /** Random stable notice id. */
  get rid(): string {
    return this.#pad.i;
  }

  /** ISO-8601 notice creation time. */
  get datetime(): string {
    return this.#pad.dt;
  }

  /** User-facing notification payload. */
  get attrs(): T {
    return { ...this.#pad.a };
  }

  /** Plain stored shape for inspection and CLI projection. */
  asDict(): NoticePad<T> {
    return this.pad;
  }

  /** Read/unread status. */
  get read(): boolean {
    return this.#pad.r;
  }

  set read(read: boolean) {
    this.pad = {
      ...this.#pad,
      r: read,
    };
  }
}

/** Raw-byte notice subdb family keyed by `(dt, rid)`. */
class NoticeSuber extends Suber<Notice> {
  protected override _ser(val: Notice): Uint8Array {
    return val.raw;
  }

  protected override _des(val: Uint8Array | null): Notice | null {
    return val === null ? null : new Notice({ raw: new Uint8Array(val) });
  }
}

/**
 * Dedicated notification sidecar.
 *
 * Storage model:
 * - `.nots` stores raw `Notice` bytes keyed by `(dt, rid)`
 * - `.nidx` stores `rid -> dt`
 * - `.ncigs` stores detached `Cigar`s for integrity verification
 */
export class Noter extends LMDBer {
  public notes!: NoticeSuber;
  public nidx!: Suber<string>;
  public ncigs!: CesrSuber<Cigar>;

  static override readonly TailDirPath = "keri/not";
  static override readonly AltTailDirPath = ".tufa/not";
  static readonly CompatAltTailDirPath = ".keri/not";
  static override readonly TempPrefix = "keri_not_";
  static override readonly MaxNamedDBs = 8;

  constructor(options: NoterOptions = {}) {
    const compat = options.compat ?? false;
    super(options, {
      tailDirPath: Noter.TailDirPath,
      cleanTailDirPath: "keri/clean/not",
      altTailDirPath: compat
        ? Noter.CompatAltTailDirPath
        : Noter.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/not" : ".tufa/clean/not",
      tempPrefix: Noter.TempPrefix,
      maxNamedDBs: Noter.MaxNamedDBs,
    });
  }

  override *reopen(
    options: Partial<NoterOptions> = {},
  ) {
    const opened = yield* super.reopen(options);
    if (!opened) {
      return false;
    }

    this.notes = new NoticeSuber(this, {
      subkey: "nots.",
      sep: "/",
    });
    this.nidx = new Suber(this, { subkey: "nidx." });
    this.ncigs = new CesrSuber(this, {
      subkey: "ncigs.",
      ctor: Cigar,
    });
    return true;
  }

  /** Add one new notice iff its `rid` is not already present. */
  add(note: Notice, cigar: Cigar): boolean {
    const dt = note.datetime;
    const rid = note.rid;
    if (this.nidx.get([rid]) !== null) {
      return false;
    }

    this.nidx.pin([rid], dt);
    this.ncigs.pin([rid], cigar);
    return this.notes.pin([dt, rid], note);
  }

  /** Update one existing notice and detached signature in place. */
  update(note: Notice, cigar: Cigar): boolean {
    const dt = note.datetime;
    const rid = note.rid;
    if (this.nidx.get([rid]) === null) {
      return false;
    }

    this.nidx.pin([rid], dt);
    this.ncigs.pin([rid], cigar);
    return this.notes.pin([dt, rid], note);
  }

  /** Retrieve one stored notice/signature pair by notice id. */
  getNotice(rid: string): [Notice, Cigar] | null {
    const dt = this.nidx.get([rid]);
    if (dt === null) {
      return null;
    }

    const note = this.notes.get([dt, rid]);
    const cigar = this.ncigs.get([rid]);
    if (!note || !cigar) {
      return null;
    }
    return [note, cigar];
  }

  /** Remove one notice and its signature/index rows. */
  removeNotice(rid: string): boolean {
    const current = this.getNotice(rid);
    if (!current) {
      return false;
    }

    const [note] = current;
    this.nidx.rem([rid]);
    this.ncigs.rem([rid]);
    return this.notes.rem([note.datetime, rid]);
  }

  /** Count all stored notices. */
  countNotices(): number {
    return this.notes.cntAll();
  }

  /** List stored notice/signature pairs in datetime order. */
  listNotices(start = 0, limit = 25): Array<[Notice, Cigar]> {
    const pairs: Array<[Notice, Cigar]> = [];
    let skipped = 0;

    for (const [[, rid], note] of this.notes.getTopItemIter()) {
      if (skipped < start) {
        skipped += 1;
        continue;
      }
      const cigar = this.ncigs.get([rid]);
      if (!cigar) {
        continue;
      }
      pairs.push([note, cigar]);
      if (limit >= 0 && pairs.length >= limit) {
        break;
      }
    }

    return pairs;
  }
}

/** Open a notification sidecar and return the ready-to-use databaser. */
export function* createNoter(
  options: NoterOptions = {},
): Operation<Noter> {
  const noter = new Noter(options);
  const opened = yield* noter.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Noter");
  }
  return noter;
}
