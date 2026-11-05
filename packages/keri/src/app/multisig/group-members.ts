import type { SerderKERI, Verfer } from "cesr-ts";
import { TransIdxSigGroup } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import { Kever } from "../../core/kel/kever.ts";
import type { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
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

/** Find the member's latest accepted single-key contribution to the supplied group keys. */
export function latestGroupContribution(
  db: Baser,
  member: string,
  verfers: readonly Verfer[],
): { event: SerderKERI; index: number; verfer: Verfer } | null {
  const state = db.getKever(member);
  if (!state) return null;
  const pubs = verfers.map(verfer => verfer.qb64);
  for (const [, sn, said] of db.kels.getOnItemBackIter(member, state.sn)) {
    if (db.kels.getLast(member, sn) !== said) continue;
    const event = db.getEvtSerder(member, said);
    if (!event) throw new ValidationError(`Missing accepted member event ${member}:${said}.`);
    if (!event.estive) continue;
    const keys = event.verfers ?? [];
    if (keys.length !== 1) throw new ValidationError(`Group signing requires single-key member events for ${member}.`);
    const index = pubs.indexOf(keys[0].qb64);
    if (index >= 0) return { event, index, verfer: keys[0] };
  }
  return null;
}

/** Exact accepted group event that supplies the ordinary witnesser election. */
export interface GroupCoordinator {
  sn: number;
  said: string;
}

/**
 * Verify an accepted coordinator against its historical establishment threshold.
 * index is the initial election; a frozen operation rechecks indices without
 * replacing its earlier choice when more valid signatures arrive.
 */
export function groupWitnesserSelection(
  db: Baser,
  group: string,
  { sn, said }: GroupCoordinator,
): { establishment: SerderKERI; index: number; indices: number[] } | null {
  if (!Number.isSafeInteger(sn) || sn < 0 || db.kels.getLast(group, sn) !== said) return null;
  const event = db.getEvtSerder(group, said);
  if (!event || event.pre !== group || event.sn !== sn || event.said !== said) return null;
  for (const [, ordinal, digest] of db.kels.getOnItemBackIter(group, sn)) {
    if (db.kels.getLast(group, ordinal) !== digest) continue;
    const establishment = db.getEvtSerder(group, digest);
    if (!establishment) throw new ValidationError(`Missing accepted group event ${group}:${digest}.`);
    if (!establishment.estive) continue;
    const { indices } = Kever.verifyIndexedSignatures(
      event.raw,
      db.sigs.get(dgKey(group, said)),
      establishment.verfers,
    );
    if (!indices.length || !establishment.tholder?.satisfy(indices)) return null;
    return { establishment, index: Math.min(...indices), indices };
  }
  return null;
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
