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

/**
 * Return the current signing member elected by `coordinator`, as KERIpy
 * `GroupHab.elected`: the member whose latest contribution to the coordinator's
 * establishment keys holds the lowest verified signing index. Null when the
 * event has no election or that contributor is no longer a current signing
 * member. The result depends on locally stored signatures, so it suits
 * idempotent duties only; frozen operations recheck their earlier choice instead.
 */
export function groupElectedMember(hby: Habery, group: string, coordinator: GroupCoordinator): string | null {
  const selection = groupWitnesserSelection(hby.db, group, coordinator);
  if (!selection) return null;
  return groupSigningMembers(hby, group).find(member =>
    latestGroupContribution(hby.db, member, selection.establishment.verfers)?.index === selection.index
  ) ?? null;
}

/**
 * True when the local member is the witnesser for the exact accepted group event
 * `coordinator`, as KERIpy `_groupWitnesser`: the member's latest contribution to
 * the governing establishment's keys holds the lowest verified signing index.
 *
 * Unlike `groupElectedMember` this does not require that member to be a current
 * signing member, so a historical event keeps its witnesser after a later
 * rotation. Like it, the answer depends on locally stored signatures and suits
 * idempotent duties only.
 */
export function groupWitnesser(hby: Habery, group: string, coordinator: GroupCoordinator): boolean {
  const selection = groupWitnesserSelection(hby.db, group, coordinator);
  if (!selection) return false;
  const member = localGroupMember(hby, group).pre;
  const contribution = member ? latestGroupContribution(hby.db, member, selection.establishment.verfers) : null;
  return contribution?.index === selection.index;
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
 * True when `aid` is a signing or rotation member of `group`'s latest accepted establishment event: one of its
 * establishment events supplied a key in that event's key list or committed to a digest in its next list.
 * Decided from accepted key state only. False when the group has no accepted state.
 */
export function isAcceptedGroupMember(db: Baser, group: string, aid: string): boolean {
  const kever = db.getKever(group);
  const event = kever ? db.getEvtSerder(group, kever.lastEst.d) : null;
  if (!event) return false;
  const keys = new Set((event.verfers ?? []).map(verfer => verfer.qb64));
  const digs = new Set((event.ndigers ?? []).map(diger => diger.qb64));
  for (const [, said] of db.getKelItemIter(aid)) {
    const member = db.getEvtSerder(aid, said);
    if (!member?.estive) continue;
    if (
      (member.verfers ?? []).some(verfer => keys.has(verfer.qb64))
      || (member.ndigers ?? []).some(diger => digs.has(diger.qb64))
    ) return true;
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

/** Members of a group's latest accepted establishment event, ordered by key index. */
export interface AcceptedGroupMembers {
  event: SerderKERI;
  smids: string[];
  rmids: string[];
}

/**
 * Derive the members of `group`'s latest accepted establishment event from
 * local KELs, as KERIpy `GroupHab.acceptedMembers`.
 *
 * Each signing key is attributed to the candidate whose latest contributing
 * establishment event supplied it, and each next-key digest to the candidate
 * whose establishment event committed to it. Returns null when the event is
 * missing or any key cannot be attributed to exactly one candidate.
 */
export function acceptedGroupMembers(
  db: Baser,
  group: string,
  candidates: Iterable<string>,
): AcceptedGroupMembers | null {
  const kever = db.getKever(group);
  const event = kever ? db.getEvtSerder(group, kever.lastEst.d) : null;
  if (!event) return null;
  const keys = (event.verfers ?? []).map(verfer => verfer.qb64);
  const digs = (event.ndigers ?? []).map(diger => diger.qb64);
  const signing = new Map<number, string>(), rotating = new Map<number, string>();
  const attribute = (found: Map<number, string>, index: number, aid: string) =>
    (found.get(index) ?? aid) === aid && !!found.set(index, aid);
  for (const aid of candidates) {
    const state = aid === group ? null : db.getKever(aid);
    if (!state) continue;
    let signed = false;
    for (const [, sn, said] of db.kels.getOnItemBackIter(aid, state.lastEst.s)) {
      if (db.kels.getLast(aid, sn) !== said) continue;
      const member = db.getEvtSerder(aid, said);
      if (!member?.estive) continue;
      // KERIpy fetchLatestContribTo: only the latest contributing establishment counts.
      const index = signed
        ? -1
        : (member.verfers ?? []).map(verfer => keys.indexOf(verfer.qb64)).find(i => i >= 0) ?? -1;
      if (index >= 0) {
        signed = true;
        if (!attribute(signing, index, aid)) return null;
      }
      for (const diger of member.ndigers ?? []) {
        const next = digs.indexOf(diger.qb64);
        if (next >= 0 && !attribute(rotating, next, aid)) return null;
      }
    }
  }
  if (signing.size !== keys.length || rotating.size !== digs.length) return null;
  return {
    event,
    smids: keys.map((_, index) => signing.get(index)!),
    rmids: digs.map((_, index) => rotating.get(index)!),
  };
}
