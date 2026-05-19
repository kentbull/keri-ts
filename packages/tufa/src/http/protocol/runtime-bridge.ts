import type { Operation } from "effection";
import { type AgentRuntime, type CueEmission, type Hab, settleRuntimeIngress } from "keri-ts/runtime";

/**
 * Ingest one mailbox-aware request payload through the shared runtime.
 *
 * The request-scoped mailbox AID is set only for the duration of parsing and
 * cue handling so `/fwd` authorization can stay tied to the mailbox endpoint
 * that actually received the request.
 */
export function* processRuntimeRequest(
  runtime: AgentRuntime,
  bytes: Uint8Array,
  mailboxAid: string | null,
  serviceHab?: Hab,
): Operation<CueEmission[]> {
  runtime.mailboxDirector.withActiveMailboxAid(mailboxAid, () => {
    settleRuntimeIngress(runtime, [bytes]);
  });
  return yield* drainRuntimeCues(runtime, serviceHab);
}

/**
 * Drain runtime cues through one service habitat and mailbox side effects.
 *
 * `Hab.processCuesIter(...)` remains the cue-to-wire interpreter; the request
 * layer owns mailbox publication side effects needed before HTTP responses are
 * finalized.
 */
export function* drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab?: Hab,
): Operation<CueEmission[]> {
  const habitats = [...runtime.hby.habs.values()];
  const hab = serviceHab
    ?? (habitats.length === 1 ? habitats[0] ?? null : null);
  if (!hab) {
    return [];
  }

  const emissions: CueEmission[] = [];
  for (const emission of hab.processCuesIter(runtime.cues)) {
    yield* runtime.respondant.sendWithHab(emission, hab);
    emissions.push(emission);
  }
  return emissions;
}
