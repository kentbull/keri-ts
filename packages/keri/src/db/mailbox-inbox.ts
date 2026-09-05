import { Buffer } from "node:buffer";
import { Diger } from "../../../cesr/mod.ts";
import { RawRecord, type TopicsRecord } from "../core/records.ts";
import type { LMDBer } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";

/** Expected admission failures that callers can route without parsing diagnostic text. */
export type MailboxAdmissionFailureKind = "capacity" | "conflict" | "gap" | "invalid-input";
/** Transport policy failure; corrupt durable state and database failures remain invariant errors. */
export class MailboxAdmissionError extends Error {
  constructor(readonly kind: MailboxAdmissionFailureKind, message: string) {
    super(message);
    this.name = "MailboxAdmissionError";
  }
}
/** Stable transport identity; acknowledgment never follows from parser return alone. */
export interface MailboxDelivery {
  id: string;
  pre: string;
  eid: string;
  topic: string;
  idx: number;
  digest: string;
}
/** Versioned retained bytes and operator metadata; never an application completion receipt. */
export interface MailboxInboxRecordShape extends MailboxDelivery {
  version: 1;
  payload: string;
  size: number;
  receivedAt: string;
  state: "pending" | "deadletter";
  reason?: string;
}
/** Persisted consumer inbox row, distinct from provider-side mailbox storage. */
class MailboxInboxRecord extends RawRecord<MailboxInboxRecordShape> implements MailboxInboxRecordShape {
  declare version: 1;
  declare id: string;
  declare pre: string;
  declare eid: string;
  declare topic: string;
  declare idx: number;
  declare digest: string;
  declare payload: string;
  declare size: number;
  declare receivedAt: string;
  declare state: "pending" | "deadletter";
  declare reason?: string;
}
/** Resource limits apply before committing any cursor from a fetched batch. */
export interface MailboxInboxLimits {
  maxRecordBytes: number;
  maxBatchBytes: number;
  maxBatchRecords: number;
  maxRetainedBytes: number;
  maxRetainedRecords: number;
}
export const DEFAULT_MAILBOX_INBOX_LIMITS: Readonly<MailboxInboxLimits> = Object.freeze({
  maxRecordBytes: 4 * 1024 * 1024,
  maxBatchBytes: 16 * 1024 * 1024,
  maxBatchRecords: 256,
  maxRetainedBytes: 64 * 1024 * 1024,
  maxRetainedRecords: 4096,
});
/** Atomic transport admission, retained replay and explicit consumer disposition in one Baser env. */
export class MailboxInbox {
  private readonly rows: Komer<MailboxInboxRecord>;
  constructor(private db: LMDBer, private tops: Komer<TopicsRecord>) {
    this.rows = new Komer(db, { subkey: "mbin.", recordClass: MailboxInboxRecord });
  }
  /** Snapshot retained pending records; deadletters require explicit inspection/disposition. */
  pending(
    options: { pre?: string; eid?: string; topics?: ReadonlySet<string>; exclude?: ReadonlySet<string> } = {},
  ): Array<{ delivery: MailboxDelivery; msg: Uint8Array }> {
    return this.readRows().filter(([, row]) =>
      row.state === "pending" && (!options.pre || row.pre === options.pre) && (!options.eid || row.eid === options.eid)
      && (!options.topics || options.topics.has(row.topic)) && !options.exclude?.has(row.id)
    ).sort(([, a], [, b]) =>
      a.pre.localeCompare(b.pre) || a.eid.localeCompare(b.eid) || a.topic.localeCompare(b.topic) || a.idx - b.idx
    ).map(([, row]) => ({
      delivery: this.identity(row),
      msg: this.decode(row),
    }));
  }
  /** Admit exact source bytes and tops together; failed admission leaves both unchanged. */
  admit(
    pre: string,
    eid: string,
    messages: readonly { topic: string; idx: number; msg: Uint8Array }[],
    limits: MailboxInboxLimits = DEFAULT_MAILBOX_INBOX_LIMITS,
  ): MailboxDelivery[] {
    for (const value of Object.values(limits)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new MailboxAdmissionError("invalid-input", "Invalid mailbox inbox limit");
      }
    }
    if (!/^[A-Za-z0-9_-]+$/.test(pre) || !/^[A-Za-z0-9_-]+$/.test(eid) || pre.length > 512 || eid.length > 512) {
      throw new MailboxAdmissionError("invalid-input", "Invalid mailbox source");
    }
    if (messages.length > limits.maxBatchRecords) {
      throw new MailboxAdmissionError("capacity", "Mailbox batch record limit");
    }
    let batchBytes = 0;
    const prepared = messages.map(({ topic, idx, msg }) => {
      if (!topic || topic.length > 256 || !Number.isSafeInteger(idx) || idx < 0) {
        throw new MailboxAdmissionError("invalid-input", "Invalid mailbox ordinal/topic");
      }
      if (msg.length > limits.maxRecordBytes) throw new MailboxAdmissionError("capacity", "Mailbox record byte limit");
      batchBytes += msg.length;
      if (batchBytes > limits.maxBatchBytes) throw new MailboxAdmissionError("capacity", "Mailbox batch byte limit");
      const id = new Diger({
        code: "E",
        raw: Diger.digest(new TextEncoder().encode(JSON.stringify([pre, eid, topic, idx])), "E"),
      }).qb64;
      return {
        version: 1 as const,
        id,
        pre,
        eid,
        topic,
        idx,
        digest: new Diger({ code: "E", raw: Diger.digest(msg, "E") }).qb64,
        payload: Buffer.from(msg).toString("base64"),
        size: msg.length,
        receivedAt: new Date().toISOString(),
        state: "pending" as const,
      };
    });
    if (!this.db.env) throw new Error("Mailbox inbox database closed");
    return this.db.env.transactionSync(() => {
      const existingRows = this.readRows();
      let count = existingRows.length, bytes = existingRows.reduce((n, [, row]) => n + row.size, 0);
      const topics = { ...(this.tops.get([pre, eid])?.topics ?? {}) };
      const admitted: MailboxDelivery[] = [];
      for (const row of prepared) {
        const prior = this.rows.get([row.id]);
        if (prior) {
          this.validate(prior, row.id);
          if (prior.digest !== row.digest || prior.payload !== row.payload) {
            throw new MailboxAdmissionError("conflict", "Conflicting mailbox source bytes");
          }
          admitted.push(this.identity(prior));
          continue;
        }
        if (row.idx !== (Object.hasOwn(topics, row.topic) ? topics[row.topic] : -1) + 1) {
          throw new MailboxAdmissionError("gap", "Mailbox ordinal is disposed, reordered or leaves a gap");
        }
        if (++count > limits.maxRetainedRecords || (bytes += row.size) > limits.maxRetainedBytes) {
          throw new MailboxAdmissionError("capacity", "Mailbox retained inbox capacity");
        }
        this.rows.put([row.id], row);
        Object.defineProperty(topics, row.topic, {
          value: row.idx,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        admitted.push(this.identity(row));
      }
      this.tops.pin([pre, eid], { topics });
      return admitted;
    });
  }
  /** Explicit durable consumer transfer deletes bytes; poison records remain bounded deadletters. */
  dispose(delivery: MailboxDelivery, disposition: { kind: "acknowledged" | "deadletter"; reason: string }): void {
    if (
      !disposition.reason || disposition.reason.length > 256
      || !["acknowledged", "deadletter"].includes(disposition.kind)
    ) throw new Error("Explicit mailbox disposition required");
    if (!this.db.env) throw new Error("Mailbox inbox database closed");
    this.db.env.transactionSync(() => {
      const row = this.rows.get([delivery.id]);
      if (row) {
        this.validate(row, delivery.id);
        this.decode(row);
      }
      if (!row || JSON.stringify(this.identity(row)) !== JSON.stringify(this.identity(delivery))) {
        throw new Error("Mailbox delivery identity mismatch");
      }
      if (disposition.kind === "acknowledged") this.rows.rem([delivery.id]);
      else this.rows.pin([delivery.id], { ...row.asDict(), state: "deadletter", reason: disposition.reason });
    });
  }
  /** Inspect retained metadata including deadletters without inferring application completion. */
  retained(): MailboxInboxRecordShape[] {
    return this.readRows().map(([, row]) => {
      this.decode(row);
      return row;
    });
  }
  private readRows(): Array<[string[], MailboxInboxRecord]> {
    return [...this.rows.getTopItemIter()].map(([keys, row]) => {
      this.validate(row, keys[0]);
      return [keys, row];
    });
  }
  private validate(row: MailboxInboxRecord, id: string): void {
    if (
      row.version !== 1 || !["pending", "deadletter"].includes(row.state)
      || !Number.isSafeInteger(row.size) || row.size < 0
      || typeof row.payload !== "string" || row.payload.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.payload)
      || row.payload.length / 4 * 3 - (row.payload.endsWith("==") ? 2 : row.payload.endsWith("=") ? 1 : 0) !== row.size
      || typeof row.pre !== "string" || !/^[A-Za-z0-9_-]+$/.test(row.pre) || row.pre.length > 512
      || typeof row.eid !== "string" || !/^[A-Za-z0-9_-]+$/.test(row.eid) || row.eid.length > 512
      || typeof row.topic !== "string" || !row.topic || row.topic.length > 256
      || !Number.isSafeInteger(row.idx) || row.idx < 0
      || typeof row.digest !== "string" || typeof row.receivedAt !== "string" || row.receivedAt.length > 64
      || !Number.isFinite(Date.parse(row.receivedAt))
      || (row.state === "deadletter" && (typeof row.reason !== "string" || !row.reason || row.reason.length > 256))
    ) {
      throw new Error("Invalid or unsupported mailbox inbox record");
    }
    const expected = new Diger({
      code: "E",
      raw: Diger.digest(new TextEncoder().encode(JSON.stringify([row.pre, row.eid, row.topic, row.idx])), "E"),
    }).qb64;
    if (row.id !== id || row.id !== expected) throw new Error("Mailbox inbox source identity corruption");
    const digest = new Diger({ qb64: row.digest });
    if (digest.code !== "E" || digest.qb64 !== row.digest) throw new Error("Invalid mailbox inbox digest");
  }
  private decode(row: MailboxInboxRecord): Uint8Array {
    const bytes = new Uint8Array(Buffer.from(row.payload, "base64"));
    if (Buffer.from(bytes).toString("base64") !== row.payload || !new Diger({ qb64: row.digest }).verify(bytes)) {
      throw new Error("Mailbox inbox payload corruption");
    }
    return bytes;
  }
  private identity(row: MailboxDelivery): MailboxDelivery {
    return { id: row.id, pre: row.pre, eid: row.eid, topic: row.topic, idx: row.idx, digest: row.digest };
  }
}
