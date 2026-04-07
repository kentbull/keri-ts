/**
 * Dedicated mailbox databaser.
 *
 * This is the provider-side durable inbox store used by mailbox relays:
 * - ordered topic indices live in `.tpcs`
 * - raw payload bytes live in `.msgs`
 *
 * KERIpy correspondence:
 * - ports the `Mailboxer` concept and storage surface from
 *   `keri.app.storing`
 *
 * Current `keri-ts` difference:
 * - runtime polling, query streaming, and HTTP serving live elsewhere, but
 *   they all treat this module as the single source of mailbox payload truth
 */
import { type Operation } from "npm:effection@^3.6.0";
import { Diger, MtrDex } from "../../../cesr/mod.ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { CesrOnSuber, Suber } from "./subing.ts";

/** Accepted topic key shapes for the mailbox ordering store. */
type MailboxKeys = string | Uint8Array | Iterable<string | Uint8Array>;

/**
 * Options for opening the dedicated mailbox environment.
 *
 * `compat` selects the KERIpy-compatible alternate path layout when opening
 * external stores.
 */
export interface MailboxerOptions extends LMDBerOptions {
  compat?: boolean;
}

/** Raw-byte value family used for stored mailbox message bodies. */
class BytesSuber extends Suber<Uint8Array> {
  protected override _ser(val: Uint8Array): Uint8Array {
    return new Uint8Array(val);
  }

  protected override _des(val: Uint8Array | null): Uint8Array | null {
    return val === null ? null : new Uint8Array(val);
  }
}

/**
 * Dedicated mailbox storage environment.
 *
 * Responsibilities:
 * - index topic ordering in `.tpcs`
 * - deduplicate stored mailbox payloads by digest in `.msgs`
 * - provide the KERIpy mailbox retrieval surface used by forwarding and
 *   mailbox-stream HTTP handling
 *
 * Storage model:
 * - `.tpcs` stores `(topic, on) -> digest`
 * - `.msgs` stores `digest -> raw message bytes`
 */
export class Mailboxer extends LMDBer {
  public tpcs!: CesrOnSuber<Diger>;
  public msgs!: BytesSuber;

  /** Default primary path for Tufa-owned mailbox environments. */
  static override readonly TailDirPath = "keri/mbx";
  /** Default alternate path for Tufa-owned mailbox environments. */
  static override readonly AltTailDirPath = ".tufa/mbx";
  /** Alternate path used when opening KERIpy-compatible mailbox stores. */
  static readonly CompatAltTailDirPath = ".keri/mbx";
  static override readonly TempPrefix = "keri_mbx_";
  static override readonly MaxNamedDBs = 8;

  constructor(options: MailboxerOptions = {}) {
    const compat = options.compat ?? false;
    super(options, {
      tailDirPath: Mailboxer.TailDirPath,
      cleanTailDirPath: "keri/clean/mbx",
      altTailDirPath: compat
        ? Mailboxer.CompatAltTailDirPath
        : Mailboxer.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/mbx" : ".tufa/clean/mbx",
      tempPrefix: Mailboxer.TempPrefix,
      maxNamedDBs: Mailboxer.MaxNamedDBs,
    });
  }

  /**
   * Reopen the mailbox environment and bind the KERIpy-shaped named subdbs.
   */
  override *reopen(
    options: Partial<MailboxerOptions> = {},
  ): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) {
      return false;
    }

    this.tpcs = new CesrOnSuber(this, { subkey: "tpcs.", ctor: Diger });
    this.msgs = new BytesSuber(this, { subkey: "msgs." });
    return true;
  }

  /**
   * Remove one topic ordinal index without deleting the deduplicated message.
   *
   * This mirrors KERIpy's separation between topic ordering and raw message
   * storage. Removing the ordinal mapping does not garbage-collect `.msgs`.
   */
  delTopic(key: MailboxKeys, on = 0): boolean {
    return this.tpcs.remOn(key, on);
  }

  /**
   * Append one message digest to the next ordinal slot for a topic.
   *
   * The ordinal returned here becomes the mailbox event id later exposed to
   * `mbx` query streams.
   */
  appendToTopic(topic: MailboxKeys, val: Diger): number {
    return this.tpcs.appendOn(topic, val);
  }

  /**
   * Materialize mailbox payloads for one topic from ordinal `fn` onward.
   *
   * This helper is intentionally payload-focused: callers that also need the
   * mailbox indices should use `cloneTopicIter()`.
   */
  getTopicMsgs(topic: MailboxKeys, fn = 0): Uint8Array[] {
    const msgs: Uint8Array[] = [];
    for (const [, , dig] of this.tpcs.getAllItemIter(topic, fn)) {
      const msg = this.msgs.get(dig.qb64);
      if (msg) {
        msgs.push(msg);
      }
    }
    return msgs;
  }

  /**
   * Store one raw mailbox payload and append its digest to the topic index.
   *
   * The message is deduplicated by digest in `.msgs`, but the topic index still
   * records each ordered appearance in `.tpcs`.
   */
  storeMsg(topic: MailboxKeys, msg: Uint8Array | string): boolean {
    const raw = typeof msg === "string" ? new TextEncoder().encode(msg) : msg;
    const dig = new Diger({
      raw: Diger.digest(raw, MtrDex.Blake3_256),
      code: MtrDex.Blake3_256,
    });
    this.appendToTopic(topic, dig);
    return this.msgs.pin(dig.qb64, raw);
  }

  /**
   * Iterate `(on, topic, msg)` triples from ordinal `fn` onward.
   *
   * This is the storage primitive used by mailbox SSE streaming so the caller
   * can preserve both payload bytes and the ordered mailbox event id.
   */
  *cloneTopicIter(
    topic: MailboxKeys,
    fn = 0,
  ): Generator<[number, string, Uint8Array]> {
    for (const [keys, on, dig] of this.tpcs.getAllItemIter(topic, fn)) {
      const msg = this.msgs.get(dig.qb64);
      if (!msg) {
        continue;
      }
      yield [on, keys[0] ?? "", msg];
    }
  }
}

/**
 * Open a mailbox environment and return the ready-to-use databaser.
 *
 * Compatibility rule:
 * - explicit mailbox opens stay strict
 * - missing additive sidecars are tolerated only by higher-level habery open
 *   flows that are inspecting compat stores readonly
 */
export function* createMailboxer(
  options: MailboxerOptions = {},
): Operation<Mailboxer> {
  const mailboxer = new Mailboxer(options);
  const opened = yield* mailboxer.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Mailboxer");
  }
  return mailboxer;
}
