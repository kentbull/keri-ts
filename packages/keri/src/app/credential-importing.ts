/** Finite credential-bundle intake and input-scoped acceptance reporting. */
import { type CesrFrame, Ilks, parse, SerderACDC, SerderKERI } from "cesr-ts";
import { action, call, ensure, type Operation, race } from "npm:effection@^3.6.0";
import type { Kevery } from "../core/eventing.ts";
import type { Reger } from "../db/reger.ts";
import { rethrowCleanupFailure } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { type DispatchDecision, envelopeFromFrame } from "./parsering.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";

/** Acceptance evidence required by each directly imported message, excluding grant children. */
export interface CredentialImportTargetResult {
  /** Credential body, accepted KEL/TEL event, exchange, or an input without a supported acceptance predicate. */
  kind: "credential" | "kel" | "tel" | "exchange" | "unsupported";
  /** Content-addressed message identifier; duplicate sightings share one result. */
  said: string;
  /** alreadyAccepted was observed before this target's first dispatch; unresolved never means invalid. */
  status: "accepted" | "alreadyAccepted" | "unresolved" | "rejected";
  /** Last observed refusal/dependency reason, or the absence of a supported acceptance predicate. */
  reason?: string;
}

/** Parsing reaches EOF before this result; protocol acceptance remains explicit for each target. */
export interface CredentialImportResult {
  /** Newly accepted raw credential SAIDs from this input only; unrelated escrow recoveries are excluded. */
  saved: string[];
  /** True only when every directly imported target has persisted acceptance evidence. */
  complete: boolean;
  /** One result per message kind/SAID, in first-seen order; a grant does not add embedded credential targets. */
  targets: CredentialImportTargetResult[];
}

/** Input-owned evidence retained only until this finite import returns or is cancelled. */
interface ImportTarget {
  /** Complete parsed frame used to reassess an unresolved target through ordinary serialized dispatch. */
  frame: CesrFrame;
  /** Parsed message identity; accepted rows are checked by exact event digest, not latest-head presence. */
  serder: SerderACDC | SerderKERI;
  /** Public acceptance category of this input message. */
  kind: CredentialImportTargetResult["kind"];
  /** Whether persisted acceptance preceded this target's first dispatch. */
  alreadyAccepted: boolean;
  /** Most recent direct protocol decision; exceptions are never converted into target results. */
  decision: DispatchDecision;
}

/**
 * Consume finite bytes, then give their unresolved targets a bounded local settlement window.
 * This operation owns its parser/Kevery and starts no network, mailbox or host workers.
 * Each frame is dispatched before the next is parsed; later failures preserve earlier accepted state.
 *
 * @param protocol Borrowed serialized KEL/TEL/credential/exchange owner, sharing reger with its credential handlers.
 * @param reger Borrowed credential/TEL store whose accepted markers establish import results.
 * @param bytes Borrowed complete CESR bundle; parser chunks are copied during intake.
 * @param clock Borrowed epoch-millisecond clock and cancellable elapsed-millisecond timers.
 * @param timeoutMs Positive finite post-EOF settlement budget in milliseconds, default 5000; floored with a one-millisecond minimum. No network discovery occurs.
 * @returns Input-scoped acceptance results after EOF/cleanup and local settlement or its deadline. Missing dependencies remain unresolved.
 * @throws Validation, parser, storage, handler and cleanup failures propagate with partial accepted state intact. Cancellation joins active work.
 */
export function* importCredentialStream(
  protocol: ProtocolProcessor,
  reger: Reger,
  bytes: Uint8Array,
  clock: RuntimeClock,
  timeoutMs = 5_000,
): Operation<CredentialImportResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Import timeout must be finite and positive");
  if (protocol.vry?.reger !== reger || protocol.tvy?.reger !== reger) {
    throw new TypeError("Credential import requires TEL and credential processors sharing its Reger");
  }
  const kvy = protocol.makeKevery();
  const targets = yield* readImportTargets(protocol, reger, bytes, kvy);
  /** Unsupported inputs have no local predicate to settle; report them unresolved without polling them. */
  const pending = () =>
    targets.filter((target) =>
      target.kind !== "unsupported"
      && importTargetResult(target, protocol, reger).status === "unresolved"
    );

  if (pending().length) {
    yield* race([
      call(function*() {
        while (pending().length) {
          // Normal dispatch exposes refusals that an escrow retry does not otherwise return to this input owner.
          for (const target of pending()) target.decision = (yield* protocol.dispatch(target.frame, {}, kvy)).decision;
          // Once this input is settled, unrelated escrow handlers must not delay its result.
          if (!pending().length) return;
          yield* protocol.processEscrowsOnce();
          if (!pending().length) return;
          // Yield between local passes; an unchanged credential count is not a fixed-point proof.
          yield* action<void>((resolve) => {
            const timer = clock.setTimeout(() => resolve(), 25);
            return () => clock.clearTimeout(timer);
          });
        }
      }),
      action<void>((resolve) => {
        const timer = clock.setTimeout(() => resolve(), Math.max(1, Math.floor(timeoutMs)));
        return () => clock.clearTimeout(timer);
      }),
    ]);
  }
  // Deadline cancellation joins the active handler before these final accepted-state reads.
  const outcomes = targets.map((target) => importTargetResult(target, protocol, reger));
  return {
    // Preserve actual new saves even if a later duplicate of that body carries a refused proof.
    saved: targets.filter((target) =>
      target.kind === "credential" && !target.alreadyAccepted
      && importTargetAccepted(target, protocol, reger)
    ).map((target) => target.serder.said!),
    complete: outcomes.every((target) => target.status === "accepted" || target.status === "alreadyAccepted"),
    targets: outcomes,
  };
}

/**
 * Capture targets while dispatching one complete frame at a time; own pending pulls and iterator return through cancellation.
 *
 * @param protocol Borrowed serialized dispatch owner.
 * @param reger Borrowed store for acceptance observed before first dispatch.
 * @param bytes Resident finite input; no whole-bundle parse occurs before dispatch.
 * @param kvy This import's Kevery over the shared accepted-state domain.
 * @returns Unique directly imported targets after joined parser/source EOF cleanup.
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
    // Register source cleanup before dispatch resources so active handlers stop before iterator disposal.
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
        // Read identity before dispatch so an existing saved marker is not mistaken for this import's work.
        const envelope = envelopeFromFrame(next.value).serder;
        if (!(envelope instanceof SerderACDC) && !(envelope instanceof SerderKERI)) {
          throw new TypeError("Credential import requires a KERI or ACDC message");
        }
        const kind = importKind(envelope);
        const key = `${kind}:${envelope.said}`;
        let target = targets.get(key);
        if (!target) {
          target = { frame: next.value, serder: envelope, kind, alreadyAccepted: false, decision: undefined };
          target.alreadyAccepted = importTargetAccepted(target, protocol, reger);
          targets.set(key, target);
        }
        target.frame = next.value;
        target.decision = (yield* protocol.dispatch(next.value, {}, kvy)).decision;
      }
    } finally {
      controller.abort();
    }
  });
}

/**
 * Classify only directly dispatched messages; embedded exchange artifacts remain behind explicit IPEX workflows.
 *
 * @param serder Parsed message body whose own acceptance is being reported.
 * @returns The persistent acceptance family, or unsupported when this importer has no honest predicate.
 */
function importKind(serder: SerderACDC | SerderKERI): ImportTarget["kind"] {
  if (serder instanceof SerderACDC) return serder.ilk === null ? "credential" : "unsupported";
  switch (serder.ilk) {
    case Ilks.icp:
    case Ilks.dip:
    case Ilks.rot:
    case Ilks.drt:
    case Ilks.ixn:
      return "kel";
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      return "tel";
    case Ilks.exn:
      return "exchange";
    default:
      return "unsupported";
  }
}

/**
 * Read exact accepted evidence; raw body storage and a registry's unrelated/latest head are insufficient.
 *
 * @param target Directly imported identity and acceptance family.
 * @param protocol Borrowed KEL/exchange store owner.
 * @param reger Borrowed credential/TEL accepted-evidence store.
 * @returns Whether the target itself has a persisted acceptance marker.
 */
function importTargetAccepted(target: ImportTarget, protocol: ProtocolProcessor, reger: Reger): boolean {
  const { serder } = target;
  switch (target.kind) {
    case "credential":
      return reger.saved.get([serder.said!]) !== null;
    case "kel":
      return serder instanceof SerderKERI && serder.pre !== null && serder.sn !== null
        && protocol.kvy.db.kels.getLast(serder.pre, serder.sn) === serder.said;
    case "tel":
      return serder instanceof SerderKERI && serder.pre !== null && serder.sn !== null
        && reger.tels.getOn(serder.pre, serder.sn)?.qb64 === serder.said;
    case "exchange":
      return protocol.kvy.db.exns.get([serder.said!]) !== null;
    case "unsupported":
      return false;
  }
}

/**
 * Combine the last direct decision with current persisted acceptance without converting missing evidence into rejection.
 *
 * @param target Input-owned message identity and most recent direct dispatch result.
 * @param protocol Borrowed accepted KEL/exchange domain.
 * @param reger Borrowed accepted credential/TEL domain.
 * @returns Public input outcome; a direct refusal takes precedence over older persisted evidence for the same body.
 */
function importTargetResult(
  target: ImportTarget,
  protocol: ProtocolProcessor,
  reger: Reger,
): CredentialImportTargetResult {
  const { kind, serder, decision } = target;
  const identity = { kind, said: serder.said! };
  if (decision && (decision.kind === "reject" || decision.kind === "drop")) {
    const reason = "message" in decision ? decision.message : decision.reason;
    return { ...identity, status: "rejected", reason };
  }
  if (importTargetAccepted(target, protocol, reger)) {
    return { ...identity, status: target.alreadyAccepted ? "alreadyAccepted" : "accepted" };
  }
  return {
    ...identity,
    status: "unresolved",
    reason: kind === "unsupported"
      ? "No finite-import acceptance predicate for this message kind"
      : decision && "reason" in decision
      ? decision.reason
      : "No accepted evidence after local processing",
  };
}
