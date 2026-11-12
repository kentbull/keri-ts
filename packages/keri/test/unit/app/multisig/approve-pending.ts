/** Test support: approve a stored group proposal through the library API the way a host would. */
import type { Operation } from "effection";
import type { Habery } from "../../../../src/app/identity/habbing.ts";
import {
  approveGroupProposal,
  type GroupApprovalDeps,
  type GroupApprovalResult,
  listGroupProposals,
} from "../../../../src/app/multisig/proposals.ts";
import type { AgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";

/** Approval collaborators of a runtime; the notifier may be absent to prove SAID selection needs none. */
export function approvalDepsOf(hby: Habery, runtime: Partial<AgentRuntime> & Pick<AgentRuntime, "exc">) {
  return {
    hby,
    exc: runtime.exc,
    reactor: runtime.reactor!,
    protocol: runtime.protocol!,
    postman: runtime.postman!,
    notifier: runtime.notifier ?? null,
    registryStore: runtime.acdc?.store ?? null,
    vdr: runtime.vdr ?? null,
    counselor: runtime.counselor!,
  } satisfies GroupApprovalDeps;
}

/**
 * Approve the proposal named by `said`, or else the first unapproved one the notice
 * store lists (for `group` when given). Null when nothing is offered, as a join that
 * finds no proposal. Calling it is the consent: nothing prompts.
 */
export function* approvePending(
  hby: Habery,
  runtime: Partial<AgentRuntime> & Pick<AgentRuntime, "exc">,
  { said, group, groupAlias = "group", registryName = "registry" }: {
    said?: string;
    group?: string;
    groupAlias?: string;
    registryName?: string;
  } = {},
): Operation<GroupApprovalResult | null> {
  const deps = approvalDepsOf(hby, runtime);
  const target = said ?? listGroupProposals(deps, { group }).find(proposal => proposal.local === "unapproved")?.said;
  return target ? yield* approveGroupProposal(deps, target, { groupAlias, registryName }) : null;
}
