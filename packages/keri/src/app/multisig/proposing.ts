/**
 * Proposing group key events, owned by the library so that every host runs one
 * implementation. Each call creates this member's local event, hands it to the
 * Counselor, publishes the proposal to the other members and returns without
 * waiting for them; observe progress with `counselor.status(result.event)`.
 *
 * Member add or remove is a rotation with new `smids` / `rmids`. The group's
 * stored members change only once the rotation is accepted, and then follow
 * accepted state with no further call (`Habery.alignGroupMembers`, run by the
 * Counselor's pass), however late the last signature arrives.
 *
 * Dependencies are declared collaborators, not an AgentRuntime (ADR-0013).
 */
import type { SerderACDC } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { RegistryDisclosure } from "../../acdc/regeventing.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Regery } from "../../vdr/credentialing.ts";
import {
  type CredentialRevokeOptions,
  type CredentialRevokeResult,
  revokeCredential,
} from "../credentials/credential-revoking.ts";
import {
  createCredential,
  type CredentialCreateOptions,
  type CredentialRegistryInceptOptions,
  inceptCredentialRegistry,
  type IssueResult,
  type RegistryResult,
} from "../credentials/credential-workflows.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab, Habery, MakeGroupHabArgs } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { CounselInputs, Counselor, GroupEventRef } from "./counseling.ts";
import { groupSigningMembers, localGroupMember, uniqueMembers } from "./group-members.ts";
import { MULTISIG_ICP_ROUTE, MULTISIG_IXN_ROUTE, MULTISIG_ROT_ROUTE } from "./grouping.ts";
import { type GroupSendResult, remoteGroupMembers } from "./multisig-messaging.ts";
import {
  type ApprovalResult,
  approveAcdcV2Registry,
  publishAcdcV2Registry,
  publishProposal,
} from "./multisig-workflows.ts";

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
  // Publishing needs a route to every other member. Refuse before the group habitat exists, so a call that could
  // not be sent leaves nothing behind and the same alias can be used again.
  for (const other of remoteGroupMembers(deps.hby, member, uniqueMembers([...smids, ...rmids]))) {
    if (!deps.postman.canReach(member.pre!, other)) {
      throw new ValidationError(
        `Group member ${other} cannot be reached: no end role is known for it. Resolve its OOBI first.`,
      );
    }
  }
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

/** Collaborators for {@link proposeRegistryEvent}. */
export interface RegistryProposeDeps extends GroupProposeDeps {
  readonly registryStore: RegistryStore | null;
}

/** Outcome of {@link proposeRegistryEvent}. */
export interface RegistryEventResult extends ApprovalResult {
  /** The group anchor that seals the TEL event, now counseled. */
  readonly event: GroupEventRef;
}

/**
 * Propose an ACDC v2 registry event (`rip` or `bup`): author the group anchor
 * that seals it, process this member's own contribution, hand the anchor to the
 * Counselor and publish the proposal. The proposer's contribution is also its
 * approval. Returns without waiting; the anchor's progress is
 * `counselor.status(result.event)`. A `bup` needs its `opening`.
 *
 * @throws ValidationError for a group that is not joined and accepted, or a TEL event the group cannot propose.
 */
export function* proposeRegistryEvent(
  deps: RegistryProposeDeps,
  group: Hab,
  event: SerderACDC,
  opening?: RegistryDisclosure,
  inputs?: CounselInputs,
): Operation<RegistryEventResult> {
  const { hby } = deps;
  const approval = yield* approveAcdcV2Registry(hby, deps.protocol, group, event, { opening, resume: true });
  const anchorSaid = (approval[0].sad?.a as { anc?: string } | undefined)?.anc;
  const anchor = anchorSaid ? hby.db.getEvtSerder(group.pre, anchorSaid) : null;
  if (!anchor || anchor.sn === null) throw new ValidationError("Registry proposal lost its group anchor.");
  const anchorRef = { pre: group.pre, sn: anchor.sn, said: anchor.said! };
  deps.counselor.start(anchorRef, inputs);
  const sent = yield* publishAcdcV2Registry(hby, deps.postman, group, approval);
  const regid = event.ilk === "rip" ? event.said! : event.regid!;
  const accepted = deps.registryStore?.seqEvent(regid, Number(BigInt(`0x${event.sad!.n}`)))?.said === event.said;
  return {
    route: approval[0].route as "/multisig/rip" | "/multisig/bup",
    said: approval[0].said!,
    embedded: event.said!,
    group: group.pre,
    accepted,
    ...sent,
    event: anchorRef,
  };
}

/** Collaborators for proposing a legacy (v1) group registry or credential event. */
export interface CredentialProposeDeps {
  readonly rgy: Regery;
  /** Byte intake that commits each exact local wrapper before it is sent. */
  readonly input: Reactor;
  readonly postman: Poster;
  readonly counselor: Pick<Counselor, "start">;
}

/** A result that is known to carry its group coordination, including the anchor the Counselor tracks. */
type Proposed<T extends { group?: unknown }> = T & { group: NonNullable<T["group"]> };

function proposedGroup<T extends { group?: unknown }>(result: T, what: string): Proposed<T> {
  if (!result.group) throw new ValidationError(`${what} must be proposed by a local group.`);
  return result as Proposed<T>;
}

/**
 * Propose a group's legacy credential registry (`vcp`): author the anchoring group event,
 * process this member's contribution, hand the anchor to the Counselor and publish the
 * proposal. Returns without waiting; the anchor's progress is `counselor.status(result.group.event)`
 * and the registry's is `waitForTelEvent`.
 *
 * @throws ValidationError when `group` is not a local group or the registry name is taken.
 */
export function* proposeCredentialRegistry(
  deps: CredentialProposeDeps,
  group: Hab,
  options: CredentialRegistryInceptOptions,
  inputs?: CounselInputs,
): Operation<Proposed<RegistryResult>> {
  const result = proposedGroup(
    yield* inceptCredentialRegistry(deps.rgy, deps.input, deps.postman, group, options),
    "A group registry",
  );
  deps.counselor.start(result.group.event, inputs);
  return result;
}

/** Propose a group credential issuance (`iss`) the way {@link proposeCredentialRegistry} proposes a registry. */
export function* proposeCredentialIssue(
  deps: CredentialProposeDeps,
  options: CredentialCreateOptions,
  inputs?: CounselInputs,
): Operation<Proposed<IssueResult>> {
  const result = proposedGroup(
    yield* createCredential(deps.rgy, deps.input, deps.postman, options),
    "A group credential",
  );
  deps.counselor.start(result.group.event, inputs);
  return result;
}

/** Propose a group credential revocation (`rev`) the way {@link proposeCredentialRegistry} proposes a registry. */
export function* proposeCredentialRevocation(
  deps: CredentialProposeDeps,
  options: CredentialRevokeOptions,
  inputs?: CounselInputs,
): Operation<Proposed<CredentialRevokeResult>> {
  const result = proposedGroup(
    yield* revokeCredential(deps.rgy, deps.input, deps.postman, options),
    "A group revocation",
  );
  deps.counselor.start(result.group.event, inputs);
  return result;
}
