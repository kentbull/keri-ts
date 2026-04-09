import { concatBytes } from "../../../../cesr/mod.ts";
import type { CueEmission } from "../../core/cues.ts";
import { type AgentRuntime, settleRuntimeIngress } from "../agent-runtime.ts";
import type { Hab } from "../habbing.ts";

/**
 * Ingest one mailbox-aware request payload through the shared runtime.
 *
 * The request-scoped mailbox AID is set only for the duration of parsing and
 * cue handling so `/fwd` authorization can stay tied to the mailbox endpoint
 * that actually received the request.
 */
export function processRuntimeRequest(
  runtime: AgentRuntime,
  bytes: Uint8Array,
  mailboxAid: string | null,
  serviceHab?: Hab,
): CueEmission[] {
  runtime.mailboxDirector.withActiveMailboxAid(mailboxAid, () => {
    settleRuntimeIngress(runtime, [bytes]);
  });
  return drainRuntimeCues(runtime, serviceHab);
}

/**
 * Drain runtime cues through one service habitat and mailbox side effects.
 *
 * `Hab.processCuesIter(...)` remains the cue-to-wire interpreter; the request
 * layer owns mailbox publication side effects needed before HTTP responses are
 * finalized.
 */
export function drainRuntimeCues(
  runtime: AgentRuntime,
  serviceHab?: Hab,
): CueEmission[] {
  const habitats = [...runtime.hby.habs.values()];
  const hab = serviceHab
    ?? (habitats.length === 1 ? habitats[0] ?? null : null);
  if (!hab) {
    return [];
  }

  const emissions: CueEmission[] = [];
  for (const emission of hab.processCuesIter(runtime.cues)) {
    runtime.mailboxDirector.handleEmission(emission);
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
export function publishQueryCatchupReplay(
  runtime: AgentRuntime,
  emissions: CueEmission[],
  pre: string,
): void {
  let destination: string | null = null;
  for (const emission of emissions) {
    if (emission.kind !== "wire" || emission.cue.kin !== "reply") {
      continue;
    }
    if (emission.cue.route !== "/ksn" || typeof emission.cue.dest !== "string") {
      continue;
    }
    destination = emission.cue.dest;
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

  runtime.mailboxDirector.publish(
    destination,
    "/replay",
    Uint8Array.from(concatBytes(...parts)),
  );
}
