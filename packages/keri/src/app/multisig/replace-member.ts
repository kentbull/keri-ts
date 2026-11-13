/**
 * Replace a local group's recorded member after a rotation removed it, and end the runtime's work bound to it.
 *
 * `Habery.joinGroupHab` re-points the record and clears the durable rows addressed to the old member. The
 * runtime owns the live operations, so this is the one call that also ends them: an issuance whose party
 * member or frozen DH custodian is the old member, and an Unblind holding it. Each ends through its owner's
 * own end path, which releases the approval and drops the held `heldq`/`heldu` rows. Group IPEX messages and
 * presentations keep no member binding (their contributions are already signed and the member is read live),
 * so they are left to run. It then prompts the mailbox poller, the KEL publisher and the root replicator for the
 * group, so each acts as the new member on its next tock instead of at its next sweep. Nothing is signed and no
 * event is made.
 */
import { ValidationError } from "../../core/errors.ts";
import type { Hab } from "../identity/habbing.ts";
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
}

/** What {@link replaceGroupMember} did. */
export interface ReplacedGroupMember {
  /** The member the record named before. */
  previous: string;
  /** Grants of the issuance operations ended. */
  issuance: string[];
  /** Grants of the Unblind operations ended. */
  unblinding: string[];
}

/**
 * Replace the local member of `input.group`, then end live operations bound to the previous one.
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
  return {
    previous,
    issuance: ops?.issuance.endBoundToMember(group, previous, reason) ?? [],
    unblinding: ops?.unblinding.endBoundToMember(group, previous, reason) ?? [],
  };
}
