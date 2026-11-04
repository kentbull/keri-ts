import type { SerderKERI } from "cesr-ts";
import { TransIdxSigGroup } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import { Kever } from "../../core/kel/kever.ts";
import type { Baser } from "../../db/basing.ts";
import type { Hab, Habery } from "../identity/habbing.ts";

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

/** Match a group signing key to one member's accepted establishment history, including retired keys. */
export function groupMemberHasKey(db: Baser, member: string, key: string): boolean {
  for (const [, said] of db.getKelItemIter(member)) {
    const event = db.getEvtSerder(member, said);
    if (event?.estive && event.verfers[0]?.qb64 === key) return true;
  }
  return false;
}

/**
 * Select only a cryptographically valid local partial at an accepted group establishment.
 * The shared esigs table can hold unverified escrow candidates, so a matching
 * index or an authenticated parent wrapper alone is not recorded child approval.
 */
export function localIpexContribution(
  db: Baser,
  member: string,
  embedded: SerderKERI,
  proofs: readonly TransIdxSigGroup[],
): TransIdxSigGroup | null {
  for (const proof of proofs) {
    if (proof.pre !== embedded.pre || proof.sn > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const said = db.kels.getLast(proof.pre, Number(proof.sn));
    const event = said === proof.said ? db.getEvtSerder(proof.pre, said) : null;
    if (!event?.estive) continue;
    const verified = Kever.verifyIndexedSignatures(embedded.raw, proof.sigers, event.verfers);
    for (const siger of verified.sigers) {
      if (groupMemberHasKey(db, member, event.verfers[siger.index].qb64)) {
        return new TransIdxSigGroup(proof.prefixer, event.sner!, proof.diger, [siger]);
      }
    }
  }
  return null;
}
