import { concatBytes } from "cesr-ts";
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

/**
 * Publish one replay catch-up payload after a successful `/ksn` style reply.
 *
 * This bridges the stale-but-recoverable case where a mailbox client learns
 * that the remote controller is ahead but still needs replay material quickly
 * enough to verify the new signer state.
 */
export function* publishQueryCatchupReplay(
  runtime: AgentRuntime,
  emissions: CueEmission[],
  pre: string,
  serviceHab?: Hab,
): Operation<void> {
  let destination: string | null = null;
  let sourceHab: Hab | null = serviceHab ?? null;
  for (const emission of emissions) {
    if (emission.kind !== "wire" || emission.cue.kin !== "reply") {
      continue;
    }
    if (
      emission.cue.route !== "/ksn" || typeof emission.cue.dest !== "string"
    ) {
      continue;
    }
    destination = emission.cue.dest;
    sourceHab = emission.cue.src
      ? runtime.hby.habs.get(emission.cue.src) ?? serviceHab ?? null
      : serviceHab ?? null;
    break;
  }
  if (!destination) {
    return;
  }

  const kever = runtime.hby.db.getKever(pre);
  const parts = [...runtime.hby.db.clonePreIter(pre, 0)];
  if (kever?.delpre) {
    parts.push(...runtime.hby.db.cloneDelegation(kever));
  }
  if (parts.length === 0) {
    return;
  }

  const message = Uint8Array.from(concatBytes(...parts));
  if (!sourceHab) {
    return;
  }
  try {
    yield* runtime.poster.sendBytes(sourceHab, {
      recipient: destination,
      topic: "/replay",
      message,
    });
  } catch {
    // Keep `/ksn` catch-up replay best-effort and let later polling converge.
  }
}
