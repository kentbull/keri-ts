/** Internal finite cache maintenance; each synchronous batch excludes live handoff owners. */
import { b } from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { removeKramFactors } from "../db/kram-factors.ts";
import { removeKramSnapshot } from "../db/kram-snapshots.ts";
import { timestampMicros } from "../time/mod.ts";
import { isKramHandoffActive } from "./kram-handoff.ts";
import type { KramPolicy } from "./kram-policy.ts";
import { kramCacheValues } from "./kram-time.ts";
import { TxnMsgCacheRecord } from "./records.ts";

/** Counts scan steps across all families; tail/empty family probes use constant additional work. */
export interface KramPruneResult {
  kind: "pruned" | "busy";
  visited: number;
  removed: number;
  openers: number;
  passComplete: boolean;
}
/** One finite physical-key range; no LMDB iterator survives a read. */
interface Scan {
  start?: Uint8Array;
  end?: Uint8Array;
  initialized?: boolean;
}

/** Prune stored windows, then prove orphan XIDs with restartable finite existence scans. */
export class KramPruner {
  private env: Baser["env"] = null;
  private phase = 0;
  private scans: Scan[] = [{}, {}, {}];
  private orphan?: { xid: string; physical: Uint8Array; scan: Scan; version: number };

  constructor(readonly db: Baser, readonly policy: KramPolicy) {
    if (policy.db !== db) throw new Error("KRAM pruning policy must use its backing store");
  }

  /** Use committed environment state, never assume transaction IDs increment by one. */
  private version(): number {
    const version = (this.db.env!.getStats() as { lastTxnId?: number }).lastTxnId;
    if (!Number.isSafeInteger(version) || version! < 0) throw new Error("Invalid KRAM pruning transaction ID");
    return version!;
  }

  /** Capture a finite horizon and release each tail/next iterator before returning. */
  private next(family: number, scan: Scan): Uint8Array | undefined {
    const table = [this.db.msgc, this.db.tmsc, this.db.xdt][family];
    if (!scan.initialized) {
      for (const key of table.sdb.getKeys({ reverse: true, limit: 1 })) scan.end = this.after(key);
      scan.initialized = true;
    }
    if (scan.end) {
      for (const key of table.sdb.getKeys({ start: scan.start, end: scan.end, limit: 1 })) return key.slice();
    }
  }

  /** Qualified cache components contain no NUL, so this seeks strictly after a complete key. */
  private after(key: Uint8Array): Uint8Array {
    return b(`${new TextDecoder("utf-8", { fatal: true }).decode(key)}\0`);
  }

  /** Reject malformed physical cache keys rather than accidentally deleting another owner. */
  private keys(key: Uint8Array, count: number): string[] {
    const keys = new TextDecoder("utf-8", { fatal: true }).decode(key).split(".");
    if (keys.length !== count || keys.some((value) => !value || value.includes("\0"))) {
      throw new Error("Corrupt KRAM pruning key");
    }
    return keys;
  }

  /** Inclusive cache inequalities retain K2 precision instead of truncating fractional milliseconds. */
  private expired(record: Parameters<typeof kramCacheValues>[0], when: bigint): boolean {
    const values = kramCacheValues(record);
    if (record instanceof TxnMsgCacheRecord) {
      const opener = timestampMicros(record.xdt)!;
      return when < opener || when > opener + BigInt(values.pxl) * 1000n;
    }
    const message = timestampMicros(values.mdt)!;
    return message < when - (BigInt(values.d) + BigInt(values.pml)) * 1000n
      || message > when + BigInt(values.d) * 1000n;
  }

  /**
   * Advance one finite pass without yielding or holding read cursors across writes.
   * Cached TTLs own expiry; idle ready state expires with its cache. Orphan scans
   * restart on any committed change, so unrelated writes can postpone cleanup.
   * Reopen restarts all checkpoints; insertion behind a cache cursor is seen next pass.
   */
  prune(receiverTime: string, maxRows = 128): KramPruneResult {
    const when = timestampMicros(receiverTime);
    if (when === null) throw new Error("Invalid KRAM pruning receiver clock");
    if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new RangeError("Invalid KRAM pruning batch");
    const result: KramPruneResult = { kind: "pruned", visited: 0, removed: 0, openers: 0, passComplete: false };
    if (isKramHandoffActive(this.db)) return { ...result, kind: "busy" };
    const env = this.db.env;
    if (!env) throw new Error("KRAM pruning database is closed");
    if (this.env !== env) {
      this.env = env;
      this.phase = 0;
      this.scans = [{}, {}, {}];
      this.orphan = undefined;
    }
    this.policy.reconcile();
    env.resetReadTxn();
    while (result.visited < maxRows) {
      if (this.phase < 2) {
        const scan = this.scans[this.phase], physical = this.next(this.phase, scan);
        if (!physical) {
          this.phase++;
          continue;
        }
        const keys = this.keys(physical, this.phase + 2), table = this.phase ? this.db.tmsc : this.db.msgc;
        if (isKramHandoffActive(this.db)) return { ...result, kind: "busy" };
        env.transactionSync(() => {
          const record = table.get(keys);
          if (!record || !this.expired(record, when)) return;
          table.rem(keys);
          const partial = [keys[0], keys.at(-1)!];
          removeKramFactors(this.db, partial);
          removeKramSnapshot(this.db, partial);
          this.db.kready.rem(partial);
          result.removed++;
        });
        scan.start = this.after(physical);
        result.visited++;
        continue;
      }
      if (!this.orphan) {
        const physical = this.next(2, this.scans[2]);
        if (!physical) {
          this.phase = 0;
          this.scans = [{}, {}, {}];
          result.passComplete = true;
          return result;
        }
        const [xid] = this.keys(physical, 1);
        this.db.xdt.get(xid); // Deserialization failures remain corruption, not an absent opener.
        this.orphan = { xid, physical, scan: {}, version: this.version() };
        result.visited++;
        continue;
      }
      const candidate = this.orphan, version = this.version();
      if (candidate.version !== version) {
        candidate.scan = {};
        candidate.version = version;
      }
      // Capture committed version before opening a fresh read snapshot, including other-process writes.
      env.resetReadTxn();
      const physical = this.next(1, candidate.scan);
      if (physical) {
        const keys = this.keys(physical, 3);
        candidate.scan.start = this.after(physical);
        result.visited++;
        if (keys[1] !== candidate.xid) continue;
      } else {
        result.visited++;
        if (isKramHandoffActive(this.db)) return { ...result, kind: "busy" };
        const removed = env.transactionSync(() => {
          if (candidate.version !== this.version()) return false;
          if (this.db.xdt.rem(candidate.xid)) result.openers++;
          return true;
        });
        if (!removed) {
          candidate.scan = {};
          candidate.version = this.version();
          continue;
        }
      }
      this.scans[2].start = this.after(candidate.physical);
      this.orphan = undefined;
    }
    return result;
  }
}
