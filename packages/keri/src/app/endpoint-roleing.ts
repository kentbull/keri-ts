import { Diger, Ilks, SerderKERI, Siger, type Versionage } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { reply as replyEvent } from "../core/protocol-eventing.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { Roles } from "../core/roles.ts";
import type { Poster } from "./forwarding.ts";
import { groupSigningMembers, localGroupMember } from "./group-members.ts";
import { MULTISIG_RPY_ROUTE } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import { Reactor } from "./reactor.ts";

import {
  admitAndSendGroupMessage,
  type GroupDelivery,
  type GroupSendResult,
  groupSendResult,
  remoteGroupMembers,
  signGroupMessage,
} from "./multisig-messaging.ts";

export { groupSigningMembers, isLocalGroupHab, localGroupMember } from "./group-members.ts";

/** Result of proposing one group endpoint-role authorization reply. */
export interface GroupRoleResult extends GroupSendResult {
  route: typeof MULTISIG_RPY_ROUTE;
  group: string;
  accepted: boolean;
  rpy: Uint8Array;
}

/** Return whether endpoint-role state currently authorizes `eid` for `cid`. */
export function endpointRoleAccepted(
  hby: Habery,
  cid: string,
  role: string,
  eid: string,
): boolean {
  return hby.db.ends.get([cid, role, eid])?.allowed === true;
}

/** Load an accepted endpoint-role reply or throw a command-facing error. */
export function loadAcceptedEndpointRole(
  hab: Hab,
  eid: string,
  role: string = Roles.controller,
): Uint8Array {
  const rpy = hab.loadEndRole(hab.pre, eid, role);
  if (rpy.length === 0) {
    throw new ValidationError(
      `No accepted endpoint role ${role} reply is available for ${hab.pre} -> ${eid}.`,
    );
  }
  return rpy;
}

/**
 * Propose one group endpoint-role reply under `/multisig/rpy`.
 *
 * @param hby Borrowed identities and accepted group state.
 * @param protocol Shared semantic owner; the proposal owns its local byte-input context.
 * @param postman Borrowed delivery owner; the caller runs and joins its worker.
 * @param groupHab Local group habitat whose endpoint-role reply needs member approvals.
 * @param args Endpoint AID, role and allow/cut decision used to construct the signed proposal.
 * @returns Proposal identifiers, current acceptance and actual delivery URLs.
 */
export function* proposeGroupEndpointRole(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  groupHab: Hab,
  args: {
    eid: string;
    role?: string;
    allow?: boolean;
  },
): Operation<GroupRoleResult> {
  const role = args.role ?? Roles.mailbox;
  const input = new Reactor(protocol);
  if (input.kvy.db !== hby.db) throw new TypeError("Endpoint-role proposal must use the same accepted-state store");
  const member = localGroupMember(hby, groupHab.pre);
  const rpySerder = replyEvent(
    args.allow === false ? "/end/role/cut" : "/end/role/add",
    { cid: groupHab.pre, role, eid: args.eid },
    { pre: groupHab.pre },
  );
  const localRpy = groupEndorseReply(hby, groupHab.pre, rpySerder);
  yield* input.processBytes(localRpy, { local: true });
  yield* protocol.processEscrowsOnce();

  const outcomes: GroupDelivery[] = [];
  for (const recipient of remoteGroupMembers(hby, member, groupSigningMembers(hby, groupHab.pre))) {
    const [serder, attachments] = exchange(MULTISIG_RPY_ROUTE, { gid: groupHab.pre }, {
      sender: member.pre,
      recipient,
      embeds: { rpy: localRpy },
    });
    const prepared = signGroupMessage(member, recipient, [serder, attachments]);
    outcomes.push(yield* admitAndSendGroupMessage(input, postman, prepared));
  }

  return {
    route: MULTISIG_RPY_ROUTE,
    ...groupSendResult(outcomes),
    group: groupHab.pre,
    accepted: endpointRoleAccepted(hby, groupHab.pre, role, args.eid),
    rpy: localRpy,
  };
}

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
