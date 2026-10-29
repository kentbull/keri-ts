import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { exchange } from "../../core/exchange/protocol-exchanging.ts";
import { reply as replyEvent } from "../../core/protocol-eventing.ts";
import { Roles } from "../../core/roles.ts";
import type { Poster } from "../delivery/forwarding.ts";
import { groupSigningMembers, localGroupMember } from "../multisig/group-members.ts";
import { groupEndorseReply } from "../multisig/group-signing.ts";
import { MULTISIG_RPY_ROUTE } from "../multisig/grouping.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { Reactor } from "../protocol/reactor.ts";
import type { Hab, Habery } from "./habbing.ts";

import {
  admitAndSendGroupMessage,
  type GroupDelivery,
  type GroupSendResult,
  groupSendResult,
  remoteGroupMembers,
  signGroupMessage,
} from "../multisig/multisig-messaging.ts";

/**
 * One group endpoint-role proposal: coordination send facts plus the current
 * accepted authorization predicate. The signed rpy bytes are library evidence;
 * Tufa's output adapter deliberately omits them from its JSON summary.
 */
export interface GroupRoleResult extends GroupSendResult {
  route: typeof MULTISIG_RPY_ROUTE;
  group: string;
  /** Current Baser.ends authorization, not proof that other participants approved. */
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
