import { type Operation } from "npm:effection@^3.6.0";
import type { AgentRuntime } from "./agent-runtime.ts";
import type { Hab } from "./habbing.ts";
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
 * A source fact leaves the shared Deck before a live key-state broadcast can
 * suspend, preventing another cue turn from publishing that same head twice.
 * Subscribers receive independent copies of the fact; they do not own this Deck.
 *
 * @param runtime Borrowed composed runtime containing the actual cue consumers.
 * @param options Explicit signing habitat; omission requires a sole local habitat.
 */
export function* processCuesOnce(
  runtime: AgentRuntime,
  { hab }: { hab?: Hab } = {},
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
    // Transfer the routed fact before yielding to its live consumers.
    if (cue.kin === "keyStateSaved") yield* runtime.keyStateUpdates.send(cue);
  }
}

/**
 * Continuous cue worker; network output belongs to the concrete query and reply workers.
 *
 * @param runtime Borrowed composed runtime containing the actual cue consumers.
 * @param options Explicit signing habitat; omission requires a sole local habitat.
 */
export function* cueDo(runtime: AgentRuntime, options: { hab?: Hab } = {}): Operation<never> {
  while (true) {
    yield* processCuesOnce(runtime, options);
    yield* runtimeTurn();
  }
}
