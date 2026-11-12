/**
 * What a group command does after it has proposed or approved an event: give the
 * Counselor the user's choices and wait on it. Nothing here signs; the only call
 * that signs a proposal is `approveGroupProposal`, which `group-join.ts` makes for
 * the one proposal the user chose. A proposer's wait therefore cannot sign any
 * other stored proposal.
 */
import { Ilks } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { resolveDelegationCommunicationHab } from "../../app/identity/delegating.ts";
import { DELEGATION_WAIT_TIMEOUT_MS } from "../../app/identity/event-completion.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import {
  type CounselInputs,
  type GroupEventRef,
  type GroupEventStatus,
  waitForGroupEvent,
} from "../../app/multisig/counseling.ts";
import type { AgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { observeUntil } from "../../app/runtime/workflow-contract.ts";
import { ValidationError } from "../../core/errors.ts";
import { resolveWitnessAuths } from "../common/witness-auth.ts";

/** Witness authorization choices of a group command. */
export interface WitnessChoices {
  code?: string[];
  codeTime?: string;
  authenticate?: boolean;
}

/** The local hab that sends a delegated group event's traffic; the user must name it. */
export function delegationProxy(hby: Habery, alias: string | undefined, label: string): Hab {
  const proxy = resolveDelegationCommunicationHab(hby, alias);
  if (!proxy) throw new ValidationError(`Delegated group event for ${label} requires --proxy <alias>.`);
  return proxy;
}

/**
 * Counselor inputs for a proposed event. `fallbackAfterMs: 0` makes every member
 * submit witness receipts and publish the delegation request, as this command
 * always has; KERIpy's `kli` elects one member and the others only fetch.
 */
export function counselInputs(hby: Habery, proxy?: string, delegated = false, label = ""): CounselInputs {
  return { fallbackAfterMs: 0, ...(delegated ? { proxy: delegationProxy(hby, proxy, label) } : {}) };
}

/** Wait until the exact event is accepted here, replaced at its sn, or the deadline passes. */
export function* waitForAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  event: GroupEventRef,
  deadline: number,
): Operation<boolean> {
  const accepted = () => hby.db.kels.getLast(event.pre, event.sn) === event.said;
  yield* observeUntil(
    () => accepted() || runtime.counselor.status(event).state === "superseded",
    { timeoutMs: Math.max(0, deadline - Date.now()), pollMs: 50 },
  );
  return accepted();
}

/** Witness Authorization values for the group's current witnesses, as `--code`/`--authenticate` choose. */
export function witnessAuths(hby: Habery, pre: string, args: WitnessChoices) {
  const kever = hby.db.getKever(pre);
  if (!kever || kever.wits.length === 0) return undefined;
  return resolveWitnessAuths(kever.wits, args.code ?? [], {
    codeTime: args.codeTime,
    promptMissing: args.authenticate ?? false,
  });
}

/** Give a counseled event this command's witness authorizations; memory only. */
export function supplyWitnessAuths(
  hby: Habery,
  runtime: AgentRuntime,
  event: GroupEventRef | undefined,
  args: WitnessChoices,
) {
  const auths = event && witnessAuths(hby, event.pre, args);
  if (event && auths) runtime.counselor.supply(event, { auths });
}

/** Give a delegated event just approved here its proxy; other events need none. */
export function supplyDelegationProxy(hby: Habery, runtime: AgentRuntime, event: GroupEventRef, alias?: string): void {
  const ilk = hby.db.getEvtSerder(event.pre, event.said)?.ilk;
  if (ilk !== Ilks.dip && ilk !== Ilks.drt) return;
  runtime.counselor.supply(event, { proxy: delegationProxy(hby, alias, event.pre) });
}

/**
 * Wait for the Counselor to complete an accepted event: witness receipts and,
 * for a delegated event, the delegator's approval.
 *
 * @returns The delegation phase for a delegated inception or rotation, else null.
 */
export function* finishAcceptedEvent(
  hby: Habery,
  runtime: AgentRuntime,
  event: GroupEventRef,
  args: WitnessChoices,
): Operation<string | null> {
  supplyWitnessAuths(hby, runtime, event, args);
  const waited = yield* waitForGroupEvent(runtime.counselor, event, { timeoutMs: DELEGATION_WAIT_TIMEOUT_MS });
  if (waited.outcome === "timed-out") throw new Error(stalledMessage(event, waited.status));
  const kever = hby.db.getKever(event.pre);
  const ilk = hby.db.getEvtSerder(event.pre, event.said)?.ilk;
  return kever?.delpre && (ilk === Ilks.dip || ilk === Ilks.drt)
    ? runtime.delegating.workflowStatus(event.pre, kever.sner.numh).phase
    : null;
}

function stalledMessage(event: GroupEventRef, status: GroupEventStatus): string {
  const blocked = status.state === "pending" ? status.blocked : undefined;
  const why = !blocked
    ? `still waiting at ${status.state === "pending" ? status.stage : status.state}`
    : blocked.kind === "witnessAuth"
    ? `witness authorization is required for ${blocked.witnesses.join(", ")}`
    : blocked.kind === "witness"
    ? blocked.reason
    : blocked.kind === "delegatorUnknown"
    ? `delegator ${blocked.delpre} is unknown`
    : "delegation is not supported by this host";
  return `Group event ${event.pre} sn=${event.sn} did not complete within ${DELEGATION_WAIT_TIMEOUT_MS}ms: ${why}.`;
}
