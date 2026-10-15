import { call, type Operation } from "npm:effection@^3.6.0";
import type { AgentCue } from "../core/cues.ts";
import type { CueEmission, QueryCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { prepareCueEmission } from "./cue-preparation.ts";
import type { Hab } from "./habbing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** Immediate source-head transfer; busy preserves it, ineligible uses existing interpretation/sink handling. */
export type CueAdmission = "transferred" | "busy" | "ineligible";

/** Host-facing emissions and optional synchronous transfer of the guarded source head. */
export interface CueSink {
  /** Synchronous guarded admission only: no waiting, reentry or destructive fallback on capacity refusal. */
  admitCue?(source: Deck<AgentCue>, interpreter: Hab | null): CueAdmission;
  /** Admit source retention and one finite query before invoking its synchronous signing/route preparation. */
  admitQuery?(cue: QueryCue, prepare: () => CueEmission | null): CueAdmission;
  /** Synchronous local transformation under admitted interpretation/output credit and the Reactor guard. */
  prepareEmission?(emission: CueEmission): CueEmission;
  /** Delivery of a prepared emission; all waits/cleanup run outside the guard. */
  sendPrepared?(emission: CueEmission): Operation<void>;
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
  const habitats = runtime.hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}

/**
 * Drain one bounded cue-processing pass for a shared runtime host.
 *
 * Eligible sinks immediately transfer admitted work before source removal.
 * Ineligible/custom cues are interpreted in a short turn; sink waits and actual
 * I/O cleanup run outside the guard.
 * Only the initial bounded batch is drained. When no habitat can be resolved, cues are still
 * surfaced to the host as notify/transport emissions instead of being dropped.
 */
export function processCuesOnce(
  runtime: AgentRuntime,
  {
    hab,
    sink = ignoreCueSink,
  }: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<void> {
  return call(function*() {
    let cueHab: Hab | null = null, count = 0;
    yield* runtime.reactor.settle(undefined, {}, function*() {
      cueHab = resolveCueHab(runtime, hab);
      count = runtime.cues.length;
    });
    for (let index = 0; index < count; index++) {
      const more = yield* call(function*() {
        let emission: CueEmission | undefined;
        const result: { admission: CueAdmission; prepared: boolean } = { admission: "ineligible", prepared: false };
        yield* runtime.reactor.settle(undefined, {}, function*() {
          result.admission = sink.admitCue?.(runtime.cues, cueHab) ?? "ineligible";
          if (result.admission === "transferred" || result.admission === "busy") return;
          if (result.admission !== "ineligible") throw new TypeError("Invalid immediate cue admission");
          result.prepared = prepareCueEmission(
            cueHab,
            runtime.cues,
            (prepared) => {
              emission = prepared;
              return undefined;
            },
            (emission) => sink.prepareEmission?.(emission) ?? emission,
          );
        });
        if (result.admission === "busy") return false;
        if (result.admission === "transferred") return true;
        if (!result.prepared) return false;
        if (emission) yield* (sink.sendPrepared ?? sink.send).call(sink, emission);
        return true;
      });
      if (!more) break;
    }
  });
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
