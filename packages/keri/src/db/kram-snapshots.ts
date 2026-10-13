/** Private partial wire snapshots borrow incoming owners and scope every reopened descendant. */
import { type CesrFrame, collectPayload, framePayload, parse, ResourceLimitError, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation } from "effection";
import { abortable } from "../app/abortable.ts";
import { KeriDispatchEnvelope } from "../core/dispatch.ts";
import type { Baser } from "./basing.ts";
import { chargeNests, discardNests, MAX_NESTED_WIRE_BYTES } from "./exchange-nests.ts";
import { rehydrateKramFactors } from "./kram-factors.ts";

/** Charge parent metadata and decoded ESSR before charging descendants with diminishing credit. */
function validateTree(frame: CesrFrame): void {
  const essr = frame.essr;
  if (
    essr && ([essr.count, essr.raw.size, essr.wire.size].some((n) => !Number.isSafeInteger(n) || n < 0)
      || essr.wire.size > 4 * Math.ceil(essr.raw.size / 3) + 12 * essr.count)
  ) {
    throw new RangeError("Invalid KRAM snapshot ESSR extent");
  }
  const budget = {
    bytes: 8 * 1024 ** 2 - frame.body.raw.length - frame.attachments.reduce((n, group) => n + group.raw.length, 0),
    groups: 4096 - frame.attachments.length,
    nodes: 255,
    essrBytes: 8 * 1024 ** 2 - (essr?.raw.size ?? 0),
    essrItems: 16384 - (essr?.count ?? 0),
  };
  if (Object.values(budget).some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new ResourceLimitError("KRAM snapshot exceeds aggregate admission limits");
  }
  chargeNests(frame.nests ?? [], budget);
}

/** Serialize bounded private wire, borrowing every incoming child/ESSR owner until the read joins. */
export function snapshotKram(envelope: KeriDispatchEnvelope): Operation<Uint8Array | undefined> {
  return abortable(async (signal) => {
    if (!envelope.essr && !envelope.nests.length) return undefined;
    const frame: CesrFrame = {
      body: envelope.serder,
      attachments: [...envelope.attachmentGroups],
      nests: [...envelope.nests],
      essr: envelope.essr,
      gvrsn: Vrsn_2_0,
    };
    validateTree(frame);
    const wire = framePayload(frame);
    if (wire.size > MAX_NESTED_WIRE_BYTES) throw new ResourceLimitError("KRAM snapshot exceeds finite wire limit");
    return await collectPayload(wire, MAX_NESTED_WIRE_BYTES, signal);
  });
}

/** Stage a prepared snapshot inside the caller's partial-state transaction; absence preserves older wire. */
export function storeKramSnapshot(db: Baser, key: readonly string[], wire: Uint8Array | undefined): void {
  if (wire === undefined) return;
  if (wire.length > MAX_NESTED_WIRE_BYTES) throw new ResourceLimitError("KRAM snapshot exceeds finite wire limit");
  db.kpnd.pin(key, wire);
}

/** Remove private wire only; scalar factors, cache and accepted rows have independent owners. */
export function removeKramSnapshot(db: Baser, key: readonly string[]): void {
  db.kpnd.rem(key);
}

/** Parse one finite parent while the caller's operation owns every yielded descendant. */
function loadSnapshot(db: Baser, key: readonly string[], frames: CesrFrame[]): Operation<void> {
  return abortable(async (signal) => {
    // LMDB allocates the row before this check; storage phase 5 still owns that boundary.
    const stored = db.kpnd.get(key);
    if (!stored) return;
    const bytes = stored;
    if (bytes.length > MAX_NESTED_WIRE_BYTES) throw new Error("Oversized stored KRAM snapshot");
    /** Copy finite chunks so parser backing never pins the whole LMDB row. */
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
        payloadSink: async (limit, stageSignal) => (await db.openPayloads(stageSignal)).files.stage(limit, stageSignal),
      })
    ) {
      // Claim before cardinality/limits so failures cannot strand a yielded owner.
      frames.push(frame);
      if (frames.length > 1) throw new Error("KRAM snapshot contains multiple parents");
      validateTree(frame);
    }
    if (frames.length !== 1) throw new Error("KRAM snapshot has no parent");
  });
}

/**
 * Consume hydrated factors/trees within their operation; reopened owners live through the callback only.
 * Direct finally joins disposal before returning, preserving consumer and cleanup failures.
 * Fresh input stays borrowed; snapshot parent signatures never reconstruct authentication inputs.
 */
export function withKramHydration<T>(
  db: Baser,
  key: readonly string[],
  envelope: KeriDispatchEnvelope,
  consume: (envelope: KeriDispatchEnvelope) => Operation<T>,
): Operation<T> {
  return call(function*() {
    const frames: CesrFrame[] = [];
    let failed = false, failure: unknown;
    try {
      yield* loadSnapshot(db, key, frames);
      const saved = frames[0];
      if (
        saved && (saved.body.raw.length !== envelope.serder.raw.length
          || !saved.body.raw.every((byte, i) => byte === envelope.serder.raw[i]))
      ) {
        throw new Error("KRAM snapshot body mismatch");
      }
      const factors = rehydrateKramFactors(db, key, envelope);
      const result = new KeriDispatchEnvelope({
        ...factors,
        attachmentGroups: [...factors.attachmentGroups],
        nests: envelope.nests.length ? envelope.nests : saved?.nests,
        essr: envelope.essr ?? saved?.essr,
      });
      validateTree({
        body: result.serder,
        attachments: [...result.attachmentGroups],
        nests: [...result.nests],
        essr: result.essr,
      });
      return yield* consume(result);
    } catch (error) {
      failed = true;
      failure = error;
      throw error;
    } finally {
      try {
        yield* call(() => discardNests(frames));
      } catch (cleanup) {
        if (failed) {
          // deno-lint-ignore no-unsafe-finally -- Preserve the original failure alongside cleanup failure.
          throw new AggregateError([failure, cleanup], "KRAM hydration and cleanup failed", { cause: failure });
        }
        // deno-lint-ignore no-unsafe-finally -- Disposal must fail the owning operation before it returns.
        throw cleanup;
      }
    }
  });
}
