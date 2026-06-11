import { ValidationError } from "../core/errors.ts";
import type { Hab, Habery } from "./habbing.ts";

/** True when the selected habitat is a local group habitat. */
export function isLocalGroupHab(hby: Habery, hab: Hab): boolean {
  return !!hab.pre && !!hby.db.getHab(hab.pre)?.mid;
}

/** Return the local member habitat for a persisted group identifier. */
export function localGroupMember(hby: Habery, groupPre: string): Hab {
  const record = hby.db.getHab(groupPre);
  const member = record?.mid ? hby.habs.get(record.mid) : null;
  if (!member) {
    throw new ValidationError(`Group ${groupPre} is missing local member metadata.`);
  }
  return member;
}

/** Return current group signing member AIDs in signing-index order. */
export function groupSigningMembers(hby: Habery, groupPre: string): string[] {
  const stored = hby.ks.getSmids(groupPre).map((tuple) => tuple[0].qb64);
  if (stored.length > 0) {
    return stored;
  }
  const record = hby.db.getHab(groupPre);
  return record?.smids ?? [];
}

/** Return the first locally available habitat from `members`, if any. */
export function findLocalGroupMember(hby: Habery, members: readonly string[]): Hab | null {
  for (const member of members) {
    const hab = hby.habs.get(member);
    if (hab) {
      return hab;
    }
  }
  return null;
}

/** Return unique non-empty member AIDs while preserving first-seen order. */
export function uniqueMembers(members: readonly string[]): string[] {
  return [...new Set(members.filter((member) => member.length > 0))];
}
