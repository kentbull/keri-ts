/** Group key selection and signature construction, independent of reply application policy. */
import { Diger, Ilks, SerderKERI, Siger, type Versionage } from "cesr-ts";
import { ValidationError } from "../../core/errors.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import type { Habery } from "../identity/habbing.ts";
import { groupSigningMembers } from "./group-members.ts";

/** Endorse one reply with locally available group member signatures. */
export function groupEndorseReply(
  hby: Habery,
  groupPre: string,
  serder: SerderKERI,
  gvrsn?: Versionage,
): Uint8Array {
  const keys = groupEventKeys(hby, groupPre, serder);
  const sigers = signLocalGroupEvent(hby, serder, groupSigningMembers(hby, groupPre), keys);
  const kever = hby.db.getKever(groupPre);
  const estSaid = kever?.lastEst.d || kever?.said;
  const estEvent = estSaid ? hby.db.getEvtSerder(groupPre, estSaid) : null;
  const seqner = estEvent?.sner;
  if (!kever || !estSaid || !seqner) {
    throw new ValidationError(`Missing group establishment state for ${groupPre}.`);
  }
  return messagize(serder, {
    sigers,
    seal: { i: kever.prefixer, s: seqner, d: new Diger({ qb64: estSaid }) },
    pipelined: true,
    gvrsn,
  });
}

/**
 * Resolve the public keys that should sign one group event or reply.
 *
 * Inception/rotation-style events carry their signing keys in the event body;
 * reply endorsements use the currently accepted group key state.
 */
export function groupEventKeys(
  hby: Habery,
  groupPre: string,
  serder: SerderKERI,
): string[] {
  if (
    serder.ilk === Ilks.icp
    || serder.ilk === Ilks.dip
    || serder.ilk === Ilks.rot
    || serder.ilk === Ilks.drt
  ) {
    return serder.verfers.map((verfer) => verfer.qb64);
  }
  const kever = hby.db.getKever(groupPre);
  if (!kever) {
    throw new ValidationError(
      `Group ${groupPre} must be accepted before endorsing endpoint role proposals.`,
    );
  }
  return kever.verfers.map((verfer) => verfer.qb64);
}

/**
 * Sign a group event with every locally available member key in signing-index
 * order.
 */
export function signLocalGroupEvent(
  hby: Habery,
  serder: SerderKERI,
  smids: readonly string[],
  keys: readonly string[],
): Siger[] {
  const sigers: Siger[] = [];
  for (const [index, mid] of smids.entries()) {
    const member = hby.habs.get(mid);
    const key = keys[index];
    if (!member || !key) {
      continue;
    }
    sigers.push(
      ...(member.mgr.sign(serder.raw, {
        pubs: [key],
        indexed: true,
        indices: [index],
      }) as Siger[]),
    );
  }
  if (sigers.length === 0) {
    throw new ValidationError("No local member key can sign this group event.");
  }
  return sigers;
}
