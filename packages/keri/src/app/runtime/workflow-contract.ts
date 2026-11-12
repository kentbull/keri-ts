/**
 * Shared pieces of the library workflow contract.
 *
 * Library workflows follow one shape: `begin*` is an explicit operation that
 * returns after local commit, `*Status` is a pure synchronous read, and
 * `waitFor*` only observes. A wait never starts runtime workers: a host that
 * already runs a runtime must not get a second poller and escrow loop. One-shot
 * hosts such as the CLI run the runtime around the wait themselves
 * (`cli/common/runtime-workers.ts`). Remote and time-driven outcomes, including
 * an expired wait, are returned values; only caller-contract, invariant and
 * infrastructure failures throw.
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { Signaler } from "../notifications/signaling.ts";
import { type RuntimeClock, systemClock } from "./runtime-clock.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** Workflow families that publish changes. */
export type WorkflowKind = "oobi" | "query" | "event" | "delegation";

/** Identity of a workflow whose status may have changed; consumers re-read status. */
export interface WorkflowChange {
  kind: WorkflowKind;
  id: string;
}

/**
 * Receiver of change identities. Owners publish after their commit and never
 * depend on what the sink does with it; a sink must not throw into a workflow.
 */
export interface ChangeSink {
  push(change: WorkflowChange): void;
}

/** In-memory sink that records changes in order. */
export class MemoryChangeSink implements ChangeSink {
  readonly changes: WorkflowChange[] = [];
  push(change: WorkflowChange): void {
    this.changes.push({ kind: change.kind, id: change.id });
  }
}

/**
 * Back a sink with the host's transient `Signaler`. Publishing needs no polling:
 * `push` is a synchronous append that collapses repeats of one workflow into a
 * single signal (collapse key `kind:id`). Delivery is pull-based, though: the
 * Signaler has no subscriber hook, so the consumer must read `signaler.list()`,
 * and a closed Signaler throws on push.
 */
export function signalerChangeSink(signaler: Pick<Signaler, "push">): ChangeSink {
  return {
    push: ({ kind, id }) => {
      signaler.push({ id }, `/workflow/${kind}`, { ckey: `${kind}:${id}` });
    },
  };
}

/**
 * Observe-only wait: poll `done`, yielding to the scheduler between checks,
 * until it holds or the deadline passes. Starts no worker and has no effects of
 * its own.
 *
 * @param done Synchronous status read; checked before the first yield.
 * @returns True when `done` held, false when `timeoutMs` elapsed first.
 */
export function* observeUntil(
  done: () => boolean,
  { timeoutMs, clock = systemClock }: { timeoutMs: number; clock?: Pick<RuntimeClock, "now"> },
): Operation<boolean> {
  const deadline = clock.now() + timeoutMs;
  while (!done()) {
    if (clock.now() >= deadline) return false;
    yield* runtimeTurn();
  }
  return true;
}
