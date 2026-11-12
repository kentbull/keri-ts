/**
 * Single-signature event completion: the steps that follow authoring a local
 * event, owned by the library so that every host (CLI, wallet, service) runs
 * one implementation.
 *
 * Completion is two independent steps. `receiptEvent` obtains witness receipts
 * for the accepted event. For delegated events, `beginDelegation` places the
 * event in the durable delegating workflow and `waitForDelegation` drives the
 * host's runtime until the delegator's anchor is learned. Begin is separate from
 * wait so that a host without a blocking caller can begin, return to its user
 * interface and read `delegationStatus` later. `completeEvent` is the
 * convenience that runs both steps in order.
 *
 * Boundaries:
 * - Dependencies are narrow collaborators, not an AgentRuntime (ADR-0013). The
 *   host owns the runtime and its lifetime; `withDelegation` lends it for one
 *   scope.
 * - Witness authorization codes arrive resolved. Prompting is a host concern.
 * - Delegation state is the Anchorer's durable escrow membership; this module
 *   adds none.
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
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
}

/**
 * Delegation collaborator: the durable workflow owner plus a way to run the
 * host's workers until a condition holds. A host with a long-lived runtime
 * adapts it once; the CLI builds one per command.
 */
export interface DelegationCollaborator {
  /** Durable delegating workflow (begin, status, completion reads). */
  readonly anchorer: Pick<Anchorer, "beginLatest" | "workflowStatus" | "complete">;
  /**
   * Run host workers until `done()` holds or `timeoutMs` elapses, then stop them.
   * Timeout and worker failure propagate to the caller.
   */
  runUntil(
    done: () => boolean,
    options: { hab: Hab; timeoutMs: number; pollMailbox: boolean },
  ): Operation<void>;
}

/** Everything `completeEvent` needs. */
export interface EventCompletionDeps extends ReceiptingDeps {
  /**
   * Lend the delegation collaborator for one scope. The host creates it on entry
   * and releases it on exit, success or failure. Called only for delegated events.
   */
  withDelegation<T>(use: (delegation: DelegationCollaborator) => Operation<T>): Operation<T>;
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
  if (!deps.hby.habs.get(pre)?.kever?.wits.length) return;

  if (endpoint) {
    yield* new Receiptor(deps.hby, deps.protocol, deps.http, deps.clock).receipt(pre, { sn, auths });
  } else {
    yield* new WitnessReceiptor(deps.hby, deps.protocol, deps.http, deps.clock, { force })
      .submit(pre, { sn, auths });
  }
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
}

/** Read the durable workflow state for one delegated event; mutates nothing. */
export function delegationStatus(
  delegation: DelegationCollaborator,
  pre: string,
  sn: number,
): DelegationWorkflowStatus {
  return delegation.anchorer.workflowStatus(pre, snKey(sn));
}

/**
 * Run the host's workers until the delegated event is complete, then report the
 * workflow state.
 *
 * @throws When `timeoutMs` elapses first, or a worker fails.
 */
export function* waitForDelegation(
  delegation: DelegationCollaborator,
  hab: Hab,
  sn: number,
  { timeoutMs = DELEGATION_WAIT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Operation<DelegationWorkflowStatus> {
  yield* delegation.runUntil(
    () => delegation.anchorer.complete(hab.pre, sn),
    { hab, timeoutMs, pollMailbox: true },
  );
  return delegationStatus(delegation, hab.pre, sn);
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

/** What completion observed. */
export interface EventCompletion {
  /** Delegating workflow phase after waiting; null when not delegated or finished. */
  delegationPhase: DelegationWorkflowStatus["phase"] | null;
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
  if (!delegation) return { delegationPhase: null };

  const communicationHab = delegation.communicationHab?.();
  return yield* deps.withDelegation(function*(collaborator) {
    beginDelegation(collaborator, hab.pre, sn, communicationHab);
    const status = yield* waitForDelegation(collaborator, hab, sn, { timeoutMs: delegation.timeoutMs });
    return { delegationPhase: status.phase };
  });
}
