/**
 * Single-signature event completion: the steps that follow authoring a local
 * event, owned by the library so that every host (CLI, wallet, service) runs
 * one implementation.
 *
 * Completion is two independent steps. `receiptEvent` obtains witness receipts
 * for the accepted event. For delegated events, `beginDelegation` places the
 * event in the durable delegating workflow and `waitForDelegation` drives the
 * host's runtime has learned the delegator's anchor. Begin is separate from
 * wait so that a host without a blocking caller can begin, return to its user
 * interface and read `delegationStatus` later. `completeEvent` is the
 * convenience that runs both steps in order. A completed rotation (`rot` or `drt`) is then published: the
 * KEL goes to every mailbox the identifier has an authorized role with, because a mailbox authenticates the
 * identifier's polls against the key state it holds. An interaction event changes no keys, so it needs no
 * publication.
 *
 * Boundaries:
 * - Dependencies are narrow collaborators, not an AgentRuntime (ADR-0013). The
 *   host owns the runtime and its lifetime; `withDelegation` lends the
 *   collaborator for one scope and, for a one-shot host, runs workers in it.
 * - Waits only observe. They never start runtime workers, and an expired wait is
 *   a returned `timed-out` value, not an exception.
 * - Witness authorization codes arrive resolved. Prompting is a host concern.
 * - Delegation state is the Anchorer's durable escrow membership; this module
 *   adds none.
 */
import { Ilks } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
import { type MailboxPublication, tellMailboxes } from "../mailbox/kel-publishing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { Receiptor, type WitnessAuthMap, WitnessReceiptor } from "../witness/receipting.ts";
import type { Anchorer, DelegationWorkflowStatus } from "./delegating.ts";
import type { Hab, Habery } from "./habbing.ts";

/** How long the CLI-compatible wait for a delegator's anchor lasts. */
export const DELEGATION_WAIT_TIMEOUT_MS = 120_000;

/** Collaborators witness receipting needs; nothing else is reachable from here. */
export interface ReceiptingDeps {
  /** Borrowed identities and accepted-state stores. */
  readonly hby: Habery;
  /** Receive processing over the same database as `hby`. */
  readonly protocol: ProtocolProcessor;
  /** Borrowed HTTP implementation. */
  readonly http: HttpClient;
  /** Borrowed clock for network deadlines. */
  readonly clock: RuntimeClock;
  /** Optional sink told `{kind:"event", id:"<pre>:<sn>"}` after receipting. */
  readonly changes?: ChangeSink;
}

/**
 * Delegation collaborator: the durable workflow owner. Waiting observes its
 * reads; progress comes from workers the host already runs.
 */
export interface DelegationCollaborator {
  /** Durable delegating workflow (begin, status, completion reads). */
  readonly anchorer: Pick<Anchorer, "beginLatest" | "workflowStatus" | "complete">;
  /** Optional sink told `{kind:"delegation", id:"<pre>:<sn>"}` on begin and completion. */
  readonly changes?: ChangeSink;
}

/** Everything `completeEvent` needs. */
export interface EventCompletionDeps extends ReceiptingDeps {
  /**
   * Lend the delegation collaborator for one scope. The host creates it on entry
   * and releases it on exit, success or failure. A one-shot host also runs the
   * workers (signing as `hab`) for that scope. Called only for delegated events.
   */
  withDelegation<T>(hab: Hab, use: (delegation: DelegationCollaborator) => Operation<T>): Operation<T>;
}

/** Witness receipting choices for one event. */
export interface ReceiptOptions {
  /** Event sequence number; defaults to the latest accepted event. */
  sn?: number;
  /** Resolved witness Authorization values. */
  auths?: WitnessAuthMap;
  /** Use the explicit receipt endpoint (HTTP only) instead of generic submission. */
  endpoint?: boolean;
  /** Generic submission only: resubmit even when receipts are already complete. */
  force?: boolean;
}

/**
 * Obtain witness receipts for an accepted local event. No-op when the
 * identifier has no accepted key state yet (a delegated inception awaiting
 * approval) or its current key state has no witnesses.
 *
 * @throws Receipt failures from the witness receiptor propagate.
 */
export function* receiptEvent(
  deps: ReceiptingDeps,
  pre: string,
  { sn, auths, endpoint = false, force = false }: ReceiptOptions = {},
): Operation<void> {
  const kever = deps.hby.habs.get(pre)?.kever;
  if (!kever?.wits.length) return;

  if (endpoint) {
    yield* new Receiptor(deps.hby, deps.protocol, deps.http, deps.clock).receipt(pre, { sn, auths });
  } else {
    yield* new WitnessReceiptor(deps.hby, deps.protocol, deps.http, deps.clock, { force })
      .submit(pre, { sn, auths });
  }
  deps.changes?.push({ kind: "event", id: `${pre}:${sn ?? kever.sn}` });
}

/** Hex sequence key the delegating workflow uses. */
function snKey(sn: number): string {
  return sn.toString(16);
}

/**
 * Put one delegated event into the durable delegating workflow. Returns at once;
 * progress needs the host's runtime workers, and `delegationStatus` reports it.
 *
 * @param communicationHab Optional local proxy that signs delegation traffic.
 */
export function beginDelegation(
  delegation: DelegationCollaborator,
  pre: string,
  sn: number,
  communicationHab?: Hab,
): void {
  delegation.anchorer.beginLatest(pre, sn, { communicationHab });
  delegation.changes?.push({ kind: "delegation", id: `${pre}:${sn}` });
}

/** Read the durable workflow state for one delegated event; mutates nothing. */
export function delegationStatus(
  delegation: DelegationCollaborator,
  pre: string,
  sn: number,
): DelegationWorkflowStatus {
  return delegation.anchorer.workflowStatus(pre, snKey(sn));
}

/** Outcome of waiting for a delegator's anchor. */
export type DelegationWaitResult = WaitResult<DelegationWorkflowStatus>;

/**
 * Observe the delegated event until the delegator's anchor is learned or the
 * deadline passes. Starts no worker.
 */
export function* waitForDelegation(
  delegation: DelegationCollaborator,
  hab: Hab,
  sn: number,
  { timeoutMs = DELEGATION_WAIT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Operation<DelegationWaitResult> {
  const done = yield* observeUntil(() => delegation.anchorer.complete(hab.pre, sn), { timeoutMs });
  const status = delegationStatus(delegation, hab.pre, sn);
  if (!done) return { outcome: "timed-out", status, timeoutMs };
  delegation.changes?.push({ kind: "delegation", id: `${hab.pre}:${sn}` });
  return { outcome: "settled", status };
}

/** Delegation choices for `completeEvent`; present only for delegated events. */
export interface DelegationOptions {
  /**
   * Resolve the proxy after receipting and before the delegation scope opens.
   * May throw to reject a missing or invalid proxy.
   */
  communicationHab?: () => Hab | undefined;
  /** Wait limit; defaults to `DELEGATION_WAIT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Options for `completeEvent`. */
export interface CompleteEventOptions extends ReceiptOptions {
  /** Set for delegated events to begin delegation and wait for the anchor. */
  delegation?: DelegationOptions;
}

/**
 * What completion observed. `status` is the {@link EventStatus} read at return;
 * a delegation wait that expires is `timed-out`, not an exception.
 * `delegationPhase` is the delegating workflow phase after waiting, null when not
 * delegated or finished.
 */
export type EventCompletion =
  & WaitResult<EventStatus>
  & {
    readonly delegationPhase: DelegationWorkflowStatus["phase"] | null;
    /**
     * Mailboxes a completed rotation was published to, told or failed with the reason. Empty for any other
     * event, an incomplete rotation or an identifier with no mailbox. A failure never fails the rotation: the
     * poller posts the KEL again when a mailbox refuses it.
     */
    readonly mailboxes: readonly MailboxPublication[];
  };

/** Publish a completed rotation to the identifier's mailboxes; any other event publishes nothing. */
function* publishRotation(deps: EventCompletionDeps, pre: string, sn: number, status: EventStatus) {
  if (status.state !== "complete") return [];
  const said = deps.hby.db.kels.getLast(pre, sn);
  const ilk = said ? deps.hby.db.getEvtSerder(pre, said)?.ilk : null;
  return ilk === Ilks.rot || ilk === Ilks.drt ? yield* tellMailboxes(deps, pre) : [];
}

/**
 * Complete a freshly authored event: witness receipts, then, for delegated
 * events, delegation begin and wait.
 *
 * @param sn Sequence number of the event just authored.
 */
export function* completeEvent(
  deps: EventCompletionDeps,
  hab: Hab,
  sn: number,
  { delegation, ...receipt }: CompleteEventOptions = {},
): Operation<EventCompletion> {
  yield* receiptEvent(deps, hab.pre, { ...receipt, sn });
  if (!delegation) {
    const status = eventStatus(deps.hby, hab.pre, sn);
    return {
      outcome: "settled",
      status,
      delegationPhase: null,
      mailboxes: yield* publishRotation(deps, hab.pre, sn, status),
    };
  }

  const communicationHab = delegation.communicationHab?.();
  return yield* deps.withDelegation(hab, function*(collaborator) {
    beginDelegation(collaborator, hab.pre, sn, communicationHab);
    const result = yield* waitForDelegation(collaborator, hab, sn, { timeoutMs: delegation.timeoutMs });
    const status = eventStatus({ db: deps.hby.db, anchorer: collaborator.anchorer }, hab.pre, sn);
    if (result.outcome === "timed-out") {
      return {
        outcome: "timed-out",
        status,
        timeoutMs: result.timeoutMs,
        delegationPhase: result.status.phase,
        mailboxes: [],
      };
    }
    const mailboxes = yield* publishRotation(deps, hab.pre, sn, status);
    return { outcome: "settled", status, delegationPhase: result.status.phase, mailboxes };
  });
}

/** Collaborators for the pure event status read. */
export interface EventStatusDeps {
  /** Accepted KELs, witness receipts and witness sets. A `Habery` fits. */
  readonly db: Baser;
  /** Delegating workflow owner; omit for hosts that never delegate. */
  readonly anchorer?: Pick<Anchorer, "workflowStatus" | "complete">;
}

/** Steps an accepted single-signature event can be waiting on. */
export type EventPhase = DelegationWorkflowStatus["phase"] & string;

/** Status of one local event after authoring; see {@link eventStatus}. */
export type EventStatus =
  | {
    state: "active";
    phase: EventPhase;
    /** Missing input: witness receipts held versus the size of that event's witness set. */
    blocked?: { missing: "witnessReceipts"; have: number; of: number };
  }
  | { state: "complete" }
  | { state: "unknown"; reason: "no-accepted-event" };

/**
 * Pure synchronous status of the event `pre` at `sn`, derived from durable state.
 *
 * Receipts are judged against the witness set of THAT event (not the current
 * key state) via stored `wigs`. A delegating-workflow escrow phase takes
 * precedence; a delegated event with no escrow and no anchor yet reads as
 * waiting for the delegator's anchor. Group events are not covered.
 */
export function eventStatus(deps: EventStatusDeps, pre: string, sn: number): EventStatus {
  const workflow = deps.anchorer?.workflowStatus(pre, snKey(sn));
  if (workflow?.phase) return { state: "active", phase: workflow.phase };

  const said = deps.db.kels.getLast(pre, sn);
  const serder = said ? deps.db.getEvtSerder(pre, said) : null;
  if (!said || !serder) return { state: "unknown", reason: "no-accepted-event" };

  if (!deps.db.fullyWitnessed(serder)) {
    return {
      state: "active",
      phase: "waitingWitnessReceipts",
      blocked: {
        missing: "witnessReceipts",
        have: deps.db.wigs.get(dgKey(pre, said)).length,
        of: deps.db.acceptedEventWitnesses(serder)?.length ?? 0,
      },
    };
  }
  if (deps.anchorer && deps.db.getKever(pre)?.delegated && !deps.anchorer.complete(pre, sn)) {
    return { state: "active", phase: "waitingDelegatorAnchor" };
  }
  return { state: "complete" };
}
