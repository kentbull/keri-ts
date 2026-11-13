import { type Operation } from "npm:effection@^3.6.0";
import type { AgentCue, EndRoleSavedCue } from "../../core/cues.ts";
import type { Deck } from "../../core/deck.ts";
import { Roles } from "../../core/roles.ts";
import type { Hab } from "../identity/habbing.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { type DoerPacing, doEvery, PROTOCOL_PACING } from "./doing.ts";

/**
 * Use an explicitly selected or sole local habitat; never guess among hosted identities.
 *
 * @param runtime Borrowed composed runtime containing the actual cue consumers.
 * @param hab Explicit signing habitat; omission requires a sole local habitat.
 * @returns Explicit or sole habitat, otherwise null.
 */
function resolveCueHab(runtime: AgentRuntime, hab?: Hab): Hab | null {
  if (hab) return hab;
  const habitats = runtime.hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}

/**
 * Hand an accepted mailbox end role to the KEL publisher and the mailbox poller, so both look at its controller on
 * their next tock rather than at their next sweep. Other roles concern neither.
 *
 * @param runtime Borrowed composed runtime containing the publisher and poller.
 * @param cue The committed end-role fact from `Revery`.
 */
export function promptForEndRole(runtime: AgentRuntime, cue: EndRoleSavedCue): void {
  if (cue.role !== Roles.mailbox) return;
  runtime.kelPublisher.prompt(cue.cid);
  runtime.mailboxPoller.prompt(cue.cid);
}

/**
 * Route one initial cue batch to its concrete owners before removing source records.
 *
 * Transfer query instructions to the sender, stream cues to mailbox correlation,
 * accepted mailbox end roles to the KEL publisher and poller, and produced responder
 * messages to Poster. No network delivery runs inline.
 * A responder cue whose signing habitat cannot sign yet moves to the tail and is
 * tried again on a later pass; the cues behind it still go now.
 * Saved key-state facts transfer once to the command's optional query Deck;
 * its noticer never competes with this worker over the runtime source Deck.
 * Admission and source removal run synchronously within this finite batch.
 *
 * @param runtime Borrowed composed runtime containing the actual cue consumers.
 * @param options Explicit signer and optional command-owned query cue destination.
 * Without a query destination, saved notices retain the ordinary unhandled-cue behavior.
 */
export function* processCuesOnce(
  runtime: AgentRuntime,
  { hab, queryCues }: { hab?: Hab; queryCues?: Deck<AgentCue> } = {},
): Operation<void> {
  const interpreter = resolveCueHab(runtime, hab);
  const count = runtime.cues.length;
  for (let index = 0; index < count; index++) {
    const cue = runtime.cues.peekHead();
    if (!cue) break;
    if (cue.kin === "kramRefused") {
      // Pulled first: a faulty sink must not wedge the head of the Deck.
      runtime.cues.pull();
      runtime.changes?.push({ kind: "kramRefused", id: cue.said, refusal: cue });
      continue;
    }
    if (cue.kin === "endRoleSaved") {
      runtime.cues.pull();
      promptForEndRole(runtime, cue);
      continue;
    }
    if (cue.kin === "query") {
      runtime.querying.enqueueCue(cue, interpreter);
    } else if (cue.kin === "stream") {
      runtime.mailboxDirector.retainQueryCue(cue);
    } else if (interpreter) {
      const outcome = runtime.respondant.enqueueCue(interpreter, runtime.cues, hab);
      if (outcome === "taken") continue;
      if (outcome === "unsignable") {
        // Kept for a later pass, behind the cues that can go now; `count` bounds this pass.
        runtime.cues.append(runtime.cues.pull()!);
        continue;
      }
    }
    runtime.cues.pull();
    if (cue.kin === "keyStateSaved") queryCues?.append(cue);
  }
}

/**
 * Continuous cue worker; network output belongs to the concrete query and reply workers.
 *
 * @param runtime Borrowed composed runtime containing the actual cue consumers.
 * @param options Explicit signer and optional command-owned query cue destination.
 */
export function* cueDo(
  runtime: AgentRuntime,
  options: { hab?: Hab; queryCues?: Deck<AgentCue> } = {},
  pacing: Readonly<DoerPacing> = PROTOCOL_PACING,
): Operation<never> {
  return yield* doEvery(runtime.clock, pacing.tockMs, () => processCuesOnce(runtime, options));
}
