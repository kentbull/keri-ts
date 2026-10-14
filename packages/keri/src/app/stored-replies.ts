/** Finite stored endpoint-reply reconstruction; current proof rows are borrowed only during this synchronous call. */
import { b, Cigar, Diger, Prefixer, ResourceLimitError, SerderKERI } from "cesr-ts";
import { attachmentCounterQb64b, resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import type { AttachmentCounterName } from "../core/attachment-countering.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { messagize } from "../core/protocol-serialization.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";

/** Configurable local ceilings, independent of protocol validity or a shared runtime budget. */
export interface StoredReplyLimits {
  maxMessageBytes?: number;
  maxProofRows?: number;
}

/**
 * Rebuild one persisted reply with the existing TS newest-group/cigar/raw fallback.
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
    const prefix = keys[1], digest = keys[3];
    if (!prefix || !digest) continue;
    const event = db.getValBounded(db.evts.sdb, dgKey(prefix, digest), maxBytes);
    const ordinal = event ? new SerderKERI({ raw: event }).sner : null;
    if (!ordinal) continue;
    const key = `${prefix}.${ordinal.qb64}.${digest}`;
    let group = groups.get(key);
    if (!group) {
      group = new TransIdxSigGroup(new Prefixer({ qb64: prefix }), ordinal, new Diger({ qb64: digest }), []);
      groups.set(key, group);
    }
    group.sigers.push(siger);
  }
  let lead: TransIdxSigGroup | undefined;
  for (const group of groups.values()) {
    if (!lead || group.sn > lead.sn) lead = group;
  }
  const gvrsn = resolveAttachmentGvrsn(serder);
  // Use the same counter codex/count rules as messagize, without constructing its proof payload.
  const counterSize = (name: AttachmentCounterName, count: number, bytes: number): number =>
    attachmentCounterQb64b(name, gvrsn.major >= 2 ? bytes / 4 : count, gvrsn).length;
  const requireWire = (footerBytes: number) => {
    const framedBytes = raw.length + footerBytes
      + attachmentCounterQb64b("AttachmentGroup", footerBytes / 4, gvrsn).length;
    if (framedBytes > maxBytes) throw new ResourceLimitError("Stored reply exceeds message byte limit");
  };
  if (lead) {
    const sigBytes = lead.sigers.reduce((size, siger) => size + siger.qb64.length, 0);
    // Live seal encoding is the existing fixed-width Seqner, also when the event uses NumberPrimitive.
    const groupBytes = lead.prefixer.qb64.length + 24 + lead.diger.qb64.length + sigBytes
      + counterSize("ControllerIdxSigs", lead.sigers.length, sigBytes);
    requireWire(groupBytes + counterSize("TransIdxSigGroups", 1, groupBytes));
    return messagize(serder, {
      sigers: lead.sigers,
      seal: { i: lead.prefixer, s: lead.seqner, d: lead.diger },
      pipelined: true,
    });
  }
  const cigars: Cigar[] = [];
  let cigarBytes = 0;
  for (const tuple of db.scgs.getIter([said])) {
    const bytes = tuple[0].qb64.length + tuple[1].qb64.length;
    admit(bytes);
    cigarBytes += bytes;
    cigars.push(new Cigar(tuple[1], tuple[0]));
  }
  if (cigars.length) {
    requireWire(cigarBytes + counterSize("NonTransReceiptCouples", cigars.length, cigarBytes));
    return messagize(serder, { cigars, pipelined: true });
  }
  return serder.raw;
}
