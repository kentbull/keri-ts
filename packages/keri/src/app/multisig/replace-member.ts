/**
 * Replace a local group's recorded member after a rotation removed it, end the runtime's work bound to it, and
 * retire it when nothing else needs it.
 *
 * `Habery.joinGroupHab` re-points the record and clears the durable rows addressed to the old member. The
 * runtime owns the live operations, so this is the one call that also ends them: an issuance whose party
 * member or frozen DH custodian is the old member, and an Unblind holding it. Each ends through its owner's
 * own end path, which releases the approval and drops the held `heldq`/`heldu` rows. Group IPEX messages and
 * presentations keep no member binding (their contributions are already signed and the member is read live),
 * so they are left to run. It then prompts the mailbox poller, the KEL publisher and the root replicator for the
 * group, so each acts as the new member on its next tock instead of at its next sweep. Nothing is signed and no
 * event is made.
 *
 * Last, the old member is retired with `retireIdentifier` (its stored keys deleted, its mailbox workers
 * stopped, every KEL and BADA record about it kept) unless the caller set `keepPrevious` or
 * `retireIdentifierRefusal` names a reason to keep it: it is a member of another local group, a delegator, a
 * registry issuer, or has live work. A kept member does not fail the replacement; the result says why it was
 * kept.
 */
import { ValidationError } from "../../core/errors.ts";
import type { Hab } from "../identity/habbing.ts";
import { type RetiredIdentifier, retireIdentifier, retireIdentifierRefusal } from "../identity/retire-identifier.ts";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";

/** What {@link replaceGroupMember} needs. */
export interface ReplaceGroupMemberInput {
  /** Local group identifier. */
  group: string;
  /** The Habery's habitat that is a member in the group's accepted key state and becomes the local member. */
  member: Hab;
  /** The group's accepted signing members, as for `Habery.joinGroupHab`. */
  smids: readonly string[];
  /** The group's accepted rotation members; defaults to `smids`. */
  rmids?: readonly string[];
  /** Keep the previous member as a local identifier instead of retiring it. Default false. */
  keepPrevious?: boolean;
}

/** What became of the previous member: retired, or kept as a local identifier with the reason. */
export type PreviousMemberOutcome =
  | { kind: "retired"; retired: RetiredIdentifier }
  | { kind: "kept"; reason: string };

/** What {@link replaceGroupMember} did. */
export interface ReplacedGroupMember {
  /** The member the record named before. */
  previous: string;
  /** Grants of the issuance operations ended. */
  issuance: string[];
  /** Grants of the Unblind operations ended. */
  unblinding: string[];
  /** Whether the previous member was retired, and why not when it was kept. */
  previousMember: PreviousMemberOutcome;
}

/**
 * Replace the local member of `input.group`, end live operations bound to the previous one, then retire the
 * previous one unless it is kept (see the module doc).
 *
 * @throws ValidationError when `joinGroupHab` refuses: the group has no accepted state, the previous member is
 * still a member of it, or the new one is not.
 */
export function replaceGroupMember(runtime: AgentRuntime, input: ReplaceGroupMemberInput): ReplacedGroupMember {
  const { hby } = runtime, { group, member } = input;
  const record = hby.db.getHab(group), alias = record?.name;
  if (!record?.mid || !alias) throw new ValidationError(`Group ${group} is not a local group habitat.`);
  const previous = record.mid;
  if (previous === member.pre) throw new ValidationError(`Member ${previous} is already the local member of ${group}.`);
  hby.joinGroupHab(group, alias, member, input.smids, input.rmids ?? input.smids, record.domain);
  const reason = `Local member ${previous} of group ${group} was replaced by ${member.pre}`;
  runtime.mailboxPoller.prompt(group);
  runtime.kelPublisher.prompt(group);
  runtime.rootReplicator?.prompt(group);
  const ops = runtime.operations;
  const issuance = ops?.issuance.endBoundToMember(group, previous, reason) ?? [];
  const unblinding = ops?.unblinding.endBoundToMember(group, previous, reason) ?? [];
  return { previous, issuance, unblinding, previousMember: retirePrevious(runtime, previous, input.keepPrevious) };
}

/** Retire the replaced member, or say why it is kept. */
function retirePrevious(runtime: AgentRuntime, previous: string, keep = false): PreviousMemberOutcome {
  if (keep) return { kind: "kept", reason: "The caller asked to keep the previous member." };
  const refusal = retireIdentifierRefusal(runtime, previous);
  if (refusal) return { kind: "kept", reason: refusal };
  return { kind: "retired", retired: retireIdentifier(runtime, previous) };
}
