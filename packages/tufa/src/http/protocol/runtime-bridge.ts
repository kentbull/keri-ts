import { type Operation } from "effection";
import {
  type AgentCue,
  type AgentRuntime,
  type CueSink,
  type Deck,
  type Hab,
  processCuesOnce,
  queryTransportSink,
  respondantCueSink,
} from "keri-ts/runtime";

/**
 * Drain one finite HTTP cue pass: immediate guarded transfers retain deliveries,
 * mailbox correlations and pending queries; borrowed fallback emissions stay owned
 * through joined sink cleanup outside Reactor. Busy preserves the source head.
 */
export function* drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Deck<AgentCue>,
): Operation<void> {
  if (cues !== runtime.cues) throw new RangeError("HTTP cue drain requires the runtime source deck");
  const habitats = runtime.hby.habs.values();
  const first = habitats.next();
  const hab = serviceHab ?? (first.done || !habitats.next().done ? null : first.value);
  if (!hab) return;
  const transport = queryTransportSink(runtime, hab);
  const responder = respondantCueSink(runtime, hab);
  const destination: CueSink = {
    admitQuery: transport.admitQuery,
    admitCue: responder.admitCue,
    send: (emission) => runtime.respondant.sendWithHab(emission, hab),
  };
  const sink: CueSink = {
    admitCue: (source, interpreter) => runtime.querying.admitCue(source, interpreter, destination),
    prepareEmission(emission) {
      if (emission.kind === "transport" && emission.cue.kin === "stream") {
        runtime.mailboxDirector.retainQueryCue(emission.cue);
      } else if (emission.cue.kin === "query" && emission.kind !== "wire") {
        runtime.querying.enqueueCue(emission.cue);
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
  yield* processCuesOnce(runtime, { hab, sink });
  // Network/capacity checks run after the synchronous guarded transfers.
  yield* runtime.querying.deliverOnce();
  yield* runtime.respondant.process();
}
