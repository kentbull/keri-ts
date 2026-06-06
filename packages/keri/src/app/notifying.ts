import { type Operation } from "npm:effection@^3.6.0";
import { type Cigar } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { createNoter, type Noter, type NoterOptions, Notice, type NoticeAttrs } from "../db/noting.ts";
import type { Habery } from "./habbing.ts";
import { Signaler } from "./signaling.ts";

export function notice<T extends NoticeAttrs = NoticeAttrs>(
  attrs: T,
  options: {
    dt?: string | Date;
    read?: boolean;
  } = {},
): Notice<T> {
  const dt = typeof options.dt === "string"
    ? options.dt
    : options.dt?.toISOString();
  return new Notice<T>({
    pad: {
      i: "",
      dt,
      r: options.read ?? false,
      a: attrs,
    },
  });
}

export function noterOptionsForHabery(
  hby: Habery,
  options: Partial<NoterOptions> = {},
): NoterOptions {
  return {
    name: hby.name,
    base: hby.base,
    temp: hby.temp,
    headDirPath: hby.headDirPath,
    compat: hby.compat,
    readonly: hby.readonly,
    reopen: true,
    ...options,
  };
}

export function* openNoterForHabery(
  hby: Habery,
  options: Partial<NoterOptions> = {},
): Operation<Noter> {
  return yield* createNoter(noterOptionsForHabery(hby, options));
}

/**
 * Signed durable controller notifications with transient `/notification` pings.
 */
export class Notifier {
  readonly hby: Habery;
  readonly noter: Noter;
  readonly signaler: Signaler;

  constructor(
    hby: Habery,
    {
      noter,
      signaler,
    }: {
      noter: Noter;
      signaler?: Signaler;
    },
  ) {
    this.hby = hby;
    this.noter = noter;
    this.signaler = signaler ?? new Signaler();
  }

  add<T extends NoticeAttrs = NoticeAttrs>(attrs: T): boolean {
    const signator = this.requireSignator();
    const note = notice(attrs);
    const cigar = signator.sign(note.raw);
    if (!this.noter.add(note, cigar)) {
      return false;
    }

    this.emitSignal("add", note);
    return true;
  }

  list<T extends NoticeAttrs = NoticeAttrs>(
    start = 0,
    limit = 25,
  ): Notice<T>[] {
    return this.noter.listNotices(start, limit).map(([note, cigar]) =>
      this.requireVerifiedNotice(note as Notice<T>, cigar)
    );
  }

  count(): number {
    return this.noter.countNotices();
  }

  markRead(rid: string): boolean {
    const [note] = this.requireNoticePair(rid);
    if (note.read) {
      return false;
    }

    const signator = this.requireSignator();
    note.read = true;
    const cigar = signator.sign(note.raw);
    if (!this.noter.update(note, cigar)) {
      return false;
    }

    this.emitSignal("mar", note);
    return true;
  }

  remove(rid: string): boolean {
    const [note] = this.requireNoticePair(rid);
    if (!this.noter.removeNotice(rid)) {
      return false;
    }

    this.emitSignal("rem", note);
    return true;
  }

  private emitSignal(action: "add" | "mar" | "rem", note: Notice): void {
    this.signaler.push(
      {
        action,
        dt: new Date().toISOString(),
        note: note.asDict(),
      },
      "/notification",
      { ckey: "/notification" },
    );
  }

  private requireNoticePair(rid: string): [Notice, Cigar] {
    const pair = this.noter.getNotice(rid);
    if (!pair) {
      throw new ValidationError(`No notification exists for rid ${rid}.`);
    }
    const [note, cigar] = pair;
    return [this.requireVerifiedNotice(note, cigar), cigar];
  }

  private requireVerifiedNotice<T extends NoticeAttrs = NoticeAttrs>(
    note: Notice<T>,
    cigar: Cigar,
  ): Notice<T> {
    const signator = this.requireSignator();
    if (!signator.verify(note.raw, cigar)) {
      throw new ValidationError(
        `Notification ${note.rid} failed signator verification.`,
      );
    }
    return note;
  }

  private requireSignator() {
    if (!this.hby.signator) {
      throw new ValidationError(
        "Notifications require an available habery signator.",
      );
    }
    return this.hby.signator;
  }
}
