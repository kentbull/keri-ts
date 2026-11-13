/** Finite credential-bundle intake; protocol owners retain and recover their own pending evidence. */
import { Ilks, parse, SerderACDC, SerderKERI } from "cesr-ts";
import { action, call, ensure, type Operation, race } from "npm:effection@^3.6.0";
import { validateRip, validateUpdate } from "../../acdc/regeventing.ts";
import type { Kevery } from "../../core/kel/eventing.ts";
import { consoleLogger } from "../../core/logger.ts";
import type { Reger } from "../../db/reger.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { rethrowCleanupFailure } from "../runtime/abortable.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { chunkBytes } from "../transport/byte-source.ts";

/** Acceptance observed after finite input cleanup and any needed local escrow recovery. */
export interface CredentialImportResult {
  /** Newly saved raw credential SAIDs from this input; imported grant children and unrelated recoveries are excluded. */
  saved: string[];
  /** Whether this input's observed credential, KEL/TEL and EXN records are accepted, not validation of every occurrence. */
  complete: boolean;
  /** Deduplicated input SAIDs without their normal accepted records, in first-seen order. */
  unaccepted: string[];
}

/** V2 message identities needed for existing accepted-record lookups; no wire evidence is retained here. */
type ImportTarget =
  | {
    /** Raw ACDC uses no message ilk; section messages are handled by their normal processors. */
    ilk: null;
    /** Credential's own SAID, excluding any children carried by an exchange. */
    said: string;
    /** Saved marker observed before this credential's first dispatch, for this input's new-save result only. */
    savedBefore: boolean;
  }
  | {
    /** V2 event ilk selects the existing KEL or TEL accepted record. */
    ilk: "icp" | "dip" | "rot" | "drt" | "ixn" | "vcp" | "vrt" | "iss" | "rev" | "bis" | "brv";
    /** Event digest; a different accepted event at the same coordinate cannot satisfy it. */
    said: string;
    /** Identifier of the event sequence; absent coordinates cannot establish acceptance. */
    pre: string | null;
    /** Exact sequence number, independent of the currently accepted head. */
    sn: number | null;
  }
  | {
    /** V2 public registry event, accepted in the v2 registry store rather than the v1 Reger. */
    ilk: "rip" | "bup";
    /** Event SAID; a different accepted event at the same ordinal cannot satisfy it. */
    said: string;
    /** Registry the event belongs to, or null for an event that fails field validation. */
    regid: string | null;
    /** Exact registry ordinal, or null for an event that fails field validation. */
    sn: number | null;
  }
  | {
    /** An accepted exchange (a v2 Grant opens its thread as `xip`) does not admit any embedded credential. */
    ilk: "exn" | "xip";
    /** Exchange's own SAID. */
    said: string;
    /** For a v2 `/ipex/admit`, the Grant it answers, whose reply row must name this Admit; otherwise null. */
    answers: string | null;
  };

/**
 * Dispatch each frame once, then recover local dependencies through their existing escrow owners.
 * This operation owns its parser/Kevery and starts no network, mailbox or host workers.
 * Later input failures preserve earlier accepted state. Receipts, replies and other messages still
 * use normal dispatch; absence of an importer acceptance lookup is not an additional refusal policy.
 *
 * The input is retained history the caller already holds (for example an exported disclosure stream: KELs, the v2
 * registry TEL, a Grant and its Admit), so every frame is dispatched with `DispatchOptions.retained`. Its v2
 * exchanges skip KRAM, whose window their original stamps passed long ago; signatures, route verification and
 * escrows are unchanged, and the accepted exchanges raise no notice and get no exchange lifetime. Targets: raw
 * credentials, KEL and v1 TEL events, v2 `rip`/`bup` (accepted at their exact ordinal in the v2 registry store),
 * and exchanges (accepted by the Exchanger; a v2 Admit also needs its Grant's reply row to name it). Importing the
 * same input again changes nothing and reports the same acceptance.
 *
 * @param protocol Borrowed protocol dispatcher, sharing reger with its TEL/credential handlers.
 * @param reger Borrowed credential/TEL store whose accepted records establish the result.
 * @param bytes Borrowed finite CESR bundle; parser chunks are copied during intake.
 * @param clock Borrowed timer implementation for the deadline and cooperative yields between sweeps.
 * @param timeoutMs Positive finite post-EOF settlement limit in milliseconds, default 5000; floored with a one-millisecond minimum before intake.
 * @returns Accepted-record observations after joined input/handler cleanup. Settlement stops when all observed records are accepted, or the deadline expires.
 * @throws Parser, storage, handler and cleanup failures propagate with partial accepted state intact. Cancellation joins active work; a deadline cannot interrupt synchronous owner work mid-sweep.
 */
export function* importCredentialStream(
  protocol: ProtocolProcessor,
  reger: Reger,
  bytes: Uint8Array,
  clock: RuntimeClock,
  timeoutMs = 5_000,
): Operation<CredentialImportResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Import timeout must be finite and positive");
  const settlementMs = Math.max(1, Math.floor(timeoutMs));
  if (protocol.vry?.reger !== reger || protocol.tvy?.reger !== reger) {
    throw new TypeError("Credential import requires TEL and credential processors sharing its Reger");
  }
  const targets = yield* readImportTargets(protocol, reger, bytes, protocol.makeKevery());
  /** Read current acceptance; an earlier refused duplicate cannot override a persisted accepted record. */
  const unaccepted = () =>
    targets.filter((target) => !importTargetAccepted(target, protocol, reger)).map(({ said }) => said);
  let expired = false;
  if (unaccepted().length) {
    expired = yield* race([
      // Register the deadline before entering the first potentially suspending escrow owner.
      action<boolean>((resolve) => {
        const timer = clock.setTimeout(() => resolve(true), settlementMs);
        return () => clock.clearTimeout(timer);
      }),
      call(function*() {
        while (true) {
          yield* protocol.processEscrowsOnce();
          if (!unaccepted().length) return false;
          // Yield between ordinary sweeps; acceptance or the elapsed deadline ends settlement.
          yield* action<void>((resolve) => {
            const timer = clock.setTimeout(() => resolve(), 1);
            return () => clock.clearTimeout(timer);
          });
        }
      }),
    ]);
  }
  // The losing race child has joined cleanup before these final accepted-state reads.
  const remaining = unaccepted();
  if (expired) {
    consoleLogger.warn("Credential import settlement deadline expired", {
      timeoutMs: settlementMs,
      unaccepted: remaining,
    });
  }
  return {
    saved: targets.filter((target) =>
      target.ilk === null && !target.savedBefore && reger.saved.get([target.said]) !== null
    )
      .map(({ said }) => said),
    complete: remaining.length === 0,
    unaccepted: remaining,
  };
}

/**
 * Capture compact identities while dispatching each complete frame once, joining pending pulls and iterator return.
 *
 * @param protocol Borrowed dispatch owner; refusal diagnostics retain its actual decision detail.
 * @param reger Borrowed store for saved markers observed before first raw credential dispatch.
 * @param bytes Resident finite input, parsed incrementally before each dispatch.
 * @param kvy This input's Kevery over the shared accepted-state domain.
 * @returns Unique directly observed identities after parser EOF and joined source cleanup.
 */
function readImportTargets(
  protocol: ProtocolProcessor,
  reger: Reger,
  bytes: Uint8Array,
  kvy: Kevery,
): Operation<ImportTarget[]> {
  return call(function*() {
    const controller = new AbortController();
    const frames = parse(chunkBytes(bytes, { signal: controller.signal }));
    const targets = new Map<string, ImportTarget>();
    let pending: ReturnType<typeof frames.next> | undefined;
    // Handlers stop before this earlier resource joins reads and disposes the input iterator.
    yield* ensure(function*() {
      try {
        if (pending) {
          try {
            yield* call(() => pending!);
          } catch (error) {
            rethrowCleanupFailure(error, controller.signal);
          }
        }
      } finally {
        yield* call(() => frames.return());
      }
    });
    try {
      while (true) {
        pending = frames.next();
        let next: Awaited<typeof pending>;
        try {
          next = yield* call(() => pending!);
        } catch (error) {
          pending = undefined;
          throw error;
        }
        pending = undefined;
        if (next.done) return [...targets.values()];
        const serder = next.value.body;
        if (!(serder instanceof SerderACDC) && !(serder instanceof SerderKERI)) {
          throw new TypeError("Credential import requires a KERI or ACDC message");
        }
        // Capture savedBefore exactly once, before dispatch can publish this credential's marker.
        if (!targets.has(serder.said!)) {
          const target = importTarget(serder, reger);
          if (target) targets.set(target.said, target);
        }
        // The one dispatch that marks its input as retained history; see the operation docs.
        const { decision } = yield* protocol.dispatch(next.value, { retained: true }, kvy);
        if (decision && (decision.kind === "reject" || decision.kind === "drop")) {
          consoleLogger.warn("Credential import message refused", {
            said: serder.said,
            ilk: serder.ilk,
            pre: serder instanceof SerderKERI ? serder.pre : serder.issuer,
            reason: "reason" in decision ? decision.reason : decision.code,
            detail: "message" in decision ? decision.message : "detail" in decision ? decision.detail : undefined,
            cause: "cause" in decision ? decision.cause : undefined,
          });
        }
      }
    } finally {
      controller.abort();
    }
  });
}

/**
 * Project only coordinates for accepted records that this credential workflow observes.
 *
 * @param serder One directly imported message; embedded artifacts remain under their existing workflow owners.
 * @param reger Credential store used only to record a raw credential's pre-dispatch saved marker.
 * @returns Compact message identity, or null for messages handled without an importer completion predicate.
 */
function importTarget(serder: SerderACDC | SerderKERI, reger: Reger): ImportTarget | null {
  const said = serder.said!, ilk = serder.ilk;
  if (serder instanceof SerderACDC) {
    if (ilk === null) return { ilk, said, savedBefore: reger.saved.get([said]) !== null };
    if (ilk !== Ilks.rip && ilk !== Ilks.bup) return null;
    // An event that fails field validation, or whose ordinal no store can hold, keeps no coordinates, so it is
    // always reported unaccepted.
    const result = ilk === Ilks.rip ? validateRip(serder) : validateUpdate(serder, serder.regid ?? "");
    return result.kind === "valid" && result.event.sn <= BigInt(Number.MAX_SAFE_INTEGER)
      ? { ilk, said, regid: result.event.regid, sn: Number(result.event.sn) }
      : { ilk, said, regid: null, sn: null };
  }
  switch (ilk) {
    case Ilks.icp:
    case Ilks.dip:
    case Ilks.rot:
    case Ilks.drt:
    case Ilks.ixn:
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      return { ilk, said, pre: serder.pre, sn: serder.sn };
    case Ilks.exn:
    case Ilks.xip: {
      const prior = serder.sad?.p;
      const admit = serder.pvrsn.major >= 2 && serder.route === "/ipex/admit" && typeof prior === "string";
      return { ilk, said, answers: admit ? prior : null };
    }
    default:
      return null;
  }
}

/**
 * Observe the normal accepted record without consulting direct-attempt decisions.
 *
 * @param target Input identity; raw storage and unrelated latest heads do not establish its acceptance.
 * @param protocol Borrowed accepted KEL/exchange domain.
 * @param reger Borrowed accepted credential/TEL domain.
 * @returns Whether this exact message has its normal durable acceptance evidence.
 */
function importTargetAccepted(target: ImportTarget, protocol: ProtocolProcessor, reger: Reger): boolean {
  switch (target.ilk) {
    case null:
      return reger.saved.get([target.said]) !== null;
    case Ilks.icp:
    case Ilks.dip:
    case Ilks.rot:
    case Ilks.drt:
    case Ilks.ixn:
      return target.pre !== null && target.sn !== null
        && protocol.kvy.db.kels.getLast(target.pre, target.sn) === target.said;
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      return target.pre !== null && target.sn !== null && reger.tels.getOn(target.pre, target.sn)?.qb64 === target.said;
    case Ilks.rip:
    case Ilks.bup:
      return target.regid !== null && target.sn !== null
        && protocol.registry?.store.seqSaider(target.regid, target.sn)?.qb64 === target.said;
    case Ilks.exn:
    case Ilks.xip:
      return protocol.exc.complete(target.said)
        && (target.answers === null || protocol.kvy.db.erpy.get([target.answers])?.qb64 === target.said);
  }
}
