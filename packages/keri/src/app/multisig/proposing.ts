/**
 * Proposing group key events, owned by the library so that every host runs one
 * implementation. Each call creates this member's local event, hands it to the
 * Counselor, publishes the proposal to the other members and returns without
 * waiting for them; observe progress with `counselor.status(result.event)`.
 *
 * Member add or remove is a rotation with new `smids` / `rmids`. A rotation that
 * changes members commits them only once the rotation is accepted: call
 * {@link settleProposedRotation} when the event reads `complete`; it is
 * idempotent. Joiners commit at approval time (`approveGroupProposal`).
 *
 * Dependencies are declared collaborators, not an AgentRuntime (ADR-0013).
 */
import type { Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab, Habery, MakeGroupHabArgs } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { CounselInputs, Counselor, GroupEventRef } from "./counseling.ts";
import { groupSigningMembers, localGroupMember, uniqueMembers } from "./group-members.ts";
import { MULTISIG_ICP_ROUTE, MULTISIG_IXN_ROUTE, MULTISIG_ROT_ROUTE } from "./grouping.ts";
import type { GroupSendResult } from "./multisig-messaging.ts";
import { commitAcceptedGroupMembers, publishProposal } from "./multisig-workflows.ts";

/** Collaborators for proposing; nothing else is reachable from here. */
export interface GroupProposeDeps {
  readonly hby: Habery;
  readonly protocol: ProtocolProcessor;
  readonly postman: Poster;
  readonly counselor: Pick<Counselor, "start">;
}

/** Outcome of proposing a group event. */
export interface GroupEventResult extends GroupSendResult {
  readonly route: typeof MULTISIG_ICP_ROUTE | typeof MULTISIG_ROT_ROUTE | typeof MULTISIG_IXN_ROUTE;
  readonly group: string;
  /** The counseled event; read progress with `counselor.status`. */
  readonly event: GroupEventRef;
  /** Signing members named by the proposal. */
  readonly smids: readonly string[];
  /** Rotation members named by the proposal. */
  readonly rmids: readonly string[];
}

/** Inception choices. */
export type GroupInceptionSpec = MakeGroupHabArgs & {
  smids: readonly string[];
  rmids?: readonly string[];
};

/** Rotation choices; omitted members keep the group's current ones. */
export interface GroupRotationSpec {
  smids?: readonly string[];
  rmids?: readonly string[];
  isith?: MakeGroupHabArgs["isith"];
  nsith?: MakeGroupHabArgs["nsith"];
  toad?: number;
  cuts?: string[];
  adds?: string[];
  data?: unknown[];
  version?: MakeGroupHabArgs["version"];
}

/** Propose a new group: create this member's inception and publish it. */
export function* proposeGroupInception(
  deps: GroupProposeDeps,
  member: Hab,
  alias: string,
  { smids, rmids = smids, ...args }: GroupInceptionSpec,
  inputs?: CounselInputs,
): Operation<GroupEventResult> {
  const created = deps.hby.makeGroupHab(alias, member, [...smids], [...rmids], undefined, args);
  const event = { pre: created.hab.pre, sn: created.serder.sn ?? 0, said: created.serder.said! };
  deps.counselor.start(event, inputs);
  const sent = yield* publishProposal(
    deps.hby,
    deps.protocol,
    deps.postman,
    member,
    uniqueMembers([...smids, ...rmids]),
    {
      route: MULTISIG_ICP_ROUTE,
      attrs: { smids: [...smids], rmids: [...rmids], ...(args.delpre ? { delegator: args.delpre } : {}) },
    },
    created.message,
  );
  return { ...sent, route: MULTISIG_ICP_ROUTE, group: created.hab.pre, event, smids, rmids };
}

/** Propose a group rotation, including member add or remove through new `smids` / `rmids`. */
export function* proposeGroupRotation(
  deps: GroupProposeDeps,
  group: Hab,
  { smids: newSmids, rmids: newRmids, ...args }: GroupRotationSpec = {},
  inputs?: CounselInputs,
): Operation<GroupEventResult> {
  const { hby } = deps;
  const rotated = hby.rotateGroupHab(
    group.name,
    newSmids && [...newSmids],
    newRmids && [...newRmids],
    args,
  );
  const smids = newSmids?.length ? newSmids : groupSigningMembers(hby, rotated.hab.pre);
  const rmids = newRmids?.length ? newRmids : smids;
  const event = { pre: rotated.hab.pre, sn: rotated.serder.sn!, said: rotated.serder.said! };
  deps.counselor.start(event, inputs);
  const sent = yield* publishProposal(
    hby,
    deps.protocol,
    deps.postman,
    localGroupMember(hby, rotated.hab.pre),
    uniqueMembers([...smids, ...rmids]),
    { route: MULTISIG_ROT_ROUTE, attrs: { gid: rotated.hab.pre, smids: [...smids], rmids: [...rmids] } },
    rotated.message,
  );
  return { ...sent, route: MULTISIG_ROT_ROUTE, group: rotated.hab.pre, event, smids, rmids };
}

/** Propose a group interaction event carrying `data`. */
export function* proposeGroupInteraction(
  deps: GroupProposeDeps,
  group: Hab,
  data: unknown[],
  inputs?: CounselInputs,
  version?: MakeGroupHabArgs["version"],
): Operation<GroupEventResult> {
  const { hby } = deps;
  const created = hby.interactGroupHab(group.name, undefined, { data, version });
  const smids = groupSigningMembers(hby, created.hab.pre);
  const event = { pre: created.hab.pre, sn: created.serder.sn!, said: created.serder.said! };
  deps.counselor.start(event, inputs);
  const sent = yield* publishProposal(
    hby,
    deps.protocol,
    deps.postman,
    localGroupMember(hby, created.hab.pre),
    smids,
    { route: MULTISIG_IXN_ROUTE, attrs: { gid: created.hab.pre, smids } },
    created.message,
  );
  return { ...sent, route: MULTISIG_IXN_ROUTE, group: created.hab.pre, event, smids, rmids: [] };
}

/**
 * Commit the members a proposed rotation named, once the rotation is accepted and
 * is the group's latest establishment event. Idempotent; false until then, so a
 * proposed newcomer is never adopted early. Other event kinds commit nothing.
 *
 * @throws ValidationError when the event is not an accepted event body held locally.
 */
export function settleProposedRotation(deps: Pick<GroupProposeDeps, "hby">, result: GroupEventResult): boolean {
  if (result.route !== MULTISIG_ROT_ROUTE) return false;
  const serder = deps.hby.db.getEvtSerder(result.event.pre, result.event.said);
  if (!serder) throw new ValidationError(`No rotation ${result.event.said} is held for ${result.event.pre}.`);
  return commitAcceptedGroupMembers(deps.hby, serder, result.smids, result.rmids);
}
