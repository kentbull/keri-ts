import { concatBytes, Diger, Ilks, SerderKERI, Siger, type Versionage } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { reply as replyEvent } from "../core/protocol-eventing.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { Roles } from "../core/roles.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { groupSigningMembers, localGroupMember, uniqueMembers } from "./group-members.ts";
import { MULTISIG_RPY_ROUTE } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";

const MULTISIG_TOPIC = "multisig";

export { groupSigningMembers, isLocalGroupHab, localGroupMember } from "./group-members.ts";

/** Result of proposing one group endpoint-role authorization reply. */
export interface GroupEndpointRoleProposalResult {
  route: typeof MULTISIG_RPY_ROUTE;
  proposals: { recipient: string; said: string }[];
  group: string;
  accepted: boolean;
  deliveries: string[];
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
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param groupHab Local group habitat whose endpoint-role reply needs member approvals.
 * @param args Endpoint AID, role and allow/cut decision used to construct the signed proposal.
 * @returns Proposal identifiers, current acceptance and actual delivery URLs.
 */
export function* proposeGroupEndpointRole(
  runtime: AgentRuntime,
  groupHab: Hab,
  args: {
    eid: string;
    role?: string;
    allow?: boolean;
  },
): Operation<GroupEndpointRoleProposalResult> {
  const role = args.role ?? Roles.mailbox;
  const member = localGroupMember(runtime.hby, groupHab.pre);
  const rpySerder = replyEvent(
    args.allow === false ? "/end/role/cut" : "/end/role/add",
    { cid: groupHab.pre, role, eid: args.eid },
    { pre: groupHab.pre },
  );
  const localRpy = groupEndorseReply(runtime.hby, groupHab.pre, rpySerder);
  yield* runtime.reactor.processBytes(localRpy, { local: true });
  yield* runtime.protocol.processEscrowsOnce();

  const proposals: GroupEndpointRoleProposalResult["proposals"] = [];
  const deliveries: string[] = [];
  for (const recipient of uniqueMembers(groupSigningMembers(runtime.hby, groupHab.pre))) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const [serder, attachments] = exchange(MULTISIG_RPY_ROUTE, { gid: groupHab.pre }, {
      sender: member.pre,
      recipient,
      embeds: { rpy: localRpy },
    });
    const message = concatBytes(member.endorse(serder, { pipelined: false }), attachments);
    yield* runtime.reactor.processBytes(message, { local: true });
    const postman = runtime.postman;
    const evt = postman.send({
      src: member.pre,
      dest: recipient,
      msg: message,
      topic: MULTISIG_TOPIC,
    }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    proposals.push({ recipient, said: serder.said! });
    deliveries.push(...outcome.deliveries);
  }

  return {
    route: MULTISIG_RPY_ROUTE,
    proposals,
    group: groupHab.pre,
    accepted: endpointRoleAccepted(runtime.hby, groupHab.pre, role, args.eid),
    deliveries,
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
