import { type Operation } from "npm:effection@^3.6.0";
import { Diger, Ilks, SerderKERI, Siger } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { reply as replyEvent } from "../core/protocol-eventing.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { Roles } from "../core/roles.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { MULTISIG_RPY_ROUTE, multisigRpyExn } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";

const MULTISIG_TOPIC = "multisig";

/** Result of proposing one group endpoint-role authorization reply. */
export interface GroupEndpointRoleProposalResult {
  route: typeof MULTISIG_RPY_ROUTE;
  said: string | undefined;
  group: string;
  accepted: boolean;
  deliveries: string[];
  attachmentBytes: number;
  rpy: Uint8Array;
}

/** True when the selected habitat is a local group habitat. */
export function isLocalGroupHab(hby: Habery, hab: Hab): boolean {
  return !!hab.pre && !!hby.db.getHab(hab.pre)?.mid;
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

/** Propose one group endpoint-role reply under `/multisig/rpy`. */
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
  runtime.reactor.processChunk(localRpy, { local: true });
  runtime.reactor.processEscrowsOnce();

  const [exn, attachments] = multisigRpyExn(groupHab, member, localRpy);
  const deliveries = yield* publishEndpointRoleProposal(
    runtime,
    member,
    groupSigningMembers(runtime.hby, groupHab.pre),
    { gid: groupHab.pre },
    { rpy: localRpy },
  );

  return {
    route: MULTISIG_RPY_ROUTE,
    said: exn.said ?? undefined,
    group: groupHab.pre,
    accepted: endpointRoleAccepted(runtime.hby, groupHab.pre, role, args.eid),
    deliveries,
    attachmentBytes: attachments.length,
    rpy: localRpy,
  };
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

/** Endorse one reply with locally available group member signatures. */
export function groupEndorseReply(
  hby: Habery,
  groupPre: string,
  serder: SerderKERI,
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
  });
}

function* publishEndpointRoleProposal(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  payload: Record<string, unknown>,
  embeds: Record<string, Uint8Array>,
): Operation<string[]> {
  const deliveries: string[] = [];
  for (const recipient of uniqueMembers(recipients)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const result = yield* runtime.poster.sendExchange(member, {
      recipient,
      route: MULTISIG_RPY_ROUTE,
      payload,
      embeds,
      topic: MULTISIG_TOPIC,
    });
    deliveries.push(...result.deliveries, ...result.queued);
  }
  return deliveries;
}

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

function uniqueMembers(members: readonly string[]): string[] {
  return [...new Set(members.filter((member) => member.length > 0))];
}
