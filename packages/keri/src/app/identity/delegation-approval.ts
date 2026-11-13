/**
 * Delegator-side approval of pending delegated events, owned by the library so
 * that every host (CLI, wallet, service) runs one implementation.
 *
 * A delegate's `dip` or `drt` reaches the delegator's `delegables.` escrow. The
 * delegator approves it by anchoring the event seal in its own KEL, then lets
 * the delegate's event reach local state. Operations follow the workflow
 * contract (`app/runtime/workflow-contract.ts`):
 * - `listPendingDelegations` and `delegationApprovalStatus` are pure reads of
 *   durable state.
 * - `approveDelegation` is the only operation that signs. It returns after the
 *   anchor is committed locally and the follow-up requests are sent.
 * - `waitForPendingDelegation`, `waitForDelegationAnchor` and `waitForDelegationApproval`
 *   only observe, each on the one thing asked for; the host's runtime workers make the
 *   request and the delegate's event arrive.
 * - `dismissDelegation` removes the local controller notice only.
 *
 * Idempotence evidence: the anchor is the seal `{i, s, d}` of the delegated event
 * inside the delegator's own KEL. That KEL entry is durable the moment signing
 * commits, so a repeated approval after a crash finds it and never anchors twice.
 * Witness receipts are not part of the test on purpose: the sealing-event lookup
 * of `Baser` requires them, which would re-anchor in the window between signing
 * and receipting.
 *
 * - A group delegator's anchor is a group interaction: `proposeGroupDelegationApproval`
 *   proposes it, the other members approve it with `approveGroupProposal`, and the
 *   Counselor receipts it. `requestDelegatedEvent` then asks for the delegate's event.
 *
 * Boundaries:
 * - Dependencies are declared collaborators, not an AgentRuntime (ADR-0013).
 * - `approveDelegation` serves single-signature delegators and rejects a group.
 * - Witness authorization codes arrive resolved. Prompting is a host concern.
 */
import { Diger, type SerderKERI } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { QueryRequest } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
import type { CounselInputs } from "../multisig/counseling.ts";
import { type GroupEventResult, type GroupProposeDeps, proposeGroupInteraction } from "../multisig/proposing.ts";
import type { Notifier } from "../notifications/notifying.ts";
import type { WitnessInquisitor } from "../queries/witness-inquisitor.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { WitnessAuthMap } from "../witness/receipting.ts";
import { DELEGATE_REQUEST_ROUTE } from "./delegating.ts";
import { isLocalGroupHab } from "./endpoint-roleing.ts";
import { receiptEvent, type ReceiptingDeps } from "./event-completion.ts";
import type { Hab, Habery } from "./habbing.ts";

/** How long the CLI-compatible wait for the delegate's event lasts. */
export const DELEGATION_APPROVAL_TIMEOUT_MS = 30_000;

/** Identity of one delegated event a delegator is asked to approve. */
export interface DelegationRequest {
  /** Delegate prefix. */
  readonly delegate: string;
  /** Sequence number of the delegated event. */
  readonly sn: number;
  /** SAID of the delegated event. */
  readonly said: string;
  /** Delegated inception or rotation. */
  readonly ilk: "dip" | "drt";
  /** Local delegator prefix that must anchor it. */
  readonly delegator: string;
}

/** One entry of {@link listPendingDelegations}. */
export interface PendingDelegation extends DelegationRequest {
  /** True when the delegator's KEL already holds the anchor, for example after a crash. */
  readonly anchored: boolean;
}

/** Filter for {@link listPendingDelegations}. */
export interface PendingDelegationFilter {
  /** Only requests for this delegator prefix. */
  delegator?: string;
}

/** Collaborator for the pure reads: the event stores. A `Habery` fits. */
export interface DelegationApprovalReadDeps {
  readonly db: Baser;
}

/** Collaborators for `approveDelegation`; nothing else is reachable from here. */
export interface DelegationApprovalDeps extends ReceiptingDeps {
  /** Query sender; only its enqueueing entry is used. */
  readonly querying: Pick<WitnessInquisitor, "enqueue">;
}

/** Collaborators for the observe-only wait. */
export interface DelegationApprovalWaitDeps extends DelegationApprovalReadDeps {
  /**
   * Host hook run before each read, normally `() => settleDelegationApproval(deps, request)`.
   * It is local and idempotent. Omitted: the wait only reads.
   */
  readonly settle?: () => void;
  /** Optional sink told `{kind:"delegation", id:"<delegate>:<sn>"}` when the wait settles. */
  readonly changes?: ChangeSink;
}

/** Collaborator for `dismissDelegation`: the controller notice store. */
export interface DelegationDismissDeps {
  readonly notifier: Pick<Notifier, "list" | "remove">;
}

/** Choices for `approveDelegation`. */
export interface ApproveDelegationOptions {
  /**
   * Event that carries the anchor. KERIpy permits either; a rotation also
   * changes the delegator's keys, so the caller must choose it explicitly.
   */
  event: "ixn" | "rot";
  /** Resolved witness Authorization values for receipting the anchoring event. */
  auths?: WitnessAuthMap;
}

/** Choices for `waitForDelegationApproval`. */
export interface WaitForDelegationApprovalOptions {
  /** Wall-clock budget; defaults to {@link DELEGATION_APPROVAL_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Position of the delegator's anchoring event. */
export interface DelegationAnchor {
  readonly sn: number;
  readonly said: string;
}

/**
 * Durable state of one request.
 * - `awaiting-approval`: the delegator has not anchored the event.
 * - `anchored`: the anchor is in the delegator's KEL; the delegate's event is not accepted yet.
 *   `receipted` is false while the anchoring event lacks its witness receipts.
 * - `approved`: anchored and the delegate's event is accepted.
 * - `unknown`: no such delegated event is held locally.
 */
export type DelegationApprovalStatus =
  | { state: "awaiting-approval" }
  | { state: "anchored"; anchor: DelegationAnchor; receipted: boolean }
  | { state: "approved"; anchor: DelegationAnchor }
  | { state: "unknown"; reason: "no-local-event" };

/** Outcome of a wait; `settled` means `approved`, `timed-out` carries the last status read. */
export type DelegationApprovalWaitResult = WaitResult<DelegationApprovalStatus>;

/** Outcome of {@link waitForPendingDelegation}; `settled` carries the pending requests, `timed-out` the (empty) last read. */
export type PendingDelegationWaitResult = WaitResult<PendingDelegation[]>;

/** Delegator prefix for escrowed `dip` or `drt` material, if it is derivable. */
function delegationSourcePrefix(db: Baser, serder: SerderKERI, pre: string): string | undefined {
  if (serder.delpre) return serder.delpre;
  if (serder.ilk !== "drt") return undefined;
  const delegatedPre = serder.pre ?? pre;
  return db.getKever(delegatedPre)?.delpre ?? db.getState(delegatedPre)?.di;
}

/** Project a delegated event into the seal the approving event embeds. */
export function delegationSeal(serder: SerderKERI): { i: string; s: string; d: string } {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError("Delegated event is missing pre, sn, or said.");
  }
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function requestFromEscrow(db: Baser, serder: SerderKERI, pre: string): DelegationRequest | null {
  const delegator = delegationSourcePrefix(db, serder, pre);
  if (!delegator) return null;
  const seal = delegationSeal(serder);
  return {
    delegate: seal.i,
    sn: serder.sn ?? 0,
    said: seal.d,
    ilk: serder.ilk === "drt" ? "drt" : "dip",
    delegator,
  };
}

/** Find the delegator's KEL event that seals the request, whether or not it is receipted. */
function findAnchor(db: Baser, request: DelegationRequest): SerderKERI | null {
  for (const [, said] of db.getKelItemIter(request.delegator)) {
    const serder = db.getEvtSerder(request.delegator, said);
    for (const seal of serder?.seals ?? []) {
      const { i, s, d } = (seal ?? {}) as Record<string, unknown>;
      if (i === request.delegate && d === request.said && typeof s === "string" && parseInt(s, 16) === request.sn) {
        return serder;
      }
    }
  }
  return null;
}

function anchorOf(serder: SerderKERI): DelegationAnchor {
  return { sn: serder.sn ?? 0, said: serder.said! };
}

function inEscrow(db: Baser, request: DelegationRequest): boolean {
  return db.delegables.get([request.delegate]).includes(request.said);
}

/** True once the delegated event has left escrow and reached local state. */
export function delegateCommitted(db: Baser, delegate: string, sn: number): boolean {
  const kever = db.getKever(delegate);
  return kever !== undefined && kever !== null && kever.sn >= sn;
}

/** Witnesses of the delegate after the delegated event: `backs` of a `dip`, current witnesses otherwise. */
export function delegateWitnesses(db: Baser, serder: SerderKERI): string[] {
  if ((serder.sn ?? 0) === 0) return [...serder.backs];
  if (!serder.pre) return [];
  return [...(db.getKever(serder.pre)?.wits ?? [])];
}

/** Build the logs query that pulls the delegated event's replay from one delegate witness. */
export function delegateWitnessLogsQuery(signer: string, serder: SerderKERI, witness: string): QueryRequest {
  if (!serder.pre || !serder.snh) {
    throw new ValidationError("Delegated event is missing pre or sn for query.");
  }
  return {
    pre: serder.pre,
    signer,
    src: witness,
    route: "logs",
    q: { fn: "0", s: serder.snh },
    wits: [witness],
  };
}

/** Record the approving seal for the delegated event and let the delegator's escrow promote it. */
export function pinApprovalSeal(hby: Habery, hab: Hab, delegated: SerderKERI, approving: SerderKERI): void {
  if (!approving.sner || !approving.said || !delegated.pre || !delegated.said) {
    throw new ValidationError("Approving event material is incomplete.");
  }
  hby.db.aess.pin(dgKey(delegated.pre, delegated.said), [approving.sner, new Diger({ qb64: approving.said })]);
  hab.kvy.processEscrowDelegables();
}

/**
 * List delegated events awaiting approval, oldest sequence first. Reads every
 * `delegables.` row, with no cap, and skips rows whose delegated event already
 * reached local state. Pure.
 */
export function listPendingDelegations(
  deps: DelegationApprovalReadDeps,
  { delegator }: PendingDelegationFilter = {},
): PendingDelegation[] {
  const { db } = deps;
  const pending: PendingDelegation[] = [];
  for (const [keys, said] of db.delegables.getTopItemIter()) {
    const pre = keys[0];
    const serder = pre ? db.getEvtSerder(pre, said) : null;
    const request = serder && pre ? requestFromEscrow(db, serder, pre) : null;
    if (!request || (delegator !== undefined && request.delegator !== delegator)) continue;
    if (delegateCommitted(db, request.delegate, request.sn)) continue;
    pending.push({ ...request, anchored: findAnchor(db, request) !== null });
  }
  return pending.sort((left, right) => left.sn - right.sn);
}

/** Read the durable status of one request; mutates nothing. */
export function delegationApprovalStatus(
  deps: DelegationApprovalReadDeps,
  request: DelegationRequest,
): DelegationApprovalStatus {
  const { db } = deps;
  const committed = delegateCommitted(db, request.delegate, request.sn);
  if (!committed && !inEscrow(db, request)) return { state: "unknown", reason: "no-local-event" };
  const anchor = findAnchor(db, request);
  if (!anchor) return { state: "awaiting-approval" };
  if (committed) return { state: "approved", anchor: anchorOf(anchor) };
  return { state: "anchored", anchor: anchorOf(anchor), receipted: db.fullyWitnessed(anchor) };
}

/**
 * Local step after anchoring: record the approving seal and process the
 * `delegables.` escrow. Idempotent, sends nothing and signs nothing. It does
 * nothing until the anchor exists and, for a delegate with witnesses, until the
 * delegate's event has arrived through the witness replay, because pinning
 * earlier would make local state look approved while incomplete.
 */
export function settleDelegationApproval(
  deps: Pick<DelegationApprovalDeps, "hby">,
  request: DelegationRequest,
): void {
  const { hby } = deps;
  const hab = hby.habs.get(request.delegator);
  const delegated = hby.db.getEvtSerder(request.delegate, request.said);
  const anchor = findAnchor(hby.db, request);
  if (!hab || !delegated || !anchor) return;
  const witnessed = delegateWitnesses(hby.db, delegated).length > 0;
  if (witnessed && !delegateCommitted(hby.db, request.delegate, request.sn)) return;
  pinApprovalSeal(hby, hab, delegated, anchor);
}

/**
 * Approve one delegated event: anchor its seal in the delegator's KEL unless
 * the KEL already holds it, obtain witness receipts for the anchoring event and
 * ask the delegate's witness for the delegated event. Returns without waiting
 * for the delegate; use {@link waitForDelegationApproval}.
 *
 * Repeating the call after a failure resumes at the first step not yet done.
 *
 * @throws ValidationError for a request not held locally, a delegator that is not a local single-signature identifier, or an anchor that cannot be read back.
 */
export function* approveDelegation(
  deps: DelegationApprovalDeps,
  request: DelegationRequest,
  { event, auths }: ApproveDelegationOptions,
): Operation<DelegationApprovalStatus> {
  const { hby } = deps;
  const delegated = hby.db.getEvtSerder(request.delegate, request.said);
  const status = delegationApprovalStatus(hby, request);
  if (status.state === "unknown" || !delegated) {
    throw new ValidationError(`No delegated ${request.ilk} ${request.said} is held for ${request.delegate}.`);
  }
  const hab = hby.habs.get(request.delegator);
  if (!hab || isLocalGroupHab(hby, hab)) {
    throw new ValidationError(`${request.delegator} is not a local single-signature delegator.`);
  }
  if (!hab.kever) throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);

  let anchor = findAnchor(hby.db, request);
  if (!anchor) {
    const data = [delegationSeal(delegated)];
    if (event === "ixn") hab.interact({ data });
    else hab.rotate({ data });
    anchor = findAnchor(hby.db, request);
    if (!anchor) throw new ValidationError("Approving event material is incomplete.");
  }

  yield* receiptEvent(deps, hab.pre, { sn: anchorOf(anchor).sn, auths });
  requestDelegatedEvent(deps, request, hab.pre);
  return delegationApprovalStatus(hby, request);
}

/**
 * After the anchor exists: record the approving seal and ask the delegate's witness
 * for the delegated event unless it already arrived. `signer` is the local identifier
 * that sends the query: the delegator, or a group delegator's local member. Idempotent.
 */
export function requestDelegatedEvent(
  deps: Pick<DelegationApprovalDeps, "hby" | "querying" | "changes">,
  request: DelegationRequest,
  signer: string,
): void {
  const { hby } = deps;
  const delegated = hby.db.getEvtSerder(request.delegate, request.said);
  if (!delegated) {
    throw new ValidationError(`No delegated ${request.ilk} ${request.said} is held for ${request.delegate}.`);
  }
  settleDelegationApproval(deps, request);
  const [witness] = delegateWitnesses(hby.db, delegated).sort();
  if (!delegateCommitted(hby.db, request.delegate, request.sn)) {
    // A delegate with no witness is asked through the same logs route with the usual attester choice.
    deps.querying.enqueue(
      witness
        ? delegateWitnessLogsQuery(signer, delegated, witness)
        : { pre: request.delegate, signer, route: "logs", q: { fn: "0", s: delegated.snh! } },
    );
  }
  deps.changes?.push({ kind: "delegation", id: `${request.delegate}:${request.sn}` });
}

/**
 * Propose a group delegator's anchoring interaction for one request: the group
 * interaction that seals the delegated event, published to the other members.
 * Returns without waiting; the other members approve it with `approveGroupProposal`
 * and the Counselor receipts it, so read progress with `delegationApprovalStatus`
 * and `counselor.status(result.event)`.
 *
 * Idempotent: null when the group's KEL already holds the anchor, so a repeat
 * never anchors twice.
 *
 * @throws ValidationError for a request not held locally or a delegator that is not a local group.
 */
export function* proposeGroupDelegationApproval(
  deps: GroupProposeDeps,
  request: DelegationRequest,
  inputs?: CounselInputs,
): Operation<GroupEventResult | null> {
  const { hby } = deps;
  const delegated = hby.db.getEvtSerder(request.delegate, request.said);
  if (delegationApprovalStatus(hby, request).state === "unknown" || !delegated) {
    throw new ValidationError(`No delegated ${request.ilk} ${request.said} is held for ${request.delegate}.`);
  }
  const group = hby.habs.get(request.delegator);
  if (!group || !isLocalGroupHab(hby, group)) {
    throw new ValidationError(`${request.delegator} is not a local group delegator.`);
  }
  if (findAnchor(hby.db, request)) return null;
  return yield* proposeGroupInteraction(deps, group, [delegationSeal(delegated)], inputs);
}

/**
 * Observe until at least one delegated event awaits the delegator, or the budget
 * expires. Waits on the delegator's own `delegables.` escrow only: unrelated
 * group proposals, queries or OOBIs never hold it open. Starts no worker; the
 * host's runtime brings the request in through its mailbox or witness polling.
 *
 * `timed-out` means no request reached local state in the budget, which is also
 * what a request that was already approved and committed looks like.
 */
export function* waitForPendingDelegation(
  deps: DelegationApprovalWaitDeps,
  filter: PendingDelegationFilter = {},
  { timeoutMs = DELEGATION_APPROVAL_TIMEOUT_MS }: WaitForDelegationApprovalOptions = {},
): Operation<PendingDelegationWaitResult> {
  const done = yield* observeUntil(() => listPendingDelegations(deps, filter).length > 0, { timeoutMs });
  const status = listPendingDelegations(deps, filter);
  if (!done && status.length === 0) return { outcome: "timed-out", status, timeoutMs };
  for (const request of status) deps.changes?.push({ kind: "delegation", id: `${request.delegate}:${request.sn}` });
  return { outcome: "settled", status };
}

/**
 * Observe a group delegator's request until its anchor is in the group's KEL and
 * receipted by witnesses, or the delegate's event is already accepted. This is
 * the point where {@link requestDelegatedEvent} can ask for the delegate's event.
 */
export function* waitForDelegationAnchor(
  deps: DelegationApprovalWaitDeps,
  request: DelegationRequest,
  { timeoutMs = DELEGATION_APPROVAL_TIMEOUT_MS }: WaitForDelegationApprovalOptions = {},
): Operation<DelegationApprovalWaitResult> {
  const ready = (status: DelegationApprovalStatus) =>
    status.state === "approved" || (status.state === "anchored" && status.receipted);
  const done = yield* observeUntil(() => ready(delegationApprovalStatus(deps, request)), { timeoutMs });
  const status = delegationApprovalStatus(deps, request);
  if (!done && !ready(status)) return { outcome: "timed-out", status, timeoutMs };
  return { outcome: "settled", status };
}

/**
 * Observe the request until it is `approved` or the budget expires. Starts no
 * worker; the host's runtime brings the delegate's event in.
 */
export function* waitForDelegationApproval(
  deps: DelegationApprovalWaitDeps,
  request: DelegationRequest,
  { timeoutMs = DELEGATION_APPROVAL_TIMEOUT_MS }: WaitForDelegationApprovalOptions = {},
): Operation<DelegationApprovalWaitResult> {
  const read = () => {
    deps.settle?.();
    return delegationApprovalStatus(deps, request);
  };
  const done = yield* observeUntil(() => read().state === "approved", { timeoutMs });
  const status = read();
  if (!done || status.state !== "approved") return { outcome: "timed-out", status, timeoutMs };
  deps.changes?.push({ kind: "delegation", id: `${request.delegate}:${request.sn}` });
  return { outcome: "settled", status };
}

/**
 * Remove the controller notices (`/delegate/request`) that announced this
 * request. Local only: the delegated event stays in escrow and the delegate is
 * told nothing, so the request can still be approved or listed later.
 *
 * @returns Number of notices removed.
 */
export function dismissDelegation(deps: DelegationDismissDeps, request: DelegationRequest): number {
  const stale: string[] = [];
  for (let start = 0;; start += 25) {
    const page = deps.notifier.list(start, 25);
    for (const note of page) {
      const attrs = note.pad.a;
      const evt = attrs["ked"] as { d?: unknown } | undefined;
      if (attrs["r"] === DELEGATE_REQUEST_ROUTE && attrs["delpre"] === request.delegator && evt?.d === request.said) {
        stale.push(note.pad.i);
      }
    }
    if (page.length < 25) break;
  }
  return stale.filter((rid) => deps.notifier.remove(rid)).length;
}
