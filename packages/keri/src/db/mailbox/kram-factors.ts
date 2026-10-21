/** Durable KRAM factors preserve proof ownership; callers own authentication and atomic publication. */
import {
  BlindState,
  BoundState,
  byteString,
  Cigar,
  Diger,
  FirstSeen,
  NumberPrimitive,
  SealEvent,
  SealKind,
  TypeMedia,
} from "cesr-ts";
import {
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransReceiptQuadruple,
} from "../../core/dispatch.ts";
import type { Baser } from "../basing.ts";

/** Normalize historical ordinals before durable tuple identity is compared. */
function number(value: TransIdxSigGroup["seqner"]): NumberPrimitive {
  return NumberPrimitive.fromNum(value instanceof NumberPrimitive ? value.num : value.sn);
}
/** Qualified tuple encoding is self-delimiting; opaque wire uses lossless byte code units. */
function identity(value: unknown): string {
  if (value instanceof Uint8Array) return byteString(value);
  if (Array.isArray(value)) return value.map(identity).join("");
  if (value && typeof value === "object" && "qb64" in value && typeof value.qb64 === "string") return value.qb64;
  throw new Error("Unexpected KRAM stored factor");
}
/** Enumerate tables consistently for validation and owned-factor cleanup. */
function tables(db: Baser) {
  return [
    db.pmks,
    db.trqs,
    db.tsgs,
    db.ulgs,
    db.cigs,
    db.sscs,
    db.ssts,
    db.frcs,
    db.tdcs,
    db.ptds,
    db.bsqs,
    db.bsss,
    db.tmqs,
  ];
}
/** Merge exact members in first-receipt order. */
function merge<T>(saved: Iterable<T>, incoming: Iterable<T>): T[] {
  const result: T[] = [], seen = new Set<string>();
  for (const source of [saved, incoming]) {
    for (const value of source) {
      const id = identity(value);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(value);
    }
  }
  return result;
}
/** Flatten explicit groups without assigning foreign signatures to the sender pool. */
function* signatureTuples(groups: readonly TransIdxSigGroup[]) {
  for (const group of groups) {
    for (const sig of group.sigers) {
      yield [group.prefixer, number(group.seqner), group.diger, sig] as const;
    }
  }
}
/** Stage factors in the caller's transaction.
 * Sender body, establishment seal and verified pmks pool remain caller-owned.
 */
export function storeKramFactors(db: Baser, key: readonly string[], envelope: KeriDispatchEnvelope): void {
  const sender = envelope.serder.pre;
  for (const item of envelope.trqs) db.trqs.add(key, [item.prefixer, number(item.seqner), item.diger, item.siger]);
  for (const group of envelope.tsgs) {
    if (group.pre !== sender) {
      for (const sig of group.sigers) db.tsgs.add(key, [group.prefixer, number(group.seqner), group.diger, sig]);
    }
  }
  for (const pre of envelope.unresolvedLast) db.ulgs.add(key, pre);
  for (const group of envelope.ssgs) {
    if (group.pre === sender) continue;
    const kever = db.getKever(group.pre);
    if (!kever) {
      db.ulgs.add(key, group.prefixer);
      continue;
    }
    db.ulgs.rem(key, group.prefixer);
    for (const sig of group.sigers) {
      db.tsgs.add(key, [
        group.prefixer,
        NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
        groupDigest(kever.lastEst.d),
        sig,
      ]);
    }
  }
  for (const cigar of envelope.cigars) {
    if (cigar.verfer && cigar.verfer.qb64 !== sender) db.cigs.add(key, [cigar.verfer, cigar]);
  }
  for (const seal of envelope.ssts) if (seal.i.qb64 !== sender) db.ssts.add(key, SealEvent.toTuple(seal));
  for (const value of envelope.frcs) db.frcs.add(key, FirstSeen.toTuple(value));
  for (const value of envelope.tdcs) db.tdcs.add(key, SealKind.toTuple(value));
  for (const value of envelope.ptds) db.ptds.add(key, value.raw);
  for (const value of envelope.bsqs) db.bsqs.add(key, BlindState.toTuple(value));
  for (const value of envelope.bsss) db.bsss.add(key, BoundState.toTuple(value));
  for (const value of envelope.tmqs) db.tmqs.add(key, TypeMedia.toTuple(value));
}

/** Hydrate a frozen establishment digest without referring to the current KEL head. */
function groupDigest(said: string): Diger {
  return new Diger({ qb64: said });
}

/** Remove only this partial's owned state, leaving timeliness/accepted exchange rows intact. */
export function removeKramFactors(db: Baser, key: readonly string[]): void {
  db.pmkm.rem(key);
  db.pmsk.rem(key);
  for (const table of tables(db)) table.rem(key);
}

/** Reconstruct factors only; child/ESSR owners stay borrowed and are never authenticated here. */
export function rehydrateKramFactors(
  db: Baser,
  key: readonly string[],
  envelope: KeriDispatchEnvelope,
): KeriDispatchEnvelope {
  const body = db.pmkm.get(key);
  if (
    body
    && (body.raw.length !== envelope.serder.raw.length || !body.raw.every((byte, i) => byte === envelope.serder.raw[i]))
  ) {
    throw new Error("KRAM partial body mismatch");
  }
  const grouped = new Map<string, TransIdxSigGroup>();
  for (const [pre, num, dig, sig] of merge(db.tsgs.getIter(key), signatureTuples(envelope.tsgs))) {
    const group = new TransIdxSigGroup(pre, num, dig, [sig]);
    const previous = grouped.get(group.routeKey);
    if (previous) previous.sigers.push(sig);
    else grouped.set(group.routeKey, group);
  }
  return new KeriDispatchEnvelope({
    ...envelope,
    attachmentGroups: [...envelope.attachmentGroups],
    sigers: merge(db.pmks.getIter(key), envelope.sigers).sort((a, b) => a.index - b.index),
    tsgs: [...grouped.values()],
    unresolvedLast: merge(db.ulgs.getIter(key), envelope.unresolvedLast),
    cigars: merge(
      db.cigs.getIter(key),
      envelope.cigars.map((c) => {
        if (!c.verfer) throw new Error("KRAM cigar has no verifier context");
        return [c.verfer, c] as const;
      }),
    )
      .map(([verfer, cigar]) => new Cigar(cigar, verfer)),
    trqs: merge(
      db.trqs.getIter(key),
      envelope.trqs.map((v) => [v.prefixer, number(v.seqner), v.diger, v.siger] as const),
    )
      .map(TransReceiptQuadruple.fromTuple),
    ssts: merge(db.ssts.getIter(key), envelope.ssts.map(SealEvent.toTuple)).map(SealEvent.fromTuple),
    frcs: merge(db.frcs.getIter(key), envelope.frcs.map(FirstSeen.toTuple)).map(FirstSeen.fromTuple),
    tdcs: merge(db.tdcs.getIter(key), envelope.tdcs.map(SealKind.toTuple)).map(SealKind.fromTuple),
    ptds: merge(db.ptds.getIter(key), envelope.ptds.map((v) => v.raw)).map(PathedMaterialGroup.fromRaw),
    bsqs: merge(db.bsqs.getIter(key), envelope.bsqs.map(BlindState.toTuple)).map(BlindState.fromTuple),
    bsss: merge(db.bsss.getIter(key), envelope.bsss.map(BoundState.toTuple)).map(BoundState.fromTuple),
    tmqs: merge(db.tmqs.getIter(key), envelope.tmqs.map(TypeMedia.toTuple)).map(TypeMedia.fromTuple),
  });
}
