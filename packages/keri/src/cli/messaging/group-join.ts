/**
 * `tufa multisig join` proposal selection, as KERIpy `kli multisig join`.
 *
 * Join approves exactly one stored proposal, the first the user consents to:
 * - an explicit `--said` names the proposal, otherwise the unapproved proposals
 *   the notice store announces are offered in notice order;
 * - without `--auto` every offered proposal is shown and approved only on a yes;
 * - with `--auto` the first offered proposal is approved without a prompt. This is
 *   the whole of auto consent: it exists only inside the `join` the user ran for
 *   that purpose, and no other command signs a proposal it was not asked to sign.
 *
 * Signing, publication and the Counselor hand-off belong to `approveGroupProposal`.
 */
import { type Operation, sleep } from "npm:effection@^3.6.0";
import type { Habery } from "../../app/identity/habbing.ts";
import {
  approveGroupProposal,
  dismissGroupProposal,
  findGroupProposal,
  type GroupApprovalChoices,
  type GroupApprovalDeps,
  type GroupApprovalResult,
  type GroupProposal,
  listGroupProposals,
} from "../../app/multisig/proposals.ts";
import type { Notifier } from "../../app/notifications/notifying.ts";
import { ValidationError } from "../../core/errors.ts";

/** Approval collaborators with a notice store that can also be cleared of the joined proposal. */
export type JoinDeps = Omit<GroupApprovalDeps, "notifier"> & {
  readonly notifier: Pick<Notifier, "list" | "remove"> | null;
};

/** What the user is asked, and what a host-chosen answer carries into the approval. */
export interface JoinPrompts {
  /** Whether the user consents to sign this proposal. */
  confirm(proposal: GroupProposal): boolean;
  /** Local alias for a group this member has not joined yet. */
  groupAlias(proposal: GroupProposal): string;
  /** Local name for a registry proposal. */
  registryName(proposal: GroupProposal): string;
  /** Extra approval inputs such as the Counselor's memory-only choices; may refuse by throwing. */
  inputs(proposal: GroupProposal): GroupApprovalChoices;
}

/** One selection pass over stored proposals. */
export interface JoinOptions extends JoinPrompts {
  /** Group prefix or alias that proposals must belong to; a name not yet used (a group to be created) filters nothing. */
  group?: string;
  /** Wrapper SAID of the one proposal to approve. */
  said?: string;
  /** Epoch milliseconds after which an empty search gives up. */
  deadline: number;
}

/** The proposal that was approved and what approval did. */
export interface JoinedProposal {
  proposal: GroupProposal;
  result: GroupApprovalResult;
}

/** Group prefix for a joined group's prefix or alias; undefined for a name not yet used. */
function joinedGroup(hby: Habery, group: string | undefined): string | undefined {
  return group === undefined ? undefined : (hby.habByName(group) ?? hby.habs.get(group))?.pre ?? undefined;
}

/** Candidates for one pass, oldest first. */
function candidates(deps: JoinDeps, { said, group }: JoinOptions): GroupProposal[] {
  const wanted = joinedGroup(deps.hby, group);
  if (said !== undefined) {
    const proposal = findGroupProposal(deps, said);
    if (proposal && wanted !== undefined && proposal.group !== wanted) {
      throw new ValidationError(`Multisig exchange ${said} belongs to group ${proposal.group}, not ${wanted}.`);
    }
    return proposal ? [proposal] : [];
  }
  return listGroupProposals(deps, wanted === undefined ? {} : { group: wanted })
    .filter(proposal => proposal.local === "unapproved");
}

/**
 * Approve the first proposal the user consents to, polling stored proposals until
 * the deadline. A declined proposal is not offered again by this call. Returns
 * null when nothing was approved; the host owns the runtime that delivers new
 * proposals while this waits.
 */
export function* joinProposal(deps: JoinDeps, options: JoinOptions): Operation<JoinedProposal | null> {
  if (!deps.notifier && options.said === undefined) {
    throw new ValidationError("Multisig join requires notification storage or an explicit exchange SAID.");
  }
  const skipped = new Set<string>();
  while (true) {
    for (const proposal of candidates(deps, options)) {
      if (skipped.has(proposal.said)) continue;
      // An explicit proposal already approved here is replayed without asking again.
      if (proposal.local !== "approved" && !options.confirm(proposal)) {
        skipped.add(proposal.said);
        continue;
      }
      const choices: GroupApprovalChoices = { ...options.inputs(proposal) };
      if (proposal.needs.groupAlias) choices.groupAlias = options.groupAlias(proposal);
      if (proposal.needs.registryName) choices.registryName = options.registryName(proposal);
      let result: GroupApprovalResult;
      try {
        result = yield* approveGroupProposal(deps, proposal.said, choices);
      } catch (error) {
        // A proposal that cannot be approved never hides a later one; an explicit SAID reports why.
        if (options.said === undefined && error instanceof ValidationError) {
          skipped.add(proposal.said);
          continue;
        }
        throw error;
      }
      dismissGroupProposal(deps, proposal.said);
      return { proposal, result };
    }
    const remaining = options.deadline - Date.now();
    if (remaining <= 0) return null;
    yield* sleep(Math.min(250, remaining));
  }
}
