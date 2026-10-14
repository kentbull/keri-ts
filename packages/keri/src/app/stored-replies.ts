/** Finite stored endpoint-reply reconstruction; current proof rows are borrowed only during this synchronous call. */
import { b, Cigar, Diger, Prefixer, ResourceLimitError, Seqner, SerderKERI, type Versionage } from "cesr-ts";
import { attachmentCounterQb64b, resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import type { AttachmentCounterName } from "../core/attachment-countering.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { messagize } from "../core/protocol-serialization.ts";
import type { Baser } from "../db/basing.ts";

/** Configurable local ceilings, independent of protocol validity or a shared runtime budget. */
export interface StoredReplyLimits {
  maxMessageBytes?: number;
  maxProofRows?: number;
  /** Attachment genus floor; the body can raise it, matching live serialization. */
  gvrsn?: Versionage;
}

/**
 * Rebuild one persisted reply with all stored groups and exactly one optional cigar.
 *
 * Missing bodies return empty bytes. Limit refusals precede retention growth or final
 * serialization; native proof decoding/copy admission remains a separate boundary.
 */
export function loadStoredReply(db: Baser, said: string, limits: StoredReplyLimits = {}): Uint8Array {
  const maxBytes = limits.maxMessageBytes ?? 8 * 1024 * 1024;
  const maxRows = limits.maxProofRows ?? 4096;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxRows) || maxRows < 0) {
    throw new RangeError("Invalid stored reply limits");
  }
  const raw = db.getValBounded(db.rpys.sdb, b(said), maxBytes);
  if (!raw) return new Uint8Array();
  const serder = new SerderKERI({ raw });
  let rows = 0, retainedBytes = raw.length;
  const admit = (bytes: number) => {
    if (++rows > maxRows || bytes > maxBytes - retainedBytes) {
      throw new ResourceLimitError("Stored reply exceeds proof retention limits");
    }
    retainedBytes += bytes;
  };
  const groups = new Map<string, TransIdxSigGroup>();
  for (const [keys, siger] of db.ssgs.getTopItemIter([said], { topive: true })) {
    admit(siger.qb64.length);
    const prefix = keys[1], snh = keys[2], digest = keys[3];
    if (keys.length !== 4 || !prefix || !digest || !/^[0-9a-f]{1,32}$/.test(snh ?? "")) {
      throw new DatabaseOperationError("Corrupt stored reply group key");
    }
    // Actual 714 fetchTsgs reconstructs stored seals in key order, without reopening establishment bodies.
    const ordinal = new Seqner({
      code: "0A",
      raw: Uint8Array.from(snh.padStart(32, "0").match(/../g)!, (pair) => Number.parseInt(pair, 16)),
    });
    const key = `${prefix}.${snh}.${digest}`;
    let group = groups.get(key);
    if (!group) {
      group = new TransIdxSigGroup(new Prefixer({ qb64: prefix }), ordinal, new Diger({ qb64: digest }), []);
      groups.set(key, group);
    }
    group.sigers.push(siger);
  }
  // Existing TS rows use compact hex. Canonical ordering matches 714 fixed-width keys without rewriting storage.
  const orderKey = (group: TransIdxSigGroup) => `${group.pre}.${group.snh.padStart(32, "0")}.${group.said}`;
  const ordered = [...groups.values()].sort((left, right) => {
    const a = orderKey(left), b = orderKey(right);
    return a < b ? -1 : a > b ? 1 : 0; // Stable raw-key ties preserve distinct original groups.
  });
  const gvrsn = resolveAttachmentGvrsn(serder, limits.gvrsn);
  // Use the same counter codex/count rules as messagize, without constructing its proof payload.
  const counterSize = (name: AttachmentCounterName, count: number, bytes: number): number =>
    attachmentCounterQb64b(name, gvrsn.major >= 2 ? bytes / 4 : count, gvrsn).length;
  const requireWire = (footerBytes: number) => {
    const framedBytes = raw.length + footerBytes
      + attachmentCounterQb64b("AttachmentGroup", footerBytes / 4, gvrsn).length;
    if (framedBytes > maxBytes) throw new ResourceLimitError("Stored reply exceeds message byte limit");
  };
  let groupBytes = 0;
  for (const group of groups.values()) {
    const sigBytes = group.sigers.reduce((size, siger) => size + siger.qb64.length, 0);
    groupBytes += group.prefixer.qb64.length + group.seqner.qb64.length + group.diger.qb64.length + sigBytes
      + counterSize("ControllerIdxSigs", group.sigers.length, sigBytes);
  }
  const transferBytes = groups.size ? groupBytes + counterSize("TransIdxSigGroups", groups.size, groupBytes) : 0;
  const cigars: Cigar[] = [];
  let cigarBytes = 0;
  for (const tuple of db.scgs.getIter([said])) {
    const bytes = tuple[0].qb64.length + tuple[1].qb64.length;
    admit(bytes);
    cigarBytes += bytes;
    cigars.push(new Cigar(tuple[1], tuple[0]));
  }
  const selectedCigars = cigars.length === 1 ? cigars : [];
  const cigarFooter = selectedCigars.length ? cigarBytes + counterSize("NonTransReceiptCouples", 1, cigarBytes) : 0;
  if (groups.size || selectedCigars.length) requireWire(transferBytes + cigarFooter);
  return messagize(serder, { tsgs: ordered, cigars: selectedCigars, pipelined: true, gvrsn });
}
