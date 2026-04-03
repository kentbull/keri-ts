import { type Operation } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import type { Hab } from "./habbing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/**
 * Host-facing sink for structured cue emissions.
 *
 * The shared runtime interprets cues into `CueEmission`s, then hands those
 * emissions to the active host. This keeps host delivery separate from habitat
 * semantics without reintroducing a root-owned transport queue.
 */
export interface CueSink {
  send(emission: CueEmission): Operation<void>;
}

function* ignoreEmission(_emission: CueEmission): Operation<void> {
  return;
}

/** Default cue sink used when the host does not care about cue side effects. */
export const ignoreCueSink: CueSink = { send: ignoreEmission };

/**
 * Resolve the habitat used to interpret habitat-owned cue semantics.
 *
 * Rule:
 * - prefer an explicitly supplied habitat
 * - otherwise use the sole local habitat when the habery owns exactly one
 * - otherwise return `null` so the runtime can preserve the cue as a host
 *   notification without guessing which local habitat should sign for it
 */
function resolveCueHab(
  runtime: AgentRuntime,
  hab?: Hab,
): Hab | null {
  if (hab) {
    return hab;
  }
  const habitats = [...runtime.hby.habs.values()];
  return habitats.length === 1 ? habitats[0] ?? null : null;
}

/**
 * Fallback cue-emission generator used when no local habitat can interpret the
 * current cue deck.
 *
 * This keeps command-local resolvers and multi-hab hosts from silently losing
 * cues while still refusing to guess which habitat should sign wire messages.
 */
function* emitWithoutHab(
  runtime: AgentRuntime,
): Generator<CueEmission> {
  while (!runtime.cues.empty) {
    const cue = runtime.cues.pull();
    if (!cue) {
      continue;
    }
    yield {
      cue,
      msgs: [],
      kind: cue.kin === "stream" ? "transport" : "notify",
    };
  }
}

/**
 * Drain one bounded cue-processing pass for a shared runtime host.
 *
 * When a habitat is available, cue interpretation stays habitat-owned via
 * `Hab.processCuesIter()`. When no habitat can be resolved, cues are still
 * surfaced to the host as notify/transport emissions instead of being dropped.
 */
export function* processCuesOnce(
  runtime: AgentRuntime,
  {
    hab,
    sink = ignoreCueSink,
  }: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<void> {
  const cueHab = resolveCueHab(runtime, hab);
  const emissions = cueHab
    ? cueHab.processCuesIter(runtime.cues)
    : emitWithoutHab(runtime);

  for (const emission of emissions) {
    yield* sink.send(emission);
  }
}

/**
 * Continuous cue doer for long-lived runtime hosts.
 *
 * This is the Effection analogue of the KERIpy `cueDo` loop: interpret any
 * pending cues, hand them to the host sink, yield, and repeat forever.
 */
export function* cueDo(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<never> {
  while (true) {
    yield* processCuesOnce(runtime, options);
    yield* runtimeTurn();
  }
}
