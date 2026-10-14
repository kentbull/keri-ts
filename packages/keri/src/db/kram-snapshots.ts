/** Private partial wire snapshots borrow incoming owners and scope every reopened descendant. */
import {
  type CesrFrame,
  collectPayload,
  DigDex,
  Diger,
  framePayload,
  parse,
  ResourceAdmissionError,
  ResourceLimitError,
  type ResourcePolicy,
  type ResourceReservation,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, resource } from "effection";
import { abortable } from "../app/abortable.ts";
import { KeriDispatchEnvelope } from "../core/dispatch.ts";
import type { Baser } from "./basing.ts";
import { chargeNests, discardNests, MAX_NESTED_WIRE_BYTES } from "./exchange-nests.ts";
import { rehydrateKramFactors } from "./kram-factors.ts";

/** Acquire one finite phase allowance; callers join its last use before release. */
function reserveCopies(resources: ResourcePolicy, bytes: number): ResourceReservation {
  const decision = resources.reserve({ bytes });
  if (decision.kind === "refuse") {
    throw new ResourceAdmissionError(`KRAM snapshot admission refused: ${decision.reason}`, decision.reason);
  }
  return decision.reservation;
}

/** Private snapshots are a durable invariant; their finite stored ceiling is not ordinary admission refusal. */
function readSnapshot(db: Baser, key: readonly string[], beforeCopy: (bytes: number) => void): Uint8Array | null {
  try {
    return db.kpnd.getBounded(key, MAX_NESTED_WIRE_BYTES, beforeCopy);
  } catch (error) {
    if (error instanceof ResourceLimitError && !(error instanceof ResourceAdmissionError)) {
      throw new Error("Oversized stored KRAM snapshot", { cause: error });
    }
    throw error;
  }
}

/** Fingerprint bounded private wire in one transaction; no row owner escapes the synchronous digest. */
export function kramSnapshotIdentity(db: Baser, key: readonly string[], resources: ResourcePolicy): string | null {
  let credit: ResourceReservation | undefined;
  try {
    const wire = readSnapshot(db, key, () => {
      credit = reserveCopies(resources, 2 * MAX_NESTED_WIRE_BYTES);
    });
    return wire ? new Diger({ raw: Diger.digest(wire, DigDex.Blake3_256), code: DigDex.Blake3_256 }).qb64 : null;
  } finally {
    credit?.release();
  }
}

/** Publish synchronously within wire credit; the callback must not retain wire or return work using it. */
export function withKramSnapshot<T>(
  envelope: KeriDispatchEnvelope,
  resources: ResourcePolicy,
  publish: (wire: Uint8Array | undefined) => T,
): Operation<T> {
  return call(function*() {
    if (envelope.essr || envelope.nests.length) {
      validateTree({
        body: envelope.serder,
        attachments: [...envelope.attachmentGroups],
        nests: [...envelope.nests],
        essr: envelope.essr,
      });
    }
    // Register credit before the leaf: cancellation joins its source before this owner unwinds.
    yield* resource<void>(function*(provide) {
      const credit = envelope.essr || envelope.nests.length
        ? reserveCopies(resources, 2 * MAX_NESTED_WIRE_BYTES)
        : undefined;
      try {
        yield* provide();
      } finally {
        credit?.release();
      }
    });
    return publish(yield* snapshotKram(envelope));
  });
}

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
function loadSnapshot(
  db: Baser,
  key: readonly string[],
  frames: CesrFrame[],
  resources: ResourcePolicy,
): Operation<void> {
  return abortable(async (signal) => {
    let rowCredit: ResourceReservation | undefined, cursorCredit: ResourceReservation | undefined;
    try {
      const stored = readSnapshot(db, key, () => {
        rowCredit = reserveCopies(resources, 2 * MAX_NESTED_WIRE_BYTES);
      });
      if (!stored) return;
      const bytes = stored;
      cursorCredit = reserveCopies(resources, 8 * 1024 ** 2 + 65536);
      /** Copy finite chunks so parser backing never pins the whole LMDB row. */
      const source = async function*() {
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          signal.throwIfAborted();
          yield bytes.slice(offset, offset + 65536);
        }
      };
      for await (
        const frame of parse(source(), {
          signal,
          resources,
          maxChunkBytes: 65536,
          maxBufferedBytes: 8 * 1024 ** 2,
          maxFrameBytes: Math.max(1, Math.min(8 * 1024 ** 2, bytes.length)),
          maxEssrBytes: 8 * 1024 ** 2,
          maxTreeNodes: 256,
          maxAttachmentGroups: 4096,
          maxEssrItems: 16384,
          maxDepth: 64,
          payloadSink: async (limit, stageSignal) =>
            (await db.openPayloads(stageSignal)).files.stage(limit, stageSignal),
        })
      ) {
        // Claim before cardinality/limits so failures cannot strand a yielded owner.
        frames.push(frame);
        if (frames.length > 1) throw new Error("KRAM snapshot contains multiple parents");
        validateTree(frame);
      }
      if (frames.length !== 1) throw new Error("KRAM snapshot has no parent");
    } finally {
      // Parser/source closure has joined; transferred frame credit belongs to hydration disposal.
      cursorCredit?.release();
      rowCredit?.release();
    }
  });
}

/**
 * Consume hydrated factors/trees within their operation; reopened owners live through the callback only.
 * Direct finally joins disposal before returning, preserving consumer and cleanup failures.
 * Fresh input stays borrowed; snapshot parent signatures never reconstruct authentication inputs.
 * Explicit resource credit follows parsing phases and actual frame owners, never an escaping callback result.
 */
export function withKramHydration<T>(
  db: Baser,
  key: readonly string[],
  envelope: KeriDispatchEnvelope,
  resources: ResourcePolicy,
  consume: (envelope: KeriDispatchEnvelope) => Operation<T>,
): Operation<T> {
  return call(function*() {
    const frames: CesrFrame[] = [];
    let failed = false, failure: unknown;
    try {
      yield* loadSnapshot(db, key, frames, resources);
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
