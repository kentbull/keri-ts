/** Finite stored endpoint-reply reconstruction; current proof rows are borrowed only during this synchronous call. */
import { Cigar, Diger, Prefixer, Seqner, type Versionage } from "cesr-ts";
import { resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { messagize } from "../core/protocol-serialization.ts";
import type { Baser } from "../db/basing.ts";

/**
 * Rebuild one persisted reply with all stored groups and exactly one optional cigar.
 *
 * Missing bodies return empty bytes. Stored groups preserve key order; attachment
 * framing and validation belong to the shared serializer.
 */
export function loadStoredReply(db: Baser, said: string, gvrsn?: Versionage): Uint8Array {
  const serder = db.rpys.get([said]);
  if (!serder) return new Uint8Array();
  const groups = new Map<string, TransIdxSigGroup>();
  for (const [keys, siger] of db.ssgs.getTopItemIter([said], { topive: true })) {
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
  const cigars: Cigar[] = [];
  for (const tuple of db.scgs.getIter([said])) {
    cigars.push(new Cigar(tuple[1], tuple[0]));
  }
  const selectedCigars = cigars.length === 1 ? cigars : [];
  return messagize(serder, {
    tsgs: ordered,
    cigars: selectedCigars,
    pipelined: true,
    gvrsn: resolveAttachmentGvrsn(serder, gvrsn),
  });
}
