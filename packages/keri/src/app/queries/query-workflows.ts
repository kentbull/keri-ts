/**
 * Library entry points for key-state and anchor queries.
 *
 * A query is a finite workflow (`KeyStateNoticer` or `AnchorQuerier`) that must
 * run alongside the runtime workers, which send the request and ingest the
 * reply. These functions own that composition: choose the workflow, spawn it
 * and the workers in the caller's scope, race an elapsed deadline against
 * completion, and halt both before returning so stores may close.
 *
 * Begin/status/wait split. `begin*` starts the workflow and workers and returns
 * a {@link QueryRun}; `wait` observes it against a deadline; `queryKeyState` and
 * `queryAnchor` are begin + wait + halt. Status is process-local for both
 * queries: the key-state wait completes on a transient `keyStateSaved` cue that
 * leaves no durable record, so it cannot be recomputed from stores. Anchor
 * queries additionally have a durable predicate, {@link anchorQueryStatus}.
 * Tasks live in the caller's Effection scope, so a UI that begins a query must
 * keep that scope open (and halt the run) rather than abandon it.
 */
import type { SealEvent } from "cesr-ts";
import { call, type Operation, race, sleep, spawn, type Task } from "effection";
import type { AgentCue } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import { type AgentRuntime, runAgentRuntime } from "../runtime/agent-runtime.ts";
import { AnchorQuerier, KeyStateNoticer } from "./querying.ts";

/** One elapsed deadline covers query sending and independently received evidence. */
export const QUERY_TIMEOUT_MS = 10_000;

/** Exact event seal sought by an anchor query. */
export type QueryAnchor = ReturnType<typeof SealEvent.toSad>;

/** Result of waiting on a query: accepted evidence satisfied it, or the deadline won. */
export type QueryOutcome =
  | { status: "completed" }
  | { status: "timed-out"; timeoutMs: number };

/** Wait budget for a blocking query. */
export interface QueryWaitOptions {
  /** Wall-clock budget; defaults to {@link QUERY_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Inputs shared by key-state and anchor queries. */
export interface QueryTarget {
  /** Local member or single-controller requester that signs the query. */
  hab: Hab;
  /** Subject AID being queried; distinct from the requester. */
  prefix: string;
}

/** Handle on a started query; its tasks belong to the scope that began it. */
export interface QueryRun {
  readonly prefix: string;
  /** Process-local: `completed` once the workflow task has returned. */
  status(): "pending" | "completed";
  /** Observe completion against a fresh deadline; a timeout leaves the run going. */
  wait(options?: QueryWaitOptions): Operation<QueryOutcome>;
  /** Halt the workflow, then the workers, joining both. Safe after completion. */
  halt(): Operation<void>;
}

/** Reject group habs: a query must be signed by one member, not by a group needing more signatures. */
export function requireQueryRequester(hby: Habery, hab: Hab): void {
  if (isLocalGroupHab(hby, hab)) {
    throw new ValidationError(
      "Query --alias must select a member requester, not a group requiring additional signatures.",
    );
  }
}

/** Durable anchor predicate: the accepted KEL of `prefix` already holds the exact seal. */
export function anchorQueryStatus(
  hby: Habery,
  prefix: string,
  anchor: QueryAnchor,
): "pending" | "completed" {
  return hby.db.fetchLastSealingEventByEventSeal(prefix, anchor) ? "completed" : "pending";
}

/** Start a key-state query and its runtime workers in the caller's scope. */
export function* beginKeyStateQuery(runtime: AgentRuntime, target: QueryTarget): Operation<QueryRun> {
  const { hby } = runtime;
  requireQueryRequester(hby, target.hab);
  const queryCues = new Deck<AgentCue>();
  const workflow = new KeyStateNoticer(hby.db, runtime.querying, target.prefix, queryCues, {
    signer: target.hab.pre,
  });
  return yield* startQuery(runtime, target, workflow, queryCues);
}

/** Start an anchor query and its runtime workers in the caller's scope. */
export function* beginAnchorQuery(
  runtime: AgentRuntime,
  target: QueryTarget & { anchor: QueryAnchor },
): Operation<QueryRun> {
  const { hby } = runtime;
  requireQueryRequester(hby, target.hab);
  const workflow = new AnchorQuerier(hby.db, runtime.querying, target.prefix, target.anchor, {
    signer: target.hab.pre,
  });
  return yield* startQuery(runtime, target, workflow);
}

/**
 * Query current key state for `prefix` and wait for accepted evidence.
 *
 * @returns `completed`, or `timed-out`; a timeout is not permission to treat
 * stale local state as success. Workflow and worker failures propagate.
 */
export function* queryKeyState(
  runtime: AgentRuntime,
  target: QueryTarget,
  options: QueryWaitOptions = {},
): Operation<QueryOutcome> {
  return yield* beginThenWait(beginKeyStateQuery(runtime, target), options);
}

/** Query for an accepted KEL event holding the exact seal `target.anchor`; see {@link queryKeyState}. */
export function* queryAnchor(
  runtime: AgentRuntime,
  target: QueryTarget & { anchor: QueryAnchor },
  options: QueryWaitOptions = {},
): Operation<QueryOutcome> {
  return yield* beginThenWait(beginAnchorQuery(runtime, target), options);
}

/** Spawn the workflow first, then the workers wired to the command-owned cue Deck. */
function* startQuery(
  runtime: AgentRuntime,
  target: QueryTarget,
  workflow: { queryDo(): Operation<void> },
  queryCues?: Deck<AgentCue>,
): Operation<QueryRun> {
  let completed = false;
  const observing: Task<void> = yield* spawn(function*() {
    yield* workflow.queryDo();
    completed = true;
  });
  const worker: Task<void> = yield* spawn(() => runAgentRuntime(runtime, { hab: target.hab, queryCues }));
  return {
    prefix: target.prefix,
    status: () => completed ? "completed" : "pending",
    wait: (options = {}) => waitForQuery(observing, options.timeoutMs ?? QUERY_TIMEOUT_MS),
    *halt() {
      try {
        yield* observing.halt();
      } finally {
        yield* worker.halt();
      }
    },
  };
}

/**
 * Observe completion within the window without transferring task ownership.
 * The race cancels only its observation when the timer wins; the run's `halt`
 * joins the original tasks.
 */
function* waitForQuery(observing: Task<void>, timeoutMs: number): Operation<QueryOutcome> {
  const done = yield* race([
    call(function*() {
      yield* observing;
      return true;
    }),
    call(function*() {
      yield* sleep(timeoutMs);
      return false;
    }),
  ]);
  return done ? { status: "completed" } : { status: "timed-out", timeoutMs };
}

/** begin + wait, halting the run on every exit path. */
function* beginThenWait(begin: Operation<QueryRun>, options: QueryWaitOptions): Operation<QueryOutcome> {
  const run = yield* begin;
  try {
    return yield* run.wait(options);
  } finally {
    yield* run.halt();
  }
}
