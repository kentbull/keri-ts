/**
 * Library status and wait for v1 TEL publication, owned here so that every host
 * (CLI, wallet, service) observes one definition of "the TEL event is done".
 *
 * A TEL event is complete when the issuer's KEL holds the anchoring event, that
 * event has its witness receipts, and the local publication owner finished
 * disseminating it (`TelPublication`'s `ctel.`). Issuing a credential also needs
 * the saved credential evidence: publication alone is not verifier acceptance.
 *
 * `telEventStatus` is a pure read of durable state. `waitForTelEvent` only
 * observes: it starts no runtime workers, so the host must already run the
 * publication owner (a wallet's runtime, or the CLI's `withRuntimeWorkers`), and
 * an expired deadline is a returned `timed-out` value. See
 * `app/runtime/workflow-contract.ts`.
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { TelPublication } from "../../vdr/tel-publication.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import { observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";

/** Elapsed milliseconds between reads of a TEL wait. */
export const TEL_WAIT_POLL_MS = 50;

/** Collaborator for status and waits: the publication owner's durable facts. */
export interface TelCompletionDeps {
  readonly publication: Pick<TelPublication, "progress" | "reger">;
}

/** Steps a tracked TEL event can be waiting on. */
export type TelPhase =
  | "awaitingAnchor"
  | "awaitingReceipts"
  | "awaitingPublication"
  | "awaitingCredentialSave";

/** Durable status of one TEL event; `unknown` means publication does not track it. */
export type TelEventStatus =
  | { state: "active"; phase: TelPhase }
  | { state: "complete" }
  | { state: "unknown"; reason: "not-tracked" };

/** Outcome of a wait; `timed-out` carries the status read at the deadline. */
export type TelWaitResult = WaitResult<TelEventStatus, { deadline: number }>;

/** Wait choices; the deadline is an epoch-millisecond instant so callers can start it before authoring. */
export interface TelWaitOptions {
  deadline: number;
  clock?: Pick<RuntimeClock, "now">;
}

/** Read the status of the TEL event `pre` at `sn`; mutates nothing. */
export function telEventStatus(deps: TelCompletionDeps, pre: string, sn = 0): TelEventStatus {
  const progress = deps.publication.progress(pre, sn);
  if (progress === null) return { state: "unknown", reason: "not-tracked" };
  return progress === "complete" ? { state: "complete" } : { state: "active", phase: progress };
}

/** Status of an issued credential: its TEL issuance event plus saved credential evidence. */
export function issuedCredentialStatus(deps: TelCompletionDeps, said: string): TelEventStatus {
  const status = telEventStatus(deps, said, 0);
  if (status.state === "complete" && deps.publication.reger.saved.get(said) === null) {
    return { state: "active", phase: "awaitingCredentialSave" };
  }
  return status;
}

function* observe(
  read: () => TelEventStatus,
  { deadline, clock = systemClock }: TelWaitOptions,
): Operation<TelWaitResult> {
  const done = yield* observeUntil(() => read().state === "complete", {
    timeoutMs: Math.max(0, deadline - clock.now()),
    clock,
    pollMs: TEL_WAIT_POLL_MS,
  });
  const status = read();
  return done ? { outcome: "settled", status } : { outcome: "timed-out", status, deadline };
}

/** Observe one exact TEL coordinate until complete or the deadline passes. Starts no worker. */
export function* waitForTelEvent(
  deps: TelCompletionDeps,
  pre: string,
  sn: number,
  options: TelWaitOptions,
): Operation<TelWaitResult> {
  return yield* observe(() => telEventStatus(deps, pre, sn), options);
}

/** Observe an issuance until its TEL event is complete and the credential is saved. Starts no worker. */
export function* waitForIssuedCredential(
  deps: TelCompletionDeps,
  said: string,
  options: TelWaitOptions,
): Operation<TelWaitResult> {
  return yield* observe(() => issuedCredentialStatus(deps, said), options);
}
