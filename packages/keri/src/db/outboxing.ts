/**
 * Optional sender-side mailbox retry databaser.
 *
 * KERIpy correspondence:
 * - there is no direct KERIpy `Outboxer`; this is a Tufa-only additive sidecar
 *
 * Design rule:
 * - keep sender retry state separate from `Mailboxer`
 * - `Mailboxer` is recipient/provider inbox storage
 * - `Outboxer` is sender retry state for mailbox-target deliveries
 */
import { type Operation } from "npm:effection@^3.6.0";
import { DatabaseNotOpenError, ValidationError } from "../core/errors.ts";
import {
  OutboxMessageRecord,
  type OutboxMessageRecordShape,
  OutboxTargetRecord,
  type OutboxTargetRecordShape,
} from "../core/records.ts";
import { LMDBer, type LMDBerOptions } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";
import { Suber } from "./subing.ts";

/** Accepted key shapes for outbox subdb operations. */
type OutboxKeys = string | Uint8Array | Iterable<string | Uint8Array>;

/**
 * Open options for the sender retry sidecar.
 *
 * `compat` is intentionally rejected because KERIpy-compatible stores do not
 * model an outbox databaser.
 */
export interface OutboxerOptions extends LMDBerOptions {
  compat?: boolean;
}

/** One pending sender retry item paired with its current target state. */
export interface PendingOutboxEntry {
  said: string;
  message: OutboxMessageRecord;
  raw: Uint8Array;
  target: OutboxTargetRecord;
}

/**
 * Shared outbox contract used by both the real and disabled implementations.
 *
 * This lets the rest of the runtime treat retry support as optional without
 * leaking `if enabled` checks into every caller.
 */
export interface OutboxerLike {
  readonly enabled: boolean;
  /** Return the number of mailbox-target deliveries still waiting to retry. */
  pendingCount(): number;
  /** Iterate each mailbox-target delivery that is still pending. */
  iterPending(): Generator<PendingOutboxEntry>;
  /** Persist one logical outbound message and seed target rows for each mailbox. */
  queueMessage(
    said: string,
    raw: Uint8Array,
    message: OutboxMessageRecordShape,
    eids: Iterable<string>,
  ): void;
  /** Mark one mailbox target as delivered and prune the message if complete. */
  markDelivered(
    said: string,
    eid: string,
    deliveredAt: string,
  ): void;
  /** Record one failed attempt while keeping the target pending for retry. */
  markFailed(
    said: string,
    eid: string,
    attemptedAt: string,
    error: string,
  ): void;
  /** Cancel one mailbox target explicitly. */
  cancelTarget(
    said: string,
    eid: string,
    cancelledAt: string,
    error?: string,
  ): void;
  /** Cancel all pending targets for one mailbox AID. */
  cancelMailbox(eid: string, cancelledAt: string): void;
  /** Close the sidecar implementation. */
  close(clear?: boolean): Operation<boolean>;
}

/**
 * No-op outboxer used when the Tufa-only retry sidecar is disabled.
 *
 * The rest of the runtime still talks to the same interface, but no retry
 * state is persisted or replayed.
 */
export class DisabledOutboxer implements OutboxerLike {
  readonly enabled = false;

  pendingCount(): number {
    return 0;
  }

  *iterPending(): Generator<PendingOutboxEntry> {
    return;
  }

  queueMessage(
    _said: string,
    _raw: Uint8Array,
    _message: OutboxMessageRecordShape,
    _eids: Iterable<string>,
  ): void {}

  markDelivered(
    _said: string,
    _eid: string,
    _deliveredAt: string,
  ): void {}

  markFailed(
    _said: string,
    _eid: string,
    _attemptedAt: string,
    _error: string,
  ): void {}

  cancelTarget(
    _said: string,
    _eid: string,
    _cancelledAt: string,
    _error = "cancelled",
  ): void {}

  cancelMailbox(_eid: string, _cancelledAt: string): void {}

  *close(_clear = false): Operation<boolean> {
    return true;
  }
}

/** Raw-byte value family used for stored outbound message payloads. */
class BytesSuber extends Suber<Uint8Array> {
  protected override _ser(val: Uint8Array): Uint8Array {
    return new Uint8Array(val);
  }

  protected override _des(val: Uint8Array | null): Uint8Array | null {
    return val === null ? null : new Uint8Array(val);
  }
}

/**
 * Durable sender-side mailbox delivery retry storage.
 *
 * Storage model:
 * - `.msgs` stores the raw signed message by logical message SAID
 * - `.items` stores message metadata keyed by SAID
 * - `.tgts` stores per-mailbox-target delivery state keyed by `(said, eid)`
 */
export class Outboxer extends LMDBer implements OutboxerLike {
  readonly enabled = true;
  public msgs!: BytesSuber;
  public items!: Komer<OutboxMessageRecord>;
  public tgts!: Komer<OutboxTargetRecord>;

  /** Default primary path for Tufa-owned outbox environments. */
  static override readonly TailDirPath = "keri/obx";
  /** Default alternate path for Tufa-owned outbox environments. */
  static override readonly AltTailDirPath = ".tufa/obx";
  /** Unused compat path kept only to mirror `LMDBer` configuration shape. */
  static readonly CompatAltTailDirPath = ".keri/obx";
  static override readonly TempPrefix = "keri_obx_";
  static override readonly MaxNamedDBs = 8;

  constructor(options: OutboxerOptions = {}) {
    const compat = options.compat ?? false;
    super(options, {
      tailDirPath: Outboxer.TailDirPath,
      cleanTailDirPath: "keri/clean/obx",
      altTailDirPath: compat
        ? Outboxer.CompatAltTailDirPath
        : Outboxer.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/obx" : ".tufa/clean/obx",
      tempPrefix: Outboxer.TempPrefix,
      maxNamedDBs: Outboxer.MaxNamedDBs,
    });
  }

  override *reopen(
    options: Partial<OutboxerOptions> = {},
  ): Operation<boolean> {
    const opened = yield* super.reopen(options);
    if (!opened) {
      return false;
    }

    this.msgs = new BytesSuber(this, { subkey: "msgs." });
    this.items = new Komer(this, {
      subkey: "items.",
      recordClass: OutboxMessageRecord,
    });
    this.tgts = new Komer(this, {
      subkey: "tgts.",
      recordClass: OutboxTargetRecord,
    });
    return true;
  }

  /**
   * Persist one logical outbound message and seed per-mailbox-target state.
   *
   * The message SAID identifies the logical message, while target rows track
   * delivery independently per mailbox endpoint.
   */
  queueMessage(
    said: string,
    raw: Uint8Array,
    message: OutboxMessageRecordShape,
    eids: Iterable<string>,
  ): void {
    this.msgs.pin(said, raw);
    this.items.pin([said], message);
    for (const eid of eids) {
      this.tgts.pin([said, eid], {
        eid,
        status: "pending",
        attempts: 0,
        lastAttemptAt: null,
        deliveredAt: null,
        lastError: null,
      });
    }
  }

  /** Return the raw signed payload for one logical outbound message. */
  getMessage(said: string): Uint8Array | null {
    return this.msgs.get(said);
  }

  /** Return the metadata row for one logical outbound message. */
  getRecord(said: string): OutboxMessageRecord | null {
    return this.items.get([said]);
  }

  /** Return the per-target state row for one logical message and mailbox. */
  getTarget(said: string, eid: string): OutboxTargetRecord | null {
    return this.tgts.get([said, eid]);
  }

  /** Count mailbox-target rows that still need delivery work. */
  pendingCount(): number {
    let count = 0;
    for (const [, target] of this.tgts.getTopItemIter()) {
      if (target.status === "pending") {
        count += 1;
      }
    }
    return count;
  }

  /** Iterate each mailbox-target row that is still pending. */
  *iterPending(): Generator<PendingOutboxEntry> {
    for (const [keys, target] of this.tgts.getTopItemIter()) {
      const said = keys[0];
      const eid = keys[1];
      if (!said || !eid || target.status !== "pending") {
        continue;
      }
      const message = this.items.get([said]);
      const raw = this.msgs.get(said);
      if (!message || !raw) {
        continue;
      }
      yield {
        said,
        message,
        raw,
        target,
      };
    }
  }

  /**
   * Mark one mailbox target delivered and prune the parent message when all
   * targets are terminal.
   */
  markDelivered(
    said: string,
    eid: string,
    deliveredAt: string,
  ): void {
    this.pinTarget(said, eid, {
      status: "delivered",
      deliveredAt,
      lastAttemptAt: deliveredAt,
      lastError: null,
    });
    this.pruneIfComplete(said);
  }

  /**
   * Record one failed attempt while keeping the target pending for future
   * retry.
   */
  markFailed(
    said: string,
    eid: string,
    attemptedAt: string,
    error: string,
  ): void {
    const current = this.requireTarget(said, eid);
    this.tgts.pin([said, eid], {
      ...current.asDict(),
      eid,
      status: "pending",
      attempts: (current.attempts ?? 0) + 1,
      lastAttemptAt: attemptedAt,
      lastError: error,
    });
  }

  /**
   * Cancel one mailbox target explicitly.
   *
   * Cancellation is terminal and participates in message pruning once no
   * pending targets remain.
   */
  cancelTarget(
    said: string,
    eid: string,
    cancelledAt: string,
    error = "cancelled",
  ): void {
    this.pinTarget(said, eid, {
      status: "cancelled",
      lastAttemptAt: cancelledAt,
      lastError: error,
    });
    this.pruneIfComplete(said);
  }

  /** Cancel every pending target that points at one removed mailbox AID. */
  cancelMailbox(eid: string, cancelledAt: string): void {
    for (const [keys, target] of this.tgts.getTopItemIter()) {
      const said = keys[0];
      const targetEid = keys[1];
      if (!said || targetEid !== eid || target.status !== "pending") {
        continue;
      }
      this.cancelTarget(said, eid, cancelledAt, "mailbox removed");
    }
  }

  /** Remove the payload, metadata, and all target rows for one logical message. */
  removeMessage(said: string): void {
    this.msgs.rem(said);
    this.items.rem([said]);
    this.tgts.trim([said], { topive: true });
  }

  private pinTarget(
    said: string,
    eid: string,
    patch: Partial<OutboxTargetRecordShape>,
  ): void {
    const current = this.requireTarget(said, eid);
    this.tgts.pin([said, eid], {
      ...current.asDict(),
      ...patch,
      eid,
    });
  }

  private pruneIfComplete(said: string): void {
    let pending = false;
    for (const [, target] of this.tgts.getTopItemIter([said], { topive: true })) {
      if (target.status === "pending") {
        pending = true;
        break;
      }
    }
    if (!pending) {
      this.removeMessage(said);
    }
  }

  private requireTarget(said: string, eid: string): OutboxTargetRecord {
    const target = this.tgts.get([said, eid]);
    if (!target) {
      throw new DatabaseNotOpenError(
        `Missing outbox target state for ${said}:${eid}.`,
      );
    }
    return target;
  }
}

/** Open options for `createOutboxer()`, including existence enforcement. */
export interface CreateOutboxerOptions extends OutboxerOptions {
  mustExist?: boolean;
}

/**
 * Open the optional sender retry sidecar.
 *
 * Compatibility rule:
 * - compat mode is rejected because KERIpy stores do not model this additive
 *   domain
 * - `mustExist` is used by commands that require a previously initialized
 *   outbox sidecar instead of silently creating one
 */
export function* createOutboxer(
  options: CreateOutboxerOptions = {},
): Operation<Outboxer> {
  const { mustExist = false, ...openOptions } = options;
  if (openOptions.compat) {
    throw new ValidationError(
      "Outboxer is a tufa-only sidecar and is unavailable in compat mode.",
    );
  }

  const outboxer = new Outboxer(openOptions);
  if (mustExist) {
    const exists = yield* outboxer.reopen({
      ...openOptions,
      readonly: true,
    });
    if (!exists) {
      yield* outboxer.close();
      throw new ValidationError(
        "Outboxer is not enabled for this keystore. Re-run `tufa init --outboxer` to create it.",
      );
    }
    yield* outboxer.close();
  }

  const opened = yield* outboxer.reopen(openOptions);
  if (!opened) {
    yield* outboxer.close();
    throw new DatabaseNotOpenError("Failed to open Outboxer");
  }
  return outboxer;
}
