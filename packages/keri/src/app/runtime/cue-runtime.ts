import { type Operation } from "npm:effection@^3.6.0";
import type { AgentCue } from "../../core/cues.ts";
import type { Deck } from "../../core/deck.ts";
import type { Hab } from "../identity/habbing.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { runtimeTurn } from "./runtime-turn.ts";

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
 * Route one initial cue batch to its concrete owners before removing source records.
 *
 * Transfer query instructions to the sender, stream cues to mailbox correlation
 * and produced responder messages to Poster. No network delivery runs inline.
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
    if (cue.kin === "query") {
      runtime.querying.enqueueCue(cue, interpreter);
    } else if (cue.kin === "stream") {
      runtime.mailboxDirector.retainQueryCue(cue);
    } else if (interpreter && runtime.respondant.enqueueCue(interpreter, runtime.cues, hab)) {
      continue;
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
): Operation<never> {
  while (true) {
    yield* processCuesOnce(runtime, options);
    yield* runtimeTurn();
  }
}
