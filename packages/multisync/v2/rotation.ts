import type { RegistryCustody } from "@keri-ts/wallet";
import { groupSigningMembers, type Hab, localGroupMember, ValidationError } from "keri-ts/runtime";

/** Transient rotation output supplied by the application after protocol acceptance. */
export interface AcceptedRotation {
  accepted: boolean;
  previousSigningMembers: readonly string[];
  signingMembers: readonly string[];
}

/** Select newcomer recipients for the current lowest-index signing member.
 *
 * This is application orchestration, not membership authentication. The caller
 * obtains both lists from the actual rotation operation and rechecks accepted
 * state before signing each reply. Rotation approval does not approve a salt
 * reply: ordinary group reply thresholds remain necessary. Selection is neither
 * persisted nor retried here; explicit provisioning remains available after an
 * interrupted application run.
 */
export function replicationTargets(rotation: AcceptedRotation, localMember: string): string[] {
  if (!rotation.accepted || rotation.signingMembers[0] !== localMember) return [];
  const previous = new Set(rotation.previousSigningMembers);
  return [...new Set(rotation.signingMembers)].filter((member) => !previous.has(member));
}

/** Prepare recipient work from the accepted live group, without signing or sending.
 * Caller supplies the command's transient prior membership and exact rotation
 * digest. A later rotation requires a new selection; no stored roster is used.
 */
export function replicationRequests(
  custody: RegistryCustody,
  group: Hab,
  rotation: AcceptedRotation & { rotation: string },
): { registry: string; recipient: string; target: string }[] {
  if (!rotation.accepted) return [];
  const { hby } = custody.options;
  if (group.kever?.lastEst.d !== rotation.rotation) {
    throw new ValidationError("Group establishment changed before salt provisioning");
  }
  const signingMembers = groupSigningMembers(hby, group.pre);
  const targets = replicationTargets({ ...rotation, signingMembers }, localGroupMember(hby, group.pre).pre);
  if (!targets.length) return [];
  return custody.registriesFor(group.pre).flatMap((registry) =>
    targets.map((target) => ({ registry, recipient: group.pre, target }))
  );
}
