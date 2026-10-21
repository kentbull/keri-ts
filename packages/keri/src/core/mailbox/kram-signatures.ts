/** Internal KRAM sender-factor normalization and signature verification. */
import { Diger, NumberPrimitive, Siger, type Verfer } from "cesr-ts";
import type { Baser } from "../../db/basing.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup } from "../dispatch.ts";
import type { Kever } from "../kel/kever.ts";

/** Verified means at least one signature, never threshold satisfaction or acceptance. */
export type KramSignatureDecision = {
  envelope: KeriDispatchEnvelope;
  sigers: Siger[];
  /** Historical sender proofs are diagnostic only, never current threshold factors. */
  staleSenderGroups: TransIdxSigGroup[];
} & ({ kind: "verified"; auth: "cigar" | "indexed" } | { kind: "unverified" });

/** Clone factor arrays while borrowing primitive/frame owners and retaining foreign evidence. */
export function normalizeKramSenderFactors(incoming: KeriDispatchEnvelope): KeriDispatchEnvelope {
  const envelope = new KeriDispatchEnvelope({ ...incoming, attachmentGroups: [...incoming.attachmentGroups] });
  const sender = envelope.serder.pre;
  if (!sender) throw new Error("KRAM normalization requires a sender");
  for (const triple of envelope.ssts) {
    if (triple.i.qb64 === sender) envelope.sscs.push({ s: triple.s, d: triple.d });
  }
  envelope.ssts.splice(0, envelope.ssts.length, ...envelope.ssts.filter((triple) => triple.i.qb64 !== sender));
  for (const group of envelope.ssgs) if (group.pre === sender) envelope.sigers.push(...group.sigers);
  envelope.ssgs.splice(0, envelope.ssgs.length, ...envelope.ssgs.filter((group) => group.pre !== sender));
  return envelope;
}

/** Frozen verifySigs deduplicates qb64, preserving arrival order and distinct encodings at one index. */
function orderedSignatures(raw: Uint8Array, sigers: readonly Siger[], verfers: readonly Verfer[]): Siger[] {
  const seen = new Set<string>(), verified: Siger[] = [];
  for (const siger of sigers) {
    if (seen.has(siger.qb64)) continue;
    seen.add(siger.qb64);
    const verfer = verfers[siger.index];
    if (verfer && verfer.verify(siger.raw, raw)) verified.push(new Siger({ qb64: siger.qb64 }, verfer));
  }
  return verified;
}

/**
 * Normalize a borrowed parent and verify only its current sender pool.
 * Try matching nontransferable cigars before indexed signatures. Scrub prior
 * sender groups from delivery, retaining historically verified diagnostic groups.
 * Foreign groups and children remain separate; I/O/corruption failures propagate.
 * Callers own source precedence, missing-state queries, unique-index threshold
 * satisfaction and durable intake. Existing parser/v1 normalization is unchanged.
 */
export function verifyKramSignatures(db: Baser, incoming: KeriDispatchEnvelope, kever: Kever): KramSignatureDecision {
  const envelope = normalizeKramSenderFactors(incoming);
  const sender = envelope.serder.pre!;
  if (kever.prefixer.qb64 !== sender) throw new Error("KRAM signatures require the sender's current Kever");
  const current = (group: TransIdxSigGroup) => group.sn === BigInt(kever.lastEst.s) && group.said === kever.lastEst.d;
  const staleSenderGroups: TransIdxSigGroup[] = [];
  for (const group of envelope.tsgs) {
    if (group.pre !== sender) continue;
    if (current(group)) envelope.sigers.push(...group.sigers);
    else if (group.sn <= BigInt(Number.MAX_SAFE_INTEGER) && db.kels.getLast(sender, Number(group.sn)) === group.said) {
      const event = db.getEvtSerder(sender, group.said);
      if (event) {
        const sigers = orderedSignatures(envelope.serder.raw, group.sigers, event.verfers);
        if (sigers.length) {
          staleSenderGroups.push(new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, sigers));
        }
      }
    }
  }
  envelope.tsgs.splice(
    0,
    envelope.tsgs.length,
    ...envelope.tsgs.filter((group) => group.pre !== sender || current(group)),
  );
  for (const cigar of envelope.cigars) {
    if (
      cigar.verfer && !cigar.verfer.transferable && cigar.verfer.qb64 === sender
      && cigar.verfer.verify(cigar.raw, envelope.serder.raw)
    ) return { kind: "verified", auth: "cigar", envelope, sigers: [], staleSenderGroups };
  }
  const pool = [...envelope.sigers];
  for (const group of envelope.tsgs) if (group.pre === sender) pool.push(...group.sigers);
  const sigers = orderedSignatures(envelope.serder.raw, pool, kever.verfers);
  const verified = new Set(sigers.map((siger) => siger.qb64));
  envelope.sigers.splice(0, envelope.sigers.length, ...envelope.sigers.filter((siger) => verified.has(siger.qb64)));
  const groups = envelope.tsgs.flatMap((group) => {
    if (group.pre !== sender) return [group];
    const kept = group.sigers.filter((siger) => verified.has(siger.qb64));
    return kept.length ? [new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, kept)] : [];
  });
  if (envelope.serder.ilk === "exn" && sigers.length) {
    groups.splice(
      0,
      groups.length,
      new TransIdxSigGroup(
        kever.prefixer,
        NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
        new Diger({ qb64: kever.lastEst.d }),
        sigers,
      ),
      ...groups.filter((group) => group.pre !== sender),
    );
  }
  envelope.tsgs.splice(0, envelope.tsgs.length, ...groups);
  return sigers.length
    ? { kind: "verified", auth: "indexed", envelope, sigers, staleSenderGroups }
    : { kind: "unverified", envelope, sigers, staleSenderGroups };
}
