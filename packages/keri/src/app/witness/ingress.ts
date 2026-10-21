/** Compose witness intake, local receipt production and cue publication within the host-owned lifetime. */
import { parse } from "cesr-ts";
import { call, ensure, type Operation } from "npm:effection@^3.6.0";
import type { AgentCue } from "../../core/cues.ts";
import { type Deck } from "../../core/deck.ts";
import { type Hab } from "../identity/habbing.ts";
import { rethrowCleanupFailure } from "../runtime/abortable.ts";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";
import { chunkBytes } from "../transport/byte-source.ts";

/** Return the active wire-message habitat or `null` when selection is ambiguous. */
function cueHab(runtime: AgentRuntime, serviceHab?: Hab): Hab | null {
  if (serviceHab) {
    return serviceHab;
  }
  const habitats = runtime.hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}

/**
 * Route one initial witness cue batch, leaving saved key-state facts for the
 * application cue worker and its optional command-owned noticer destination.
 * Respondant publishes Poster work; this ingress helper never drains Poster
 * network delivery. Query network I/O stays with the independent sender.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Optional hosted witness signer; absent selection must be unambiguous.
 * @param cues Exact runtime application Deck; foreign Decks are rejected.
 * @param options deliver defaults true: publish outgoing work for the independent senders. False performs local signing side effects only.
 */
export function* drainWitnessCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Deck<AgentCue>,
  { deliver = true }: { deliver?: boolean } = {},
): Operation<void> {
  if (cues !== runtime.cues) throw new RangeError("Witness cue drain requires the runtime source deck");
  const hab = cueHab(runtime, serviceHab);
  if (!hab) return;
  const count = cues.length;
  for (let index = 0; index < count; index++) {
    const cue = cues.peekHead();
    if (!cue) break;
    if (cue.kin === "keyStateSaved") {
      cues.pull();
      cues.append(cue);
      continue;
    }
    if (deliver) {
      if (cue.kin === "query") {
        runtime.querying.enqueueCue(cue, hab);
      } else if (cue.kin === "stream") {
        runtime.mailboxDirector.retainQueryCue(cue);
      } else if (["receipt", "witness", "replay", "reply"].includes(cue.kin)) {
        const msgs = [...hab.processCuesIter([cue])];
        runtime.respondant.enqueueMsgs(hab, cue, msgs);
      }
    } else {
      // Exhaust local signing side effects without collecting discarded wire.
      for (const _msg of hab.processCuesIter([cue])) { /* local proof persisted */ }
    }
    cues.pull();
  }
}

/** Witness-local dispatch and existing responder delivery policy for one ingress source. */
export interface WitnessIngressOptions {
  /** Accept with witness-local semantics; default false preserves ordinary ingress policy. */
  local?: boolean;
  /** Route queries/replies through their owners; receipts use false to produce their own finite proof. */
  deliver?: boolean;
}

/**
 * Own one witness input and settle each frame before requesting more input.
 * Each complete frame publishes its prepared replies before requesting more input.
 * Source abort and cleanup belong to this input scope.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Hosted witness/controller habitat used for local replies.
 * @param source Creates cancellation-aware wire input owned by this operation.
 * @param options local defaults false; deliver defaults true and controls cue publication, not Poster queue draining.
 */
export function* processWitnessIngressSource(
  runtime: AgentRuntime,
  serviceHab: Hab,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  { local = false, deliver = true }: WitnessIngressOptions = {},
): Operation<void> {
  yield* call(function*() {
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      signal.throwIfAborted();
      const frames = parse(source(signal));
      let pending: ReturnType<typeof frames.next> | undefined;
      // The earlier resource joins the read after processing children stop.
      yield* ensure(function*() {
        try {
          if (pending) {
            try {
              yield* call(() => pending!);
            } catch (error) {
              rethrowCleanupFailure(error, signal);
            }
          }
        } finally {
          yield* call(() => frames.return());
        }
      });
      while (true) {
        signal.throwIfAborted();
        pending = frames.next();
        let result: Awaited<typeof pending>;
        try {
          result = yield* call(() => pending!);
        } catch (error) {
          pending = undefined;
          throw error;
        }
        pending = undefined;
        signal.throwIfAborted();
        if (result.done) break;
        const frame = result.value;
        yield* runtime.protocol.dispatch(frame, { local, escrows: true });
        yield* drainWitnessCues(runtime, serviceHab, runtime.cues, { deliver });
      }
    } finally {
      controller.abort();
    }
  });
}

/**
 * Parse and settle one inbound witness-host payload.
 *
 * This is the witness-host counterpart to generic runtime ingress.
 *
 * Responsibilities:
 * - settle one inbound CESR payload with the correct witness-local semantics
 * - immediately drain the resulting cues through the hosted witness habitat
 * - leave request-scoped receipt construction with the endpoint owner
 *
 * `local=true` is the crucial switch for the witness receipt path: accepted
 * events that list the hosted witness emit `witness` cues instead of ordinary
 * `receipt` cues.
 *
 * Durable routing rule:
 * - TCP witness ingress, witness `/receipts`, and ordinary HTTP root ingress
 *   that targets the hosted witness AID should all reach this seam when the
 *   host is acting as that witness
 * - generic runtime ingress should remain separate for mailbox streaming,
 *   `/ksn` replay publication, and other non-witness-root policies
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Hosted reply signer.
 * @param bytes Finite signed input bytes adapted to the same source path.
 * @param options Witness intake/local-production policy forwarded to processWitnessIngressSource.
 */
export function* processWitnessIngress(
  runtime: AgentRuntime,
  serviceHab: Hab,
  bytes: Uint8Array,
  options: WitnessIngressOptions = {},
): Operation<void> {
  yield* processWitnessIngressSource(
    runtime,
    serviceHab,
    (signal) => chunkBytes(bytes, { signal }),
    options,
  );
}
