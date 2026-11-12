/**
 * Library home for settling one ACDC v2 registry event (`rip` or `bup`) that a
 * group sealed in a KEL anchor. Written once so every host (CLI, tufa, wallet,
 * service) shares one definition of "the registry event is done".
 *
 * The TEL event is accepted only after the group's anchor is accepted in the
 * group KEL and fully witnessed, then the registry escrows are reprocessed:
 * - `registryEventStatus` is a pure read of durable state.
 * - `settleRegistryEvent` is the local step: it reprocesses the escrows once.
 *   Idempotent; it signs, sends and receipts nothing, because
 *   witness receipting needs host choices (authorization codes, endpoint mode).
 * - `waitForRegistryEvent` only observes and starts no worker.
 *
 * The anchor facts come from the KEL itself, the same facts the Counselor derives
 * for a group event, because a one-shot host such as the CLI does not run the
 * Counselor loop. Dependencies are declared collaborators, not an AgentRuntime.
 */
import type { SerderACDC } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { RegistryStore } from "../../acdc/registering.ts";
import type { Baser } from "../../db/basing.ts";
import type { GroupEventRef } from "../multisig/counseling.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import { observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";

/** Elapsed milliseconds between reads of a registry wait. */
export const REGISTRY_WAIT_POLL_MS = 50;

/** Exact registry event and the group anchor that seals it. */
export interface RegistryEventRef {
  /** Registry identifier. */
  readonly regid: string;
  /** Sequence number of the TEL event. */
  readonly sn: number;
  /** SAID of the TEL event. */
  readonly said: string;
  /** Group KEL event that carries the seal. */
  readonly anchor: GroupEventRef;
}

/** Collaborators for the pure read. */
export interface RegistryEventReadDeps {
  readonly db: Baser;
  readonly store: Pick<RegistryStore, "seqEvent">;
}

/** Collaborators for {@link settleRegistryEvent}. */
export interface RegistrySettleDeps extends RegistryEventReadDeps {
  readonly protocol: Pick<ProtocolProcessor, "processEscrowsOnce">;
}

/**
 * Durable state of one registry event:
 * - `awaiting-anchor`: the group KEL has not accepted the anchor.
 * - `awaiting-receipts`: the anchor is accepted but lacks its witness receipts.
 * - `awaiting-tel`: the anchor is complete; the registry escrows have not accepted the event.
 * - `accepted`: the TEL event is accepted at its sequence number.
 */
export type RegistryEventStatus =
  | { state: "awaiting-anchor" }
  | { state: "awaiting-receipts" }
  | { state: "awaiting-tel" }
  | { state: "accepted" };

/** Outcome of a wait; `timed-out` carries the status read at the deadline. */
export type RegistryWaitResult = WaitResult<RegistryEventStatus, { deadline: number }>;

/** Wait choices; the deadline is an epoch-millisecond instant. */
export interface RegistryWaitOptions {
  deadline: number;
  clock?: Pick<RuntimeClock, "now">;
}

/** Reference for a TEL event sealed by a known anchor. */
export function registryEventRef(tel: SerderACDC, anchor: GroupEventRef): RegistryEventRef {
  return {
    regid: tel.ilk === "rip" ? tel.said! : tel.regid!,
    sn: Number(BigInt(`0x${tel.sad!.n}`)),
    said: tel.said!,
    anchor,
  };
}

/** Read the status of one registry event; mutates nothing. */
export function registryEventStatus(deps: RegistryEventReadDeps, ref: RegistryEventRef): RegistryEventStatus {
  if (deps.store.seqEvent(ref.regid, ref.sn)?.said === ref.said) return { state: "accepted" };
  const { pre, said } = ref.anchor;
  const anchor = deps.db.getEvtSerder(pre, said);
  if (!anchor || deps.db.kels.getLast(pre, anchor.sn!) !== said) return { state: "awaiting-anchor" };
  return deps.db.fullyWitnessed(anchor) ? { state: "awaiting-tel" } : { state: "awaiting-receipts" };
}

/**
 * Local settle step: reprocess the escrows once. That accepts the anchor when
 * the last member signature has arrived and, once the anchor is complete, the
 * sealed TEL event. Does nothing for an event already accepted.
 */
export function* settleRegistryEvent(deps: RegistrySettleDeps, ref: RegistryEventRef): Operation<RegistryEventStatus> {
  if (registryEventStatus(deps, ref).state === "accepted") return { state: "accepted" };
  yield* deps.protocol.processEscrowsOnce();
  return registryEventStatus(deps, ref);
}

/** Observe the event until `accepted` or the deadline passes. Starts no worker; the host settles. */
export function* waitForRegistryEvent(
  deps: RegistryEventReadDeps,
  ref: RegistryEventRef,
  { deadline, clock = systemClock }: RegistryWaitOptions,
): Operation<RegistryWaitResult> {
  const done = yield* observeUntil(() => registryEventStatus(deps, ref).state === "accepted", {
    timeoutMs: Math.max(0, deadline - clock.now()),
    clock,
    pollMs: REGISTRY_WAIT_POLL_MS,
  });
  const status = registryEventStatus(deps, ref);
  return done ? { outcome: "settled", status } : { outcome: "timed-out", status, deadline };
}
