/** KRAM partial evidence borrows incoming trees and owns reopened snapshots through handoff. */
import {
  b,
  BlindState,
  BoundState,
  byteString,
  type CesrFrame,
  Cigar,
  collectPayload,
  Diger,
  discardFrame,
  FirstSeen,
  framePayload,
  NumberPrimitive,
  parse,
  ResourceLimitError,
  SealEvent,
  SealKind,
  TypeMedia,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, resource } from "effection";
import { abortable } from "../app/abortable.ts";
import {
  KeriDispatchEnvelope,
  PathedMaterialGroup,
  TransIdxSigGroup,
  TransReceiptQuadruple,
} from "../core/dispatch.ts";
import type { Baser } from "./basing.ts";
import { chargeNests, MAX_NESTED_WIRE_BYTES } from "./exchange-nests.ts";

/** Copy the ordinal's semantic value into the compact primitive stored by KRAM. */
function number(value: TransIdxSigGroup["seqner"]): NumberPrimitive {
  return NumberPrimitive.fromNum(value instanceof NumberPrimitive ? value.num : value.sn);
}
/** Deduplicate groups by their original qualified bytes, retaining first receipt order. */
function unique<T>(items: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
/** Aggregate finite credits for all persisted partial factors, independent of tree payload credits. */
interface FactorCredits {
  items: number;
  bytes: number;
}
/** Compute exact qualified factor bytes without a JSON/stringification copy. */
function extent(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((size, item) => size + extent(item), 0);
  if (value && typeof value === "object" && "qb64" in value && typeof value.qb64 === "string") return value.qb64.length;
  throw new Error("Unexpected KRAM stored factor");
}
/** Hydrate one bounded set at a time, sharing credits across every factor family. */
function read<T>(
  table: { getIter(key: readonly string[]): Generator<T> },
  key: readonly string[],
  credits: FactorCredits,
): T[] {
  const result: T[] = [];
  for (const item of table.getIter(key)) {
    credits.items--;
    credits.bytes -= extent(item);
    if (credits.items < 0 || credits.bytes < 0) {
      throw new ResourceLimitError("KRAM partial evidence exceeds finite limits");
    }
    result.push(item);
  }
  return result;
}
/** Validate the complete union within the caller's transaction, so refusal rolls back insertion. */
export function validateKramFactors(db: Baser, key: readonly string[]): void {
  const credits = { items: 4096, bytes: 8 * 1024 ** 2 };
  for (
    const table of [
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
    ]
  ) {
    read(table as { getIter(key: readonly string[]): Generator<unknown> }, key, credits);
  }
}

/** Store independently owned non-sender factors without reinterpreting future last keys. */
export function storeKramFactors(db: Baser, key: readonly string[], envelope: KeriDispatchEnvelope): void {
  const sender = envelope.serder.pre;
  for (const item of envelope.trqs) db.trqs.add(key, [item.prefixer, number(item.seqner), item.diger, item.siger]);
  for (const group of envelope.tsgs) {
    if (group.pre !== sender) {
      for (const sig of group.sigers) db.tsgs.add(key, [group.prefixer, number(group.seqner), group.diger, sig]);
    }
  }
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
export function removeKramPending(db: Baser, key: readonly string[]): void {
  db.pmkm.rem(key);
  db.pmks.rem(key);
  db.pmsk.rem(key);
  for (
    const table of [
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
    ]
  ) table.rem(key);
  db.kpnd.rem(key);
  db.kready.rem(key);
}

/** Serialize a finite whole-tree snapshot before its atomic partial publication. */
export function snapshotKram(envelope: KeriDispatchEnvelope): Operation<Uint8Array | undefined> {
  return abortable(async (signal) => {
    if (!envelope.essr && !envelope.nests.length) return undefined;
    chargeNests(envelope.nests, {
      bytes: 8 * 1024 ** 2 - envelope.serder.raw.length,
      groups: 4096 - envelope.attachmentGroups.length,
      nodes: 255,
      essrBytes: 8 * 1024 ** 2 - (envelope.essr?.raw.size ?? 0),
      essrItems: 16384 - (envelope.essr?.count ?? 0),
    });
    const wire = framePayload({
      body: envelope.serder,
      attachments: [...envelope.attachmentGroups],
      nests: [...envelope.nests],
      essr: envelope.essr,
      gvrsn: Vrsn_2_0,
    });
    if (wire.size > MAX_NESTED_WIRE_BYTES) throw new ResourceLimitError("KRAM snapshot exceeds finite wire limit");
    return await collectPayload(wire, MAX_NESTED_WIRE_BYTES, signal);
  });
}

/**
 * Reopen at most one finite parent snapshot. Its ESSR owners belong to the caller's
 * Effection scope until downstream consumption completes, including cancellation.
 * LMDB still materializes the row before its size check; phase 5 owns that boundary.
 */
function loadSnapshot(db: Baser, key: readonly string[]): Operation<CesrFrame | undefined> {
  return resource<CesrFrame | undefined>(function*(provide) {
    const stored = db.kpnd.sdb.get(b(key.join(".")));
    const frames: CesrFrame[] = [];
    try {
      if (stored) {
        const bytes = stored;
        if (bytes.length > MAX_NESTED_WIRE_BYTES) throw new Error("Oversized stored KRAM snapshot");
        yield* abortable(async (signal) => {
          /** Bound producer backing and keep one progressive parser engine. */
          async function* source() {
            for (let offset = 0; offset < bytes.length; offset += 65536) {
              signal.throwIfAborted();
              yield bytes.slice(offset, offset + 65536);
            }
          }
          for await (
            const frame of parse(source(), {
              signal,
              maxFrameBytes: 8 * 1024 ** 2,
              maxEssrBytes: 8 * 1024 ** 2,
              maxTreeNodes: 256,
              maxAttachmentGroups: 4096,
              maxEssrItems: 16384,
              maxDepth: 64,
              payloadSink: async (limit, stageSignal) =>
                (await db.openPayloads(stageSignal)).files.stage(limit, stageSignal),
            })
          ) {
            frames.push(frame);
            if (frames.length > 1) throw new Error("KRAM snapshot contains multiple parents");
          }
          if (frames.length !== 1) throw new Error("KRAM snapshot has no parent");
        });
      }
      yield* provide(frames[0]);
    } finally {
      yield* call(async () => {
        const results = await Promise.allSettled(frames.map(discardFrame));
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failures.length) {
          throw new AggregateError(failures.map((result) => result.reason), "KRAM snapshot cleanup failed");
        }
      });
    }
  });
}

/** Merge durable factors and payloads without giving sender proofs to nested children. */
export function* rehydrateKram(
  db: Baser,
  key: readonly string[],
  envelope: KeriDispatchEnvelope,
): Operation<KeriDispatchEnvelope> {
  const credits = { items: 4096, bytes: 8 * 1024 ** 2 };
  const saved = yield* loadSnapshot(db, key);
  if (
    saved
    && (saved.body.raw.length !== envelope.serder.raw.length
      || !saved.body.raw.every((byte, i) => byte === envelope.serder.raw[i]))
  ) throw new Error("KRAM snapshot body mismatch");
  const groups = [...envelope.tsgs];
  for (const [pre, num, dig, sig] of read(db.tsgs, key, credits)) {
    groups.push(new TransIdxSigGroup(pre, num, dig, [sig]));
  }
  const merged = new Map<string, TransIdxSigGroup>();
  for (const group of groups) {
    const previous = merged.get(group.routeKey);
    merged.set(
      group.routeKey,
      new TransIdxSigGroup(
        group.prefixer,
        group.seqner,
        group.diger,
        unique([...(previous?.sigers ?? []), ...group.sigers], (sig) => sig.qb64),
      ),
    );
  }
  const cigars = read(db.cigs, key, credits).map(([verfer, cigar]) => new Cigar(cigar, verfer));
  return new KeriDispatchEnvelope({
    ...envelope,
    attachmentGroups: [...envelope.attachmentGroups],
    sigers: read(db.pmks, key, credits).sort((a, b) => a.index - b.index),
    tsgs: [...merged.values()],
    unresolvedLast: unique([...read(db.ulgs, key, credits), ...envelope.unresolvedLast], (pre) => pre.qb64),
    cigars: unique([...cigars, ...envelope.cigars], (cigar) => `${cigar.verfer?.qb64}.${cigar.qb64}`),
    trqs: unique(
      [...read(db.trqs, key, credits).map(TransReceiptQuadruple.fromTuple), ...envelope.trqs],
      (value) => value.toTuple().map((part) => part.qb64).join(""),
    ),
    ssts: unique(
      [...read(db.ssts, key, credits).map(SealEvent.fromTuple), ...envelope.ssts],
      (value) => SealEvent.toTuple(value).map((part) => part.qb64).join(""),
    ),
    frcs: unique(
      [...read(db.frcs, key, credits).map(FirstSeen.fromTuple), ...envelope.frcs],
      (value) => FirstSeen.toTuple(value).map((part) => part.qb64).join(""),
    ),
    tdcs: unique(
      [...read(db.tdcs, key, credits).map(SealKind.fromTuple), ...envelope.tdcs],
      (value) => SealKind.toTuple(value).map((part) => part.qb64).join(""),
    ),
    ptds: unique(
      [...read(db.ptds, key, credits).map((raw) => PathedMaterialGroup.fromRaw(raw)), ...envelope.ptds],
      (value) => byteString(value.raw),
    ),
    bsqs: unique(
      [...read(db.bsqs, key, credits).map(BlindState.fromTuple), ...envelope.bsqs],
      (value) => BlindState.toTuple(value).map((part) => part.qb64).join(""),
    ),
    bsss: unique(
      [...read(db.bsss, key, credits).map(BoundState.fromTuple), ...envelope.bsss],
      (value) => BoundState.toTuple(value).map((part) => part.qb64).join(""),
    ),
    tmqs: unique(
      [...read(db.tmqs, key, credits).map(TypeMedia.fromTuple), ...envelope.tmqs],
      (value) => TypeMedia.toTuple(value).map((part) => part.qb64).join(""),
    ),
    nests: envelope.nests.length ? envelope.nests : saved?.nests,
    essr: envelope.essr ?? saved?.essr,
  });
}
