/**
 * Library entry points for key-state and anchor queries.
 *
 * A query is a finite workflow (`KeyStateNoticer` or `AnchorQuerier`) that runs
 * beside the host's runtime workers, which send the request and ingest the reply.
 * These functions never start those workers: a wallet already runs them, and the
 * CLI runs them around the call (`cli/common/runtime-workers.ts`). The host must
 * have configured the sender with the signing hab (`runAgentRuntime` does) and,
 * for key state, wired its cue owner to the `cues` Deck it passes here.
 *
 * Begin/status/wait split. `begin*` spawns the workflow in the caller's scope and
 * returns a {@link QueryRun}; `wait` observes it against a deadline; `queryKeyState`
 * and `queryAnchor` are begin + wait + halt. Tasks belong to the scope that began
 * them, so a UI that begins a query keeps that scope open and halts the run.
 */
import type { SealEvent } from "cesr-ts";
import { call, type Operation, race, sleep, spawn, type Task } from "effection";
import type { AgentCue } from "../../core/cues.ts";
import type { Deck } from "../../core/deck.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { ChangeSink, WaitResult } from "../runtime/workflow-contract.ts";
import { AnchorQuerier, KeyStateNoticer } from "./querying.ts";
import type { WitnessInquisitor } from "./witness-inquisitor.ts";

/** One elapsed deadline covers query sending and independently received evidence. */
export const QUERY_TIMEOUT_MS = 10_000;

/** Exact event seal sought by an anchor query. */
export type QueryAnchor = ReturnType<typeof SealEvent.toSad>;

/** Collaborators every query needs: accepted-state stores and the query sender. */
export interface QueryDeps {
  readonly hby: Habery;
  readonly querying: WitnessInquisitor;
  /** Optional sink told `{kind:"query", id:"<prefix>"}` when a query starts and when it completes. */
  readonly changes?: ChangeSink;
}

/** Key-state queries also need the Deck the host's cue owner fills with saved notices. */
export interface KeyStateQueryDeps extends QueryDeps {
  readonly cues: Deck<AgentCue>;
}

/**
 * Status of a query. `scope` says where the fact lives: `"process"` means it is
 * held only by the running {@link QueryRun} and is lost on restart or reload
 * (key-state completion rides a transient `keyStateSaved` cue that leaves no
 * durable record); `"durable"` means it was recomputed from stores
 * ({@link anchorQueryStatus}).
 */
export type QueryStatus =
  | { state: "active"; phase: "awaitingEvidence"; scope: "process" | "durable" }
  | { state: "completed"; scope: "process" | "durable" };

/** Result of waiting on a query: settled once accepted evidence satisfied it, or the deadline won. */
export type QueryOutcome = WaitResult<QueryStatus>;

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
  /** Process-local status (`scope: "process"`): completed once the workflow task has returned. */
  status(): QueryStatus;
  /** Observe completion against a fresh deadline; a timeout leaves the run going. */
  wait(options?: QueryWaitOptions): Operation<QueryOutcome>;
  /** Halt the workflow. Safe after completion. */
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

/** Durable anchor status (`scope: "durable"`): the accepted KEL of `prefix` already holds the exact seal. */
export function anchorQueryStatus(
  deps: Pick<QueryDeps, "hby">,
  prefix: string,
  anchor: QueryAnchor,
): QueryStatus {
  return deps.hby.db.fetchLastSealingEventByEventSeal(prefix, anchor)
    ? { state: "completed", scope: "durable" }
    : { state: "active", phase: "awaitingEvidence", scope: "durable" };
}

/** Start a key-state query in the caller's scope. */
export function* beginKeyStateQuery(deps: KeyStateQueryDeps, target: QueryTarget): Operation<QueryRun> {
  requireQueryRequester(deps.hby, target.hab);
  const workflow = new KeyStateNoticer(deps.hby.db, deps.querying, target.prefix, deps.cues, {
    signer: target.hab.pre,
  });
  return yield* startQuery(deps, target.prefix, workflow);
}

/** Start an anchor query in the caller's scope. */
export function* beginAnchorQuery(
  deps: QueryDeps,
  target: QueryTarget & { anchor: QueryAnchor },
): Operation<QueryRun> {
  requireQueryRequester(deps.hby, target.hab);
  const workflow = new AnchorQuerier(deps.hby.db, deps.querying, target.prefix, target.anchor, {
    signer: target.hab.pre,
  });
  return yield* startQuery(deps, target.prefix, workflow);
}

/**
 * Query current key state for `prefix` and wait for accepted evidence.
 *
 * @returns `settled` (status `completed`), or `timed-out`; a timeout is not permission to treat
 * stale local state as success. Workflow failures propagate.
 */
export function* queryKeyState(
  deps: KeyStateQueryDeps,
  target: QueryTarget,
  options: QueryWaitOptions = {},
): Operation<QueryOutcome> {
  return yield* beginThenWait(beginKeyStateQuery(deps, target), options);
}

/** Query for an accepted KEL event holding the exact seal `target.anchor`; see {@link queryKeyState}. */
export function* queryAnchor(
  deps: QueryDeps,
  target: QueryTarget & { anchor: QueryAnchor },
  options: QueryWaitOptions = {},
): Operation<QueryOutcome> {
  return yield* beginThenWait(beginAnchorQuery(deps, target), options);
}

/** Spawn the workflow in the caller's scope. */
function* startQuery(
  deps: QueryDeps,
  prefix: string,
  workflow: { queryDo(): Operation<void> },
): Operation<QueryRun> {
  let completed = false;
  const status = (): QueryStatus =>
    completed
      ? { state: "completed", scope: "process" }
      : { state: "active", phase: "awaitingEvidence", scope: "process" };
  const observing: Task<void> = yield* spawn(function*() {
    yield* workflow.queryDo();
    completed = true;
  });
  deps.changes?.push({ kind: "query", id: prefix });
  return {
    prefix,
    status,
    *wait(options = {}) {
      const outcome = yield* waitForQuery(observing, status, options.timeoutMs ?? QUERY_TIMEOUT_MS);
      if (outcome.outcome === "settled") deps.changes?.push({ kind: "query", id: prefix });
      return outcome;
    },
    halt: () => observing.halt(),
  };
}

/**
 * Observe completion within the window without transferring task ownership.
 * The race cancels only its observation when the timer wins; the run's `halt`
 * joins the original task.
 */
function* waitForQuery(observing: Task<void>, status: () => QueryStatus, timeoutMs: number): Operation<QueryOutcome> {
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
  return done ? { outcome: "settled", status: status() } : { outcome: "timed-out", status: status(), timeoutMs };
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
