import { type Operation, spawn } from "npm:effection@^3.6.0";
import { Deck } from "../core/deck.ts";
import type { AgentCue } from "../core/cues.ts";
import type {
  KeriDispatchEnvelope,
  TransIdxSigGroup,
} from "../core/dispatch.ts";
import type { Hab, Habery } from "./habbing.ts";
import { cueDo, type CueSink, processCuesOnce } from "./cue-runtime.ts";
import { Reactor } from "./reactor.ts";
import { Oobiery, type OobiJob } from "./oobiery.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/**
 * Shared runtime host mode.
 *
 * These modes describe where the same `AgentRuntime` bundle is being hosted,
 * not different implementations. Gate E uses `local` for command-hosted work
 * and `indirect` for the long-lived HTTP OOBI host.
 */
export type AgentMode = "local" | "indirect" | "direct" | "both";

export type { KeriDispatchEnvelope, OobiJob, TransIdxSigGroup };
export type { CueSink };

/**
 * Shared runtime composition root owned by one `Habery`.
 *
 * Ownership model:
 * - the root keeps only truly shared state: `hby`, host `mode`, and the shared
 *   cue deck
 * - topic-local state belongs to the component that owns that flow
 * - `Reactor` owns parser ingress/routing/escrow work
 * - `Oobiery` owns durable OOBI queue processing
 *
 * KERIpy mental model:
 * - this is the closest local analogue to a composition root that assembles
 *   multiple doer-owning components, not a bag of every runtime queue
 */
export interface AgentRuntime {
  hby: Habery;
  mode: AgentMode;
  cues: Deck<AgentCue>;
  reactor: Reactor;
  oobiery: Oobiery;
}

/**
 * Construction options for the shared `AgentRuntime` bundle.
 *
 * The runtime intentionally has a small option surface in Gate E so command-
 * local hosting and long-lived hosting stay behaviorally aligned.
 */
export interface AgentRuntimeOptions {
  mode?: AgentMode;
}

/**
 * Create the shared runtime composition root used by CLI commands and
 * `tufa agent`.
 *
 * Construction rule:
 * - every host mode uses the same shared cue deck and the same component
 *   classes
 * - hosting style changes where the runtime is run, not what it is
 */
export function createAgentRuntime(
  hby: Habery,
  options: AgentRuntimeOptions = {},
): AgentRuntime {
  const cues = new Deck<AgentCue>();
  const reactor = new Reactor(hby, { cues });
  const oobiery = new Oobiery(hby, reactor, { cues });
  return {
    hby,
    mode: options.mode ?? "local",
    cues,
    reactor,
    oobiery,
  };
}

/**
 * Queue one CESR/KERI message byte sequence for runtime parsing.
 *
 * This is the supported ingress seam for both local synthetic messages and
 * remotely fetched OOBI material.
 */
export function ingestKeriBytes(
  runtime: AgentRuntime,
  bytes: Uint8Array,
): void {
  runtime.reactor.ingest(bytes);
}

/**
 * Queue one OOBI resolution job through the durable OOBI component.
 *
 * Unlike the older bootstrap runtime, this no longer stages jobs on a root
 * in-memory deck. The authoritative queue is the `oobis.` database family.
 */
export function enqueueOobi(runtime: AgentRuntime, job: OobiJob): void {
  runtime.oobiery.resolve(job.url, job.alias);
}

/**
 * Drain one bounded runtime turn by delegating to component-owned flows.
 *
 * Turn order:
 * 1. `Reactor.processOnce()` drains queued ingress
 * 2. `Oobiery.processOnce()` resolves at most one durable OOBI record
 * 3. `processCuesOnce()` emits cues from fresh ingress/OOBI work
 * 4. `Reactor.processEscrowsOnce()` runs KEL and reply escrow passes
 * 5. `processCuesOnce()` emits cues created during escrow progress
 *
 * This helper remains because command-local CLI flows and focused tests need a
 * single deterministic step without having to spawn the long-lived doers.
 */
export function* processRuntimeTurn(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<void> {
  runtime.reactor.processOnce();
  yield* runtime.oobiery.processOnce();
  yield* processCuesOnce(runtime, options);
  runtime.reactor.processEscrowsOnce();
  yield* processCuesOnce(runtime, options);
}

/**
 * Yield cooperatively back to the host scheduler between runtime turns.
 *
 * Re-exported here because earlier Gate E helpers imported the scheduler
 * boundary from `agent-runtime.ts`, and the boundary still conceptually belongs
 * to the shared runtime surface even though components use it internally too.
 */
export { runtimeTurn } from "./runtime-turn.ts";

/**
 * Run the shared runtime continuously until the surrounding host halts it.
 *
 * Component/doer model:
 * - `Reactor.msgDo()` owns continuous ingress draining
 * - `Reactor.escrowDo()` owns continuous escrow reprocessing
 * - `Oobiery.oobiDo()` owns durable OOBI resolution
 *
 * The root itself now acts as a composition host: it starts the component
 * doers and stays alive until the surrounding Effection scope halts.
 */
export function* runAgentRuntime(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<never> {
  const tasks = [
    yield* spawn(function* () {
      yield* runtime.reactor.msgDo();
    }),
    yield* spawn(function* () {
      yield* cueDo(runtime, options);
    }),
    yield* spawn(function* () {
      yield* runtime.reactor.escrowDo();
    }),
    yield* spawn(function* () {
      yield* runtime.oobiery.oobiDo();
    }),
  ];
  try {
    while (true) {
      yield* runtimeTurn();
    }
  } finally {
    for (const task of tasks.reverse()) {
      yield* task.halt();
    }
  }
}
