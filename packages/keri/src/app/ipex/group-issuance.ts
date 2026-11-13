/**
 * Group DH issuance steps for the runtime's `IssuanceOperations` owner.
 *
 * A local group issues (or receives) a v2 DH credential through the same live table, status read and wait as an
 * individual. This module holds what is specific to a group: the explicit consent calls, the per-operation
 * state machine that `IssuanceOperations.processOnce` advances, and the child handler that lets the
 * `/multisig/qry` and `/multisig/rpy` wrappers of DH reach it.
 *
 * Consent (the only calls that sign, each returning after local commit without waiting on a member):
 *
 * | who                           | call                                      | what it signs                                       |
 * | ----------------------------- | ----------------------------------------- | --------------------------------------------------- |
 * | issuer custodian, prepare     | {@link prepareGroupIssuance}              | the custodian's contribution to a fresh Grant       |
 * | issuer custodian, one consent | {@link proposeGroupIssuance}              | prepare, then approve its own proposal              |
 * | issuer member                 | {@link approveGroupIssuance}              | this member's Grant contribution, and consent to its later DH query contribution |
 * | holder custodian or member    | {@link approveGroupIssuanceExchange}      | consent to DH (contributions follow as they arrive) |
 * | a member that only follows    | {@link followGroupIssuanceProof}          | nothing; verifies the custodian's final proof       |
 *
 * The registry update is a separate consent: the custodian proposes the BUP through `proposeRegistryEvent`
 * (its own contribution is its approval) and every other issuer member approves that proposal with
 * `approveGroupProposal`. Admit is a separate consent as well.
 *
 * Automatic, inside `processOnce`: sending a member's own proposal, authenticating the Grant, approving DH once
 * the Grant is authenticated, the custodian's evidence, query and reply traffic, wrapper intake, finishing the
 * Grant and the proof broadcast to the other members. Root copies are not sent here: the DH completion cue
 * feeds the runtime's `RootReplicator`, which sends exactly one copy per member.
 *
 * Reload: nothing about a group operation is durable but the protocol stores. A member that reloads reads
 * `awaitingExchangeConsent` for a pending Grant it holds no root for and consents again with the same call;
 * its signatures are deterministic, so consenting twice produces the same bytes. A custodian that reloaded
 * after retaining its root resumes when the stores allow it ({@link deriveGroupCustody}).
 */
import {
  bytesEqual,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  parseBytes,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../acdc/authoring.ts";
import { RegistryCustody } from "../../acdc/custody.ts";
import { Dhke, grantTransactionId } from "../../acdc/dhking.ts";
import { vet } from "../../acdc/regeventing.ts";
import { RegistryRoot } from "../../acdc/salting.ts";
import { ValidationError } from "../../core/errors.ts";
import { Kever } from "../../core/kel/kever.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import { timestampMicros } from "../../time/mod.ts";
import {
  type RegistryEventRef,
  registryEventRef,
  registryEventStatus,
  settleRegistryEvent,
} from "../credentials/registry-settling.ts";
import type { Exchanger, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { CounselInputs } from "../multisig/counseling.ts";
import {
  type GroupCoordinator,
  groupElectedMember,
  groupSigningMembers,
  isLocalGroupHab,
  latestGroupContribution,
  localGroupMember,
} from "../multisig/group-members.ts";
import {
  type Multiplexor,
  MULTISIG_EXN_ROUTE,
  MULTISIG_IPEX_PROOF_ROUTE,
  MULTISIG_QRY_ROUTE,
  MULTISIG_RPY_ROUTE,
  type MultisigChildRoute,
  multisigExnBody,
} from "../multisig/grouping.ts";
import { proposeRegistryEvent, type RegistryProposeDeps } from "../multisig/proposing.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import { exchangeWire, type IssuanceGrantOptions } from "./ipex-discloser.ts";
import { acceptedRegistryEvidence, isIssuanceOrigin } from "./ipex-node-authentication.ts";
import {
  type GrantDraft,
  ISSUANCE_QUERY_RESEND_MS,
  type IssuanceBegun,
  type IssuanceDeps,
  type IssuanceOperations,
  type IssuanceRole,
  type LiveIssuance,
} from "./issuance.ts";

/** Milliseconds between scans of the stored wrappers for the final proof. */
const PROOF_SCAN_MS = 1000;
/** How many of the group's latest accepted events {@link deriveGroupCustody} considers as coordinators. */
const GROUP_COORDINATOR_SEARCH = 16;
const ALLOWED_CHILD_FACTORS = ["TransIdxSigGroups", "TransLastIdxSigGroups", "ControllerIdxSigs"];

/** One DH child route and the handler that delegates its wrappers to this owner. */
export type GroupRouteBinding = [route: string, handler: ExchangeRouteHandler];

/** Collaborators only a group needs; an owner without them issues as an individual alone. */
export interface GroupIssuanceDeps {
  /** Where the DH child wrappers (`/multisig/qry`, `/multisig/rpy`) are delegated; one owner per runtime registers. */
  readonly mux: Pick<Multiplexor, "addChildHandler" | "removeChildHandler">;
  /** Collaborators of the custodian's registry update proposal. */
  readonly registry: RegistryProposeDeps;
}

/** A prepared Grant and the proposal the other issuer members consent to. */
export interface PreparedGroupGrant {
  grant: string;
  proposal: Uint8Array;
}

/** The custodian a group's accepted coordinator elects, and whether the local member is it. */
export interface GroupElection {
  coordinator: GroupCoordinator;
  /** AID of the elected member that generates and retains the DH keys. */
  custodian: string;
  lead: boolean;
}

/** Choices of a group member's consent to a Grant. */
export interface GroupConsentOptions {
  /** SAID of the accepted group event whose threshold evidence elects the custodian; default the latest establishment. */
  coordinator?: string;
  /** Witness codes and counseling choices for the registry update's anchor; the CLI passes `fallbackAfterMs: 0`. */
  anchor?: CounselInputs;
}

/** Choices of an issuer member's approval of a stored or supplied Grant proposal. */
export interface GroupApprovalOptions extends GroupConsentOptions {
  /** The proposal as bytes; omitted: the stored proposal wrapper. */
  proposal?: Uint8Array;
}

/** Choices of following a group issuance to its final proof. */
export interface GroupFollowOptions {
  coordinator?: string;
  /** The custodian's final proof as bytes; omitted: the proof wrapper the mailbox stored. */
  proof?: Uint8Array;
}

/** A stored Grant proposal a member may consent to. */
export interface GroupIssuanceProposal {
  /** SAID of the Grant to pass to {@link approveGroupIssuance}. */
  grant: string;
  /** SAID of the `/multisig/exn` wrapper that carries it. */
  wrapper: string;
  /** The group that issues. */
  group: string;
  /** AID of the member that proposed it. */
  proposer: string;
  recipient: string;
  /** True once this member's runtime holds the accepted Grant, so nothing is left to consent to. */
  complete: boolean;
}

/**
 * The local member of a group as one party to a group issuance: the group, the member that signs for it, and the
 * custodian its accepted coordinator elects. Resolving checks everything a consent relies on once, so no later step
 * re-derives it. Not exported from the runtime barrel.
 */
export class GroupParty {
  private constructor(
    readonly hby: Habery,
    readonly group: Hab,
    readonly member: Hab,
    readonly coordinator: GroupCoordinator,
    readonly custodian: string,
  ) {}

  /**
   * The party of `group` under `coordinator` (default the group's latest establishment event).
   *
   * @throws ValidationError for an owner composed without group collaborators, an identifier that is not a local
   * group, or a coordinator that is not an accepted event electing a current signing member.
   */
  static resolve(deps: IssuanceDeps, group: Hab, coordinator?: string): GroupParty {
    if (!deps.group) throw new ValidationError("This issuance owner was composed without group collaborators");
    const { hby } = deps;
    if (!isLocalGroupHab(hby, group)) throw new ValidationError("Group issuance requires a local group identifier");
    const member = localGroupMember(hby, group.pre!);
    const said = coordinator ?? group.kever!.lastEst.d;
    const event = group.db.getEvtSerder(group.pre, said);
    const accepted = event ? { sn: event.sn!, said: event.said! } : null;
    const custodian = accepted ? groupElectedMember(hby, group.pre!, accepted) : null;
    if (!accepted || !custodian || !latestGroupContribution(group.db, member.pre!, group.kever!.verfers)) {
      throw new ValidationError("The coordinator is not an accepted group event electing a current signing member");
    }
    return new GroupParty(hby, group, member, accepted, custodian);
  }

  /** Whether the local member is the elected custodian. */
  get lead(): boolean {
    return this.member.pre === this.custodian;
  }

  /** The other current signing members of the group. */
  others(): string[] {
    return groupSigningMembers(this.hby, this.group.pre!).filter((peer) => peer !== this.member.pre);
  }

  /** The election this party stands for. */
  election(): GroupElection {
    return { coordinator: this.coordinator, custodian: this.custodian, lead: this.lead };
  }

  /** Wrap `child` for the other members; the parent authenticates one exact child and never supplies its threshold. */
  *wrap(child: CesrFrame, route: MultisigChildRoute): Operation<Uint8Array> {
    const body = multisigExnBody(
      this.member.pre!,
      { route, attrs: { gid: this.group.pre! } },
      child.body as SerderKERI,
      {
        version: Vrsn_2_0,
      },
    );
    const frame = parseBytes(this.member.endorse(body, { gvrsn: Vrsn_2_0 }))[0];
    frame.nests = [child];
    return yield* wire(frame);
  }
}

/** The local group `pre` names; a Grant's sender or recipient must be one for a group issuance. */
function localGroup(deps: IssuanceDeps, pre: unknown): Hab {
  const group = typeof pre === "string" ? deps.hby.habs.get(pre) : undefined;
  if (!group || !isLocalGroupHab(deps.hby, group)) {
    throw new ValidationError("The Grant is not sent or received by a local group identifier");
  }
  return group;
}

/**
 * Pure read of a group's election under `coordinator` (default its latest establishment event): who is the
 * custodian and whether the local member is it.
 *
 * @throws ValidationError as {@link GroupParty.resolve}.
 */
export function groupIssuanceElection(ops: IssuanceOperations, group: string, coordinator?: string): GroupElection {
  return GroupParty.resolve(ops.deps, localGroup(ops.deps, group), coordinator).election();
}

function* wire(frame: CesrFrame): Operation<Uint8Array> {
  return yield* call(() => collectPayload(framePayload(frame)));
}

/** Concatenate frames as one nested node stream, the input of proof support. */
function* nodeStream(nodes: readonly CesrFrame[]): Operation<Uint8Array> {
  return concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all(nodes.map((node) => collectPayload(framePayload(node))))),
  );
}

/** Replay accepted wrapper or completed Grant bytes through the exchanger's exact evidence serializer. */
function* storedBytes(exc: Exchanger, said: string): Operation<Uint8Array> {
  const chunks: Uint8Array[] = [];
  yield* call(async () => {
    for await (const chunk of exc.replay(said)) chunks.push(chunk);
  });
  return concatBytes(...chunks);
}

/** Local consent starts the original Exchanger deadline even while the group signature remains partial. */
function* retainLocalGrant(exc: Exchanger, child: CesrFrame): Operation<void> {
  const proof = envelopeFromFrame(child);
  yield* exc.processEvent({
    serder: child.body as SerderKERI,
    tsgs: proof.tsgs,
    lsgs: proof.ssgs,
    cigars: proof.cigars,
    nests: child.nests,
    gvrsn: Vrsn_2_0,
  });
}

/** What deriving a custodian reads: the identities and the retained Grant. */
export interface CustodyDeps {
  hby: Habery;
  exc: Exchanger;
}

/**
 * The party a restarted group custodian was frozen with, derived from the stores. The local member is the
 * custodian when it holds the root of every registry the Grant discloses and received none of them as a copy: a
 * root reaches a non-custodian only as a stored `/registry/root` exchange addressed to it, so that exchange tells
 * a member that was sent its copy from the member whose own DH exchange retained the root. The coordinator is the
 * latest accepted group event whose threshold evidence elects that member; DH only checks that the frozen
 * coordinator still elects the frozen custodian, so any such event serves. Null when the member received a copy
 * of a disclosed root, holds none, or no accepted event elects it.
 */
export function deriveGroupCustody(deps: CustodyDeps, hab: Hab, grant: string): GroupElection | null {
  const { hby } = deps;
  if (!isLocalGroupHab(hby, hab) || !hab.kever) return null;
  const member = localGroupMember(hby, hab.pre!);
  const registries = new Set<string>();
  for (const nest of deps.exc.retainedInput(grant)?.nests ?? []) {
    const rd = nest.body.ked?.rd;
    if (typeof rd === "string") registries.add(rd);
  }
  if (!registries.size || [...registries].some((registry) => !hab.mgr.hasRegistryRoot(hab.pre!, registry))) {
    return null;
  }
  if (receivedRootCopy(hby, hab.pre!, member.pre!, registries)) return null;
  const events = [...hby.db.getKelItemIter(hab.pre!)].slice(-GROUP_COORDINATOR_SEARCH);
  for (const [, said] of events.reverse()) {
    const event = hby.db.getEvtSerder(hab.pre!, said);
    if (!event || event.sn === null) continue;
    const coordinator = { sn: event.sn, said: event.said! };
    if (groupElectedMember(hby, hab.pre!, coordinator) === member.pre) {
      return { coordinator, custodian: member.pre!, lead: true };
    }
  }
  return null;
}

/** Whether `member` was sent a `/registry/root` copy of the group's root for any of `registries`. */
function receivedRootCopy(hby: Habery, group: string, member: string, registries: ReadonlySet<string>): boolean {
  for (const [, copy] of hby.db.exns.getTopItemIter()) {
    if (copy.route !== RegistryRoot.Route || copy.pre === member || copy.sad?.ri !== member) continue;
    const data = copy.sad?.a as { gid?: string; rd?: string } | undefined;
    if (data?.gid === group && typeof data.rd === "string" && registries.has(data.rd)) return true;
  }
  return false;
}

/**
 * Prepare the custodian's first partial Grant for a fresh credential, preserving the discloser's fresh-origin and
 * far-node checks, and return the proposal the other issuer members consent to. Signs the custodian's Grant
 * contribution and files it locally; sends nothing and approves no DH exchange. The group is the credential's
 * managed registry's.
 *
 * @throws ValidationError unless the local member is the elected custodian of the group that owns the
 * credential's registry.
 */
export function* prepareGroupIssuance(
  ops: IssuanceOperations,
  draft: GrantDraft,
  coordinator?: string,
): Operation<PreparedGroupGrant> {
  const { deps, discloser } = ops, { credential, options } = draft;
  const group = credential.regid ? deps.rgy.regs.get(credential.regid)?.hab : undefined;
  if (!group) throw new ValidationError("Fresh issuance requires the issuing group's managed local registry");
  const party = GroupParty.resolve(deps, group, coordinator);
  if (!party.lead) throw new ValidationError("Only the elected issuer custodian prepares its managed fresh issuance");
  const prepared = yield* discloser.prepareIssuanceGrantBody(group.pre!, credential, options);
  const child = parseBytes(exchangeWire(group, prepared.exn, prepared.nests))[0];
  const proposal = yield* party.wrap(child, MULTISIG_EXN_ROUTE);
  yield* retainLocalGrant(deps.exc, child);
  yield* deps.reactor.processBytes(concatBytes(discloser.proofSupport(prepared.raw, group), proposal), { local: true });
  return { grant: prepared.exn.said!, proposal };
}

/**
 * Stored Grant proposals, one per Grant, of `group` or of every local group. The wrapper kept is another member's
 * where there is one (the proposal as received), and this member's own contribution otherwise.
 */
export function groupIssuanceProposals(ops: IssuanceOperations, group?: Hab): GroupIssuanceProposal[] {
  const { hby, exc } = ops.deps, found = new Map<string, GroupIssuanceProposal>();
  for (const [, parent] of hby.db.exns.getTopItemIter()) {
    if (parent.route !== MULTISIG_EXN_ROUTE || parent.pvrsn.major !== 2) continue;
    const child = loadNests(hby.db, parent.said!)[0]?.body;
    if (
      !(child instanceof SerderKERI) || child.route !== "/ipex/grant" || typeof child.sad?.ri !== "string"
      || (group
        ? child.pre !== group.pre
        : !hby.habs.get(child.pre!) || !isLocalGroupHab(hby, hby.habs.get(child.pre!)!))
    ) continue;
    if (!isIssuanceOrigin(child.pre!, loadNests(hby.db, parent.said!)[0]?.nests?.[0])) continue;
    const self = localGroupMember(hby, child.pre!).pre, known = found.get(child.said!);
    if (known && (parent.pre === self || known.proposer !== self)) continue;
    found.set(child.said!, {
      grant: child.said!,
      wrapper: parent.said!,
      group: child.pre!,
      proposer: parent.pre!,
      recipient: child.sad.ri,
      complete: exc.complete(child.said!),
    });
  }
  return [...found.values()];
}

/** The exact proposal wrapper and child frame for `grant`: the supplied bytes, or the stored wrapper. */
function* proposalOf(ops: IssuanceOperations, grant: string, proposal?: Uint8Array): Operation<GroupProposalFrame> {
  const { deps } = ops;
  let parent: SerderKERI | undefined, child: CesrFrame | undefined;
  if (proposal) {
    const packets = parseBytes(proposal);
    parent = packets[0]?.body as SerderKERI | undefined;
    child = packets[0]?.nests?.[0];
    if (packets.length !== 1 || packets[0].nests?.length !== 1) {
      throw new ValidationError("Select one exact group issuance Grant proposal");
    }
    yield* deps.reactor.processBytes(proposal);
  } else {
    const stored = groupIssuanceProposals(ops).find((item) => item.grant === grant);
    parent = stored ? deps.hby.db.exns.get([stored.wrapper]) ?? undefined : undefined;
    child = parent ? loadNests(deps.hby.db, parent.said!)[0] : undefined;
  }
  if (
    !(parent instanceof SerderKERI) || parent.route !== MULTISIG_EXN_ROUTE || !(child?.body instanceof SerderKERI)
    || child.body.said !== grant
  ) throw new ValidationError("Select one exact group issuance Grant proposal");
  if (!deps.exc.verifyAccepted(parent.said!, MULTISIG_EXN_ROUTE)) {
    throw new ValidationError("Grant proposal lacks member authentication");
  }
  return { parent, child };
}

/**
 * The issuer member's consent to a group Grant, and through it to contributing this member's signature to the DH
 * query when the custodian's arrives. The group is the proposal's. Verifies the proposal (it must carry the
 * elected custodian's signature) and rebuilds the exact Grant from its fresh inputs, signs this member's
 * contribution, files it and records the operation. Returns after local commit: sending the contribution to the
 * other members, and everything after, is `processOnce`.
 *
 * Calling it again after a reload produces the same signature and resumes the operation: a member that reloads
 * between consent and completion consents again.
 *
 * @throws ValidationError for a proposal the stores do not prove, one the elected custodian did not sign, an
 * operation already begun, or a Grant that differs from its exact fresh issuance inputs.
 */
export function* approveGroupIssuance(
  ops: IssuanceOperations,
  grantSaid: string,
  options: GroupApprovalOptions = {},
): Operation<IssuanceBegun> {
  const { deps, discloser } = ops;
  if (ops.live.has(grantSaid) || deps.exc.complete(grantSaid)) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const { child } = yield* proposalOf(ops, grantSaid, options.proposal);
  const party = GroupParty.resolve(deps, localGroup(deps, (child.body as SerderKERI).pre), options.coordinator);
  const { group } = party;
  const factors = envelopeFromFrame(child);
  if (
    !factors.tsgs.length
    || factors.attachmentGroups.some((attachment) => attachment.name.replace(/^Big/, "") !== "TransIdxSigGroups")
  ) {
    throw new ValidationError("Fresh group Grant requires only explicit establishment-bound group contributions");
  }
  const signed = new Set<number>();
  for (const proof of factors.tsgs) {
    const accepted = proof.sn <= BigInt(Number.MAX_SAFE_INTEGER)
      ? group.db.kels.getLast(proof.pre, Number(proof.sn))
      : null;
    const establishment = accepted ? group.db.getEvtSerder(proof.pre, accepted) : null;
    const verified = establishment?.estive
      ? Kever.verifyIndexedSignatures(child.body.raw, proof.sigers, establishment.verfers)
      : null;
    if (proof.pre !== group.pre || accepted !== proof.said || !verified || !proof.sigers.length) {
      throw new ValidationError("Invalid supplied group Grant contribution");
    }
    if (verified.sigers.length !== proof.sigers.length) {
      throw new ValidationError("Invalid supplied group Grant contribution");
    }
    for (const index of verified.indices) signed.add(index);
  }
  const custodian = latestGroupContribution(group.db, party.custodian, group.kever!.verfers);
  if (!custodian || !signed.has(custodian.index)) {
    throw new ValidationError("The Grant proposal lacks the elected custodian's signature");
  }
  const grant = child.body as SerderKERI, nodes = child.nests ?? [];
  const origin = nodes[0]?.body;
  if (!(origin instanceof SerderACDC)) throw new ValidationError("Group Grant lacks its exact origin");
  const rebuilt = yield* discloser.prepareIssuanceGrantBody(group.pre!, origin, {
    recipient: grant.sad!.ri as string,
    message: (grant.sad!.a as { m: string }).m,
    priorSaid: grant.sad!.p as string || undefined,
    date: grant.stamp!,
    kind: grant.kind,
    plan: (grant.sad!.q as { dp: [IssuanceGrantOptions["plan"]] }).dp[0],
    attrs: Object.fromEntries(
      Object.entries(grant.sad!.a as Record<string, unknown>).filter(([key]) => !["m", "o", "ax"].includes(key)),
    ),
    anchor: (grant.sad!.a as { ax?: boolean[] }).ax?.[0],
    artifacts: yield* call(() => Promise.all(nodes.slice(1).map((node) => collectPayload(framePayload(node))))),
  });
  const exact = grant.ilk === "xip"
    ? new SerderKERI({ sad: { ...rebuilt.exn.sad!, u: grant.sad!.u }, kind: grant.kind, makify: true })
    : rebuilt.exn;
  if (!bytesEqual(exact.raw, grant.raw)) {
    throw new ValidationError("Selected Grant differs from exact fresh issuance inputs");
  }
  const own = parseBytes(exchangeWire(group, grant, rebuilt.nests))[0];
  own.attachments = [...child.attachments, ...own.attachments];
  yield* retainLocalGrant(deps.exc, own);
  const ownProposal = yield* party.wrap(own, MULTISIG_EXN_ROUTE);
  yield* deps.reactor.processBytes(ownProposal, { local: true });
  return ops.beginGroup(
    new GroupIssuance(party, "issuer", grant, nodes, { proposal: ownProposal, anchor: options.anchor }),
  );
}

/**
 * A custodian's one consent to issue a fresh credential: prepares the Grant ({@link prepareGroupIssuance}) and
 * approves its own proposal ({@link approveGroupIssuance}). The other members approve the proposal it sent.
 */
export function* proposeGroupIssuance(
  ops: IssuanceOperations,
  draft: GrantDraft,
  options: GroupConsentOptions = {},
): Operation<IssuanceBegun> {
  const prepared = yield* prepareGroupIssuance(ops, draft, options.coordinator);
  return yield* approveGroupIssuance(ops, prepared.grant, { ...options, proposal: prepared.proposal });
}

/** A retained Grant this runtime is party to as a pending exchange, with the local group it names. */
interface PendingGrant {
  grant: SerderKERI;
  nodes: readonly CesrFrame[];
  origin: SerderACDC;
}

function pendingGrant(deps: IssuanceDeps, said: string): PendingGrant {
  const retained = deps.exc.retainedInput(said, { pending: true });
  const origin = retained?.nests?.[0]?.body;
  if (!retained || !(origin instanceof SerderACDC) || !origin.regid) {
    throw new ValidationError("The Grant is not an authenticated pending group issuance");
  }
  return { grant: retained.serder, nodes: retained.nests ?? [], origin };
}

/**
 * The holder group member's consent to DH for one authenticated pending Grant addressed to the group (the group is
 * the Grant's recipient). Approves DH through the coordinator's election; the member's contribution to the reply,
 * and for the custodian the keys, follow from `processOnce`. Admit is a separate consent.
 *
 * @throws ValidationError for a Grant that is not pending for a local group, or an operation already begun.
 */
export function approveGroupIssuanceExchange(
  ops: IssuanceOperations,
  said: string,
  coordinator?: string,
): IssuanceBegun {
  const { deps } = ops;
  if (ops.live.has(said) || deps.exc.complete(said)) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const { grant, nodes } = pendingGrant(deps, said);
  const party = GroupParty.resolve(deps, localGroup(deps, grant.sad!.ri), coordinator);
  return ops.beginGroup(new GroupIssuance(party, "holder", grant, nodes));
}

/**
 * Follow a group issuance that has already been contributed to, only to verify and accept the custodian's final
 * proof: the file-free path of an issuer member that left after contributing and returns for the proof. The group
 * is the Grant's sender. Signs nothing. The proof may already be stored (it arrives by mailbox), or be supplied as
 * bytes.
 *
 * @throws ValidationError for a Grant this runtime's groups did not send, or one already begun.
 */
export function* followGroupIssuanceProof(
  ops: IssuanceOperations,
  said: string,
  options: GroupFollowOptions = {},
): Operation<IssuanceBegun> {
  const { deps } = ops;
  if (ops.live.has(said) || deps.exc.complete(said)) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const { grant, nodes } = pendingGrant(deps, said);
  const party = GroupParty.resolve(deps, localGroup(deps, grant.pre), options.coordinator);
  if (options.proof) yield* deps.reactor.processBytes(options.proof);
  return ops.beginGroup(new GroupIssuance(party, "issuer", grant, nodes, { mode: "proofOnly" }));
}

/**
 * The custodian's exact public proof of a completed group issuance: the proof support and the
 * `/multisig/ipex-proof` wrapper every other member received, read back from the stores. A copy for members that
 * were away and for a file hand-off.
 *
 * @throws ValidationError unless the local member is the custodian of the Grant's sending group and has published
 * the proof of an accepted Grant.
 */
export function* groupIssuanceProof(ops: IssuanceOperations, said: string): Operation<Uint8Array> {
  const { deps, discloser } = ops, retained = deps.exc.retainedInput(said);
  if (!retained?.nests?.length || !deps.exc.complete(said)) {
    throw new ValidationError("Only the custodian of an accepted group Grant has its public proof");
  }
  const group = localGroup(deps, retained.serder.pre), member = localGroupMember(deps.hby, group.pre!);
  for (const [, parent] of deps.hby.db.exns.getTopItemIter()) {
    const attrs = parent.sad?.a as Record<string, unknown> | undefined;
    if (
      parent.route === MULTISIG_IPEX_PROOF_ROUTE && parent.pre === member.pre && attrs?.gid === group.pre
      && attrs?.grant === said
    ) {
      return concatBytes(
        discloser.proofSupport(yield* nodeStream(retained.nests), group),
        yield* storedBytes(deps.exc, parent.said!),
      );
    }
  }
  throw new ValidationError("The custodian has not published the proof of this group Grant");
}

/** How a group issuance starts: consent from a proposal, only following the proof, or resumed after a restart. */
export type GroupIssuanceMode = "consent" | "proofOnly" | "resumed";

/** What starts one group issuance beyond its party, Grant and nodes. */
export interface GroupStart {
  mode?: GroupIssuanceMode;
  /** The member's own proposal wrapper still owed to the other members. */
  proposal?: Uint8Array;
  /** Witness codes and counseling choices for the registry update's anchor, memory only. */
  anchor?: CounselInputs;
}

/** A proposal wrapper and the child it commits. */
export interface GroupProposalFrame {
  parent: SerderKERI;
  child: CesrFrame;
}

/** The per-operation state `IssuanceOperations` keeps for a group party; memory only. */
export class GroupIssuance {
  /** Wrappers received and not yet taken into DH, by SAID. */
  readonly pending = new Map<string, GroupWrapper>();
  readonly seen = new Set<string>();
  approved: boolean;
  contributed = false;
  started = false;
  /** Exact DH message this member contributes to, once frozen. */
  frozen?: Uint8Array;
  query?: Uint8Array;
  nextQuery = 0;
  nextProofScan = 0;
  /** The custodian's registry update, once proposed. */
  registryUpdate?: RegistryEventRef;
  /** Proposal wrapper this member still owes the other members. */
  proposal?: Uint8Array;
  nodeBytes?: Uint8Array;
  readonly mode: GroupIssuanceMode;
  readonly anchor?: CounselInputs;

  constructor(
    readonly party: GroupParty,
    readonly role: IssuanceRole,
    readonly grant: SerderKERI,
    readonly nodes: readonly CesrFrame[],
    start: GroupStart = {},
  ) {
    this.mode = start.mode ?? "consent";
    this.proposal = start.proposal;
    this.anchor = start.anchor;
    this.approved = this.mode === "resumed";
  }

  /** SAID of the Grant. */
  get said(): string {
    return this.grant.said!;
  }

  /** DH transaction id: the opening Grant's SAID, or the transaction a continuation Grant joins. */
  get xid(): string {
    return grantTransactionId(this.grant);
  }

  /** The other party: the holder (issuer role) or the issuer (holder role). */
  get peer(): string {
    return this.role === "issuer" ? this.grant.sad!.ri as string : this.grant.pre!;
  }

  /** The disclosed credential the Grant carries first. */
  get origin(): SerderACDC {
    return this.nodes[0].body as SerderACDC;
  }

  /** The credential's registry. */
  get registry(): string {
    return this.origin.regid!;
  }

  /** Whether `parent` is a DH child wrapper of this operation, beyond the structure every group wrapper has. */
  accepts(parent: SerderKERI, children: readonly CesrFrame[]): boolean {
    const issuer = this.role === "issuer";
    if (parent.route !== (issuer ? MULTISIG_QRY_ROUTE : MULTISIG_RPY_ROUTE)) return false;
    const body = children[0].body as SerderKERI, data = body.sad![issuer ? "q" : "a"] as { x?: string };
    return body.pre === this.party.group.pre && data?.x === this.xid
      && (!this.frozen || bytesEqual(this.frozen, body.raw));
  }
}

/** A DH wrapper and its child, kept until this member takes it into DH. */
export interface GroupWrapper {
  wrapper: SerderKERI;
  child: CesrFrame;
}

/**
 * The structure every DH child wrapper has, whichever operation it is for: one ordinary-signature query or
 * reply of a local group's DH transaction, wrapped by a current signing member of that group. Operation-specific
 * checks follow in {@link GroupIssuance.accepts}.
 */
function structural(hby: Habery, parent: SerderKERI, children: readonly CesrFrame[]): boolean {
  const child = children[0], body = child?.body, route = parent.route;
  if (
    children.length !== 1 || !(body instanceof SerderKERI) || parent.pvrsn.major !== 2 || parent.pvrsn.minor !== 0
    || (route !== MULTISIG_QRY_ROUTE && route !== MULTISIG_RPY_ROUTE)
  ) return false;
  const field = route === MULTISIG_QRY_ROUTE ? "qry" : "rpy", gid = body.pre;
  const group = gid ? hby.habs.get(gid) : undefined;
  if (
    !gid || !group || !isLocalGroupHab(hby, group) || !groupSigningMembers(hby, gid).includes(parent.pre!)
    || JSON.stringify(parent.sad!.a) !== JSON.stringify({ gid, [field]: body.said })
  ) return false;
  const data = body.sad![field === "qry" ? "q" : "a"] as { x?: unknown };
  return body.pvrsn.major === 2 && body.pvrsn.minor === 0 && body.ilk === field && body.route === Dhke.Route
    && typeof data?.x === "string" && (field !== "qry" || body.sad!.rr === Dhke.Route) && !child.nests?.length
    && envelopeFromFrame(child).attachmentGroups.every((group) =>
      ALLOWED_CHILD_FACTORS.includes(group.name.replace(/^Big/, ""))
    );
}

/**
 * Delegate the DH child wrappers of `/multisig/qry` and `/multisig/rpy` to this owner, once. The delegation is
 * structural: a wrapper that arrives before a member consents is kept as evidence and found by the operation
 * when it starts, and consent alone ever makes a member contribute. Registration refuses a second owner on
 * one runtime, which is the multiplexor's rule.
 */
export function registerGroupRoutes(ops: IssuanceOperations): void {
  if (ops.groupRoutes) return;
  const { mux } = ops.deps.group!, deps = ops.deps;
  ops.groupRoutes = [MULTISIG_QRY_ROUTE, MULTISIG_RPY_ROUTE].map((route): GroupRouteBinding => [route, {
    resource: route,
    acceptsNests: true,
    verify: (args) => structural(deps.hby, args.serder, args.nests ?? []),
    handle: (args) => {
      for (const op of ops.live.values()) {
        if (op.group?.accepts(args.serder, args.nests!)) {
          op.group.pending.set(args.serder.said!, { wrapper: args.serder, child: args.nests![0] });
        }
      }
    },
  }]);
  for (const [route, handler] of ops.groupRoutes) mux.addChildHandler(route, Dhke.Route, handler);
}

/** Release the delegation; a reopened runtime builds a new multiplexor, so this is for owners that outlive a phase. */
export function releaseGroupRoutes(ops: IssuanceOperations): void {
  for (const [route, handler] of ops.groupRoutes ?? []) {
    ops.deps.group?.mux.removeChildHandler(route, Dhke.Route, handler);
  }
  ops.groupRoutes = null;
}

/** Pick up the DH wrappers the exchanger stored before this operation started. */
function recover(deps: IssuanceDeps, g: GroupIssuance): void {
  for (const [, parent] of deps.hby.db.exns.getTopItemIter()) {
    if (parent.route !== MULTISIG_QRY_ROUTE && parent.route !== MULTISIG_RPY_ROUTE) continue;
    const input = deps.exc.retainedInput(parent.said!);
    if (input?.nests && structural(deps.hby, parent, input.nests) && g.accepts(parent, input.nests)) {
      g.pending.set(parent.said!, { wrapper: parent, child: input.nests[0] });
    }
  }
}

/**
 * Verify a custodian's exact final proof against the original issuer factors and accept the Grant; a rootless
 * member neither derives nor calls DH finish. False when the proof is not yet complete for this member, for
 * example while the member's own approval of the registry update is outstanding.
 *
 * @throws ValidationError when the proof is outside the selected group issuance or changes the original Grant.
 */
function* acceptProof(deps: IssuanceDeps, g: GroupIssuance, proof: Uint8Array): Operation<boolean> {
  const hab = g.party.group, { custodian } = g.party, grant = g.said;
  const packet = parseBytes(proof);
  const parent = packet.at(-1)!, child = parent?.nests?.[0];
  if (
    !parent || !(parent.body instanceof SerderKERI) || parent.body.route !== MULTISIG_IPEX_PROOF_ROUTE
    || parent.body.pre !== custodian || !groupSigningMembers(deps.hby, hab.pre!).includes(custodian)
    || JSON.stringify(parent.body.sad!.a) !== JSON.stringify({ gid: hab.pre, grant })
    || parent.nests?.length !== 1 || !child
  ) throw new ValidationError("Proof wrapper is outside the selected group issuance");
  // The core /multisig/ipex-proof route authenticates the wrapper and indexes it without replay.
  yield* deps.reactor.processBytes(proof);
  if (!deps.exc.verifyAccepted(parent.body.said!, MULTISIG_IPEX_PROOF_ROUTE)) {
    throw new ValidationError("Group proof wrapper is not authenticated");
  }
  const input = deps.exc.retainedInput(grant, { pending: true });
  if (!input || !bytesEqual(child.body.raw, input.serder.raw) || child.nests?.length !== input.nests?.length) {
    throw new ValidationError("Group proof changed the original live Grant");
  }
  const original = parseBytes(messagize(input.serder, { tsgs: input.tsgs, cigars: input.cigars, gvrsn: Vrsn_2_0 }))[0];
  if (!bytesEqual(yield* wire({ ...child, nests: [] }), yield* wire(original))) {
    throw new ValidationError("Group proof changed original issuer authentication");
  }
  for (const [index, old] of (input.nests ?? []).entries()) {
    const next = child.nests![index], fresh = index === 0;
    if (
      !bytesEqual(next.body.raw, old.body.raw) || next.nests?.length
      || next.attachments.length !== old.attachments.length + (fresh ? 1 : 0)
      || old.attachments.some((atc, i) => !bytesEqual(atc.raw, next.attachments[i].raw))
    ) throw new ValidationError("Group proof changed retained disclosure or attachments");
    if (!fresh) continue;
    const node = next.body as SerderACDC,
      added = envelopeFromFrame({ ...next, attachments: [next.attachments.at(-1)!] });
    const opening = added.bsqs[0], chain = node.regid && acceptedRegistryEvidence(deps.rgy.store, node.regid);
    if (
      added.attachmentGroups.length !== 1
      || added.attachmentGroups[0].name.replace(/^Big/, "") !== "BlindedStateQuadruples"
      || added.bsqs.length !== 1 || added.bsss.length || !opening || opening.ts.label !== "issued"
      || opening.td.nonce !== node.said
      || !chain || !chain.updates.length || chain.updates.at(-1)!.sad!.b !== opening.d.nonce
    ) return false;
    const result = vet({ ...chain, db: deps.hby.db, acdc: node, blinder: opening });
    if (result.kind !== "verified" || result.state.state !== "issued") {
      throw new ValidationError("Final proof does not verify the current issued BUP");
    }
  }
  yield* deps.exc.acceptPendingGrantProof({ ...input, nests: child.nests });
  return deps.exc.complete(grant);
}

/** Take a stored final proof into the operation, scanned at most once a second. True once the Grant is accepted. */
function* scanProof(deps: IssuanceDeps, g: GroupIssuance): Operation<boolean> {
  const now = deps.clock.now();
  if (now < g.nextProofScan) return false;
  g.nextProofScan = now + PROOF_SCAN_MS;
  for (const [, parent] of [...deps.hby.db.exns.getTopItemIter()]) {
    const attrs = parent.sad?.a as Record<string, unknown> | undefined;
    if (
      parent.route !== MULTISIG_IPEX_PROOF_ROUTE || parent.pre !== g.party.custodian
      || attrs?.gid !== g.party.group.pre || attrs?.grant !== g.said
    ) continue;
    if (yield* acceptProof(deps, g, yield* storedBytes(deps.exc, parent.said!))) return true;
  }
  return false;
}

/**
 * Advance one group operation by one pass; true once the Grant is accepted and nothing is left to do. Mirrors
 * the order of the loop it replaces: own proposal, Grant authentication, DH approval, the custodian's evidence and
 * query, wrapper intake and contribution, outgoing DH messages, the custodian's registry update, finish and proof.
 * Every signature here is one the consent that began the operation covers; the registry update's approval by
 * other members is not.
 */
export function* stepGroup(ops: IssuanceOperations, op: LiveIssuance): Operation<boolean> {
  const g = op.group!, { deps } = ops, { party } = g, { member, lead, coordinator, custodian } = party;
  const hab = party.group, { grant, xid } = op, dh = op.dh, issuer = g.role === "issuer";
  const send = function*(dest: string, msg: Uint8Array, topic = "multisig") {
    ops.enqueue(op, { src: member.pre!, dest, msg, topic });
  };
  const broadcast = function*(msg: Uint8Array) {
    for (const peer of party.others()) yield* send(peer, msg);
  };
  if (deps.exc.complete(grant)) return true;
  if (op.expires === null) {
    const deadline = deps.exc.exchangeDeadline(g.grant);
    if (deadline) {
      op.deadline = deadline;
      op.expires = timestampMicros(deadline);
    }
  }
  if (g.proposal) {
    const proposal = g.proposal;
    g.proposal = undefined;
    yield* broadcast(proposal);
  }
  if (!g.started) {
    g.started = true;
    if (g.mode !== "proofOnly") recover(deps, g);
  }
  if (g.mode === "proofOnly") return yield* scanProof(deps, g);
  if (!g.approved) {
    if (
      !deps.exc.pendingGrant(grant, { xid, sender: g.grant.pre!, recipient: g.grant.sad!.ri as string })
    ) {
      return false;
    }
    dh.approve(grant, { coordinator, custodian });
    g.approved = true;
    ops.setPhase(op, "exchangingKeys");
  }
  if (lead && !g.nodeBytes && g.mode === "resumed") g.nodeBytes = yield* nodeStream(g.nodes);
  if (lead && !g.nodeBytes) {
    g.nodeBytes = yield* nodeStream(g.nodes);
    const input = deps.exc.retainedInput(grant, { pending: true })!;
    const frame = parseBytes(messagize(input.serder, { tsgs: input.tsgs, cigars: input.cigars, gvrsn: Vrsn_2_0 }))[0];
    frame.nests = [...input.nests ?? []];
    const full = concatBytes(ops.discloser.proofSupport(g.nodeBytes, hab), yield* wire(frame));
    for (const peer of party.others()) yield* send(peer, full);
    if (issuer) {
      yield* send(g.grant.sad!.ri as string, full, "credential");
      const child = parseBytes(dh.start(grant))[0];
      g.frozen = child.body.raw;
      yield* deps.protocol.dispatch(child, { local: true });
      yield* broadcast(yield* party.wrap(child, MULTISIG_QRY_ROUTE));
    }
  }
  if (!lead && (g.contributed || !issuer) && (yield* scanProof(deps, g))) return true;
  if (!(issuer && !lead && g.contributed)) {
    for (const [said, item] of [...g.pending]) {
      if (g.seen.has(said)) {
        g.pending.delete(said);
        continue;
      }
      if (item.wrapper.pre === member.pre) {
        g.seen.add(said);
        g.pending.delete(said);
        continue;
      }
      if (!lead && !g.contributed) {
        if (!issuer && !dh.hasPeerQuery(xid)) continue;
        const signature = dh.contribute(xid, yield* wire(item.child));
        g.frozen = item.child.body.raw;
        g.contributed = true;
        yield* deps.protocol.dispatch(item.child, { local: true });
        const contribution = parseBytes(signature)[0];
        yield* deps.protocol.dispatch(contribution, { local: true });
        yield* broadcast(yield* party.wrap(contribution, issuer ? MULTISIG_QRY_ROUTE : MULTISIG_RPY_ROUTE));
        if (issuer) ops.setPhase(op, "awaitingAnchor");
      } else yield* deps.protocol.dispatch(item.child, { local: true });
      g.seen.add(said);
      g.pending.delete(said);
      if (issuer && !lead) break;
    }
  }
  while (dh.outgoing.length) {
    const message = dh.outgoing.pull()!;
    if (message.kin === "sign") {
      const child = parseBytes(message.msg)[0];
      g.frozen = child.body.raw;
      yield* deps.protocol.dispatch(child, { local: true });
      yield* broadcast(yield* party.wrap(child, MULTISIG_RPY_ROUTE));
    } else if (message.kin === "query") g.query = message.msg;
    else yield* send(message.dest, message.msg, "credential");
  }
  if (g.query && deps.clock.now() >= g.nextQuery && !dh.complete(xid)) {
    yield* send(g.grant.sad!.ri as string, g.query, "credential");
    g.nextQuery = deps.clock.now() + (deps.queryResendMs ?? ISSUANCE_QUERY_RESEND_MS);
  }
  if (!lead || !dh.complete(xid)) return false;
  const { rgy, receiptor, derived, hby } = deps, registry = op.registry;
  if (issuer) {
    if (!g.registryUpdate && rgy.store.headEvent(registry)?.ilk === "rip") {
      const reg = rgy.regs.get(registry);
      if (!reg || reg.hab !== hab) throw new ValidationError("Issuer custodian requires its managed registry");
      ops.setPhase(op, "awaitingAnchor");
      const custody = new RegistryCustody({ hby, hab, registry: rgy.store, store: derived });
      const staged = new RegistryAuthor(rgy, receiptor, custody).stage(reg, g.origin, "issued", {
        auths: g.anchor?.auths,
      });
      // The other issuer members approve this exact registry update as a separate proposal.
      const proposed = yield* proposeRegistryEvent(deps.group!.registry, hab, staged.event, staged.opening, g.anchor);
      g.registryUpdate = registryEventRef(staged.event, proposed.event);
    }
    if (g.registryUpdate) {
      const read = { db: hby.db, store: rgy.store, protocol: deps.protocol };
      if (registryEventStatus(read, g.registryUpdate).state !== "accepted") {
        if ((yield* settleRegistryEvent(read, g.registryUpdate)).state !== "accepted") return false;
      }
    }
  } else if (rgy.store.headEvent(registry)?.ilk !== "bup") return false;
  ops.setPhase(op, "proving");
  yield* dh.finish(xid);
  if (!deps.exc.complete(grant)) throw new ValidationError("Issued group Grant remains unaccepted");
  const completed = parseBytes(yield* storedBytes(deps.exc, grant))[0];
  const support = ops.discloser.proofSupport(g.nodeBytes!, hab);
  // KERIpy form: the elected member shares the proof with the other members by mailbox.
  const wrapped = yield* party.wrap(completed, MULTISIG_IPEX_PROOF_ROUTE);
  // Kept locally, so the proof the members received is the one {@link groupIssuanceProof} exports.
  yield* deps.reactor.processBytes(wrapped, { local: true });
  const publicProof = concatBytes(support, wrapped);
  for (const peer of party.others()) yield* send(peer, publicProof);
  if (issuer) yield* send(g.grant.sad!.ri as string, support, "credential");
  return true;
}
