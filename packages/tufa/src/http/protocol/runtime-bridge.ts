import { ResourceAdmissionError } from "cesr-ts";
import { type Operation } from "effection";
import {
  type AgentCue,
  type AgentRuntime,
  type CueQueueInput,
  type CueSink,
  DeckFullError,
  type Hab,
  processCuesOnce,
  queryTransportSink,
} from "keri-ts/runtime";

/**
 * Drain one finite HTTP cue pass: immediate guarded transfers retain deliveries,
 * mailbox correlations and pending queries; borrowed fallback emissions stay owned
 * through joined sink cleanup outside Reactor. Busy preserves the source head.
 */
export function* drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: CueQueueInput,
  onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
): Operation<void> {
  if (cues !== runtime.cues) throw new RangeError("HTTP cue drain requires the runtime source deck");
  const habitats = runtime.hby.habs.values();
  const first = habitats.next();
  const hab = serviceHab ?? (first.done || !habitats.next().done ? null : first.value);
  if (!hab) return;
  const transport = queryTransportSink(runtime, runtime.hby, hab);
  const destination: CueSink = {
    admitQuery: transport.admitQuery,
    admitCue: (current, interpreter) => runtime.respondant.admitCue(current, interpreter, hab),
    send: (emission) => runtime.respondant.sendWithHab(emission, hab),
  };
  let refusal: ResourceAdmissionError | DeckFullError | undefined;
  const note = (error: ResourceAdmissionError | DeckFullError) => {
    refusal = error;
    if (error instanceof ResourceAdmissionError) onAdmissionRefusal?.(error);
  };
  const sink: CueSink = {
    admitCue: (current, interpreter) => runtime.querying.admitCue(current, interpreter, destination),
    prepareEmission(emission) {
      if (emission.kind === "transport" && emission.cue.kin === "stream") {
        runtime.mailboxDirector.retainQueryCue(emission.cue, note);
      } else if (emission.cue.kin === "query" && emission.kind !== "wire") {
        runtime.querying.enqueueCue(emission.cue, note);
      }
      return emission;
    },
    *sendPrepared(emission) {
      yield* runtime.reactor.settle(undefined, {}, function*() {
        runtime.querying.observeCue(emission.cue);
      });
      if (emission.cue.kin !== "stream" && emission.cue.kin !== "query") {
        yield* destination.send(emission);
      }
    },
    send: destination.send,
  };
  try {
    yield* processCuesOnce(runtime, { hab, sink, onAdmissionRefusal });
  } catch (error) {
    if (!refusal || error !== refusal || !(refusal instanceof DeckFullError || refusal.reason === "busy")) throw error;
  }
  // Network/capacity checks run after the synchronous guarded transfers.
  yield* runtime.deliveries.process(runtime);
}
