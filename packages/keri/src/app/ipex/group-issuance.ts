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
 * | issuer custodian or member    | {@link beginGroupIssuance}                | this member's Grant contribution, and consent to its later DH query contribution |
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
 * after retaining its root reads `interrupted`: the frozen coordinator and custodian are not stored, so the
 * exchange is not resumed (see {@link ./issuance.ts}).
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
import { Dhke } from "../../acdc/dhking.ts";
import { vet } from "../../acdc/regeventing.ts";
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
import type { ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Hab } from "../identity/habbing.ts";
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
  multisigExnBody,
} from "../multisig/grouping.ts";
import { proposeRegistryEvent, type RegistryProposeDeps } from "../multisig/proposing.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { WitnessAuthMap } from "../witness/receipting.ts";
import { exchangeWire, type IssuanceGrantOptions } from "./ipex-discloser.ts";
import { acceptedRegistryEvidence } from "./ipex-node-authentication.ts";
import type { IssuanceBegun, IssuanceOperations, LiveIssuance } from "./issuance.ts";

/** Milliseconds between resends of the complete group query, as the individual path and KERIpy do. */
const QUERY_RESEND_MS = 1000;
/** Milliseconds between scans of the stored wrappers for the final proof. */
const PROOF_SCAN_MS = 1000;
/** How many of the group's latest accepted events {@link deriveGroupCustody} considers as coordinators. */
const GROUP_COORDINATOR_SEARCH = 16;
const ALLOWED_CHILD_FACTORS = ["TransIdxSigGroups", "TransLastIdxSigGroups", "ControllerIdxSigs"];

/** Collaborators only a group needs; an owner without them issues as an individual alone. */
export interface GroupIssuanceDeps {
  /** Where the DH child wrappers (`/multisig/qry`, `/multisig/rpy`) are delegated; one owner per runtime registers. */
  readonly mux: Pick<Multiplexor, "addChildHandler" | "removeChildHandler">;
  /** Collaborators of the custodian's registry update proposal. */
  readonly registry: RegistryProposeDeps;
}

/** Exact accepted coordinator and already elected custodian a group issuance is bound to. */
export interface GroupIssuanceSelection {
  /** The local group identifier that issues or receives. */
  hab: Hab;
  /** SAID of the accepted group event whose threshold evidence elects the custodian. */
  coordinator: string;
  /** AID of the elected member that generates and retains the DH keys. */
  custodian: string;
}

/** Input of {@link beginGroupIssuance}. */
export type BeginGroupIssuanceInput =
  & GroupIssuanceSelection
  & {
    /** Witness codes for the registry update's anchor, memory only. */
    auths?: WitnessAuthMap;
    /** Counseling choices for the anchor; the CLI passes `fallbackAfterMs: 0` so every member submits receipts. */
    counsel?: Omit<CounselInputs, "auths">;
  }
  & (
    | {
      /** A Grant proposal another member (or this one's `prepareGroupIssuance`) made, as bytes; omitted: the stored proposal. */
      grant: string;
      proposal?: Uint8Array;
    }
    | { credential: SerderACDC; options: IssuanceGrantOptions }
  );

/** A stored Grant proposal a member may consent to. */
export interface GroupIssuanceProposal {
  /** SAID of the Grant to pass to {@link beginGroupIssuance}. */
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

/** Verified local view of a selection. */
export interface Selected {
  hab: Hab;
  member: Hab;
  coordinator: GroupCoordinator;
  custodian: string;
  lead: boolean;
}

function selected(ops: Pick<IssuanceOperations, "deps">, selection: GroupIssuanceSelection): Selected {
  const { deps } = ops, { hab, custodian } = selection;
  if (!deps.group) throw new ValidationError("This issuance owner was composed without group collaborators");
  if (!isLocalGroupHab(deps.hby, hab)) throw new ValidationError("Group issuance requires a local group identifier");
  const member = localGroupMember(deps.hby, hab.pre!);
  const event = hab.db.getEvtSerder(hab.pre, selection.coordinator);
  const coordinator = event ? { sn: event.sn!, said: event.said! } : null;
  if (
    !coordinator || groupElectedMember(deps.hby, hab.pre!, coordinator) !== custodian
    || !latestGroupContribution(hab.db, member.pre!, hab.kever!.verfers)
  ) {
    throw new ValidationError(
      "Select the accepted coordinator's current elected custodian and a current signing member",
    );
  }
  return { hab, member, coordinator, custodian, lead: member.pre === custodian };
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

/** Parent authentication commits one exact child; it never supplies the child's group threshold. */
function* wrapper(
  member: Hab,
  hab: Hab,
  child: CesrFrame,
  route:
    | typeof MULTISIG_QRY_ROUTE
    | typeof MULTISIG_IPEX_PROOF_ROUTE
    | typeof MULTISIG_EXN_ROUTE
    | typeof MULTISIG_RPY_ROUTE,
): Operation<Uint8Array> {
  const body = multisigExnBody(member.pre!, { route, attrs: { gid: hab.pre! } }, child.body as SerderKERI, {
    version: Vrsn_2_0,
  });
  const frame = parseBytes(member.endorse(body, { gvrsn: Vrsn_2_0 }))[0];
  frame.nests = [child];
  return yield* wire(frame);
}

/** Replay accepted wrapper or completed Grant bytes through the exchanger's exact evidence serializer. */
function* storedBytes(ops: Pick<IssuanceOperations, "deps">, said: string): Operation<Uint8Array> {
  const chunks: Uint8Array[] = [];
  yield* call(async () => {
    for await (const chunk of ops.deps.exc.replay(said)) chunks.push(chunk);
  });
  return concatBytes(...chunks);
}

/** Local consent starts the original Exchanger deadline even while the group signature remains partial. */
function* retainLocalGrant(ops: Pick<IssuanceOperations, "deps">, child: CesrFrame): Operation<void> {
  const proof = envelopeFromFrame(child);
  yield* ops.deps.exc.processEvent({
    serder: child.body as SerderKERI,
    tsgs: proof.tsgs,
    lsgs: proof.ssgs,
    cigars: proof.cigars,
    nests: child.nests,
    gvrsn: Vrsn_2_0,
  });
}

/**
 * The selection a restarted group custodian was frozen with, derived from the stores: the local member that holds
 * the group's registry root is the custodian (only it retains one before the Grant completes), and the coordinator
 * is the latest accepted group event whose threshold evidence elects that member. DH only checks that the frozen
 * coordinator still elects the frozen custodian, so any such event serves. Null when no accepted event elects the
 * local member. A non-custodian that already holds a replicated root copy for a Grant still pending is the one case
 * this can mistake for a custodian; it then finishes its own Grant from the root and update, which verifies, and
 * broadcasts a proof wrapper that the other members reject because it is not the custodian's.
 */
export function deriveGroupCustody(
  deps: Pick<IssuanceOperations["deps"], "hby">,
  hab: Hab,
): Selected | null {
  const { hby } = deps;
  if (!isLocalGroupHab(hby, hab) || !hab.kever) return null;
  const member = localGroupMember(hby, hab.pre!);
  const events = [...hby.db.getKelItemIter(hab.pre!)].slice(-GROUP_COORDINATOR_SEARCH);
  for (const [, said] of events.reverse()) {
    const event = hby.db.getEvtSerder(hab.pre!, said);
    if (!event || event.sn === null) continue;
    const coordinator = { sn: event.sn, said: event.said! };
    if (groupElectedMember(hby, hab.pre!, coordinator) === member.pre) {
      return { hab, member, coordinator, custodian: member.pre!, lead: true };
    }
  }
  return null;
}

/**
 * Prepare the custodian's first partial Grant for a fresh credential, preserving the discloser's fresh-origin and
 * far-node checks, and return the proposal the other issuer members consent to. Signs the custodian's Grant
 * contribution and files it locally; sends nothing and approves no DH exchange.
 *
 * @throws ValidationError unless the selection is accepted and its member is the custodian, and the credential's
 * registry is the group's managed one.
 */
export function* prepareGroupIssuance(
  ops: IssuanceOperations,
  { credential, options, ...selection }: GroupIssuanceSelection & {
    credential: SerderACDC;
    options: IssuanceGrantOptions;
  },
): Operation<{ grant: string; proposal: Uint8Array }> {
  const { deps, discloser } = ops, { hab, member, lead } = selected(ops, selection);
  if (!lead || !credential.regid || deps.rgy.regs.get(credential.regid)?.hab !== hab) {
    throw new ValidationError("Only the elected issuer custodian prepares its managed fresh issuance");
  }
  const prepared = yield* discloser.prepareIssuanceGrantBody(hab.pre!, credential, options);
  const child = parseBytes(exchangeWire(hab, prepared.exn, prepared.nests))[0];
  const proposal = yield* wrapper(member, hab, child, MULTISIG_EXN_ROUTE);
  yield* retainLocalGrant(ops, child);
  yield* deps.reactor.processBytes(concatBytes(discloser.proofSupport(prepared.raw, hab), proposal), { local: true });
  return { grant: prepared.exn.said!, proposal };
}

/**
 * Stored Grant proposals of `hab`, one per Grant. The wrapper kept is another member's where there is one (the
 * proposal as received), and this member's own contribution otherwise.
 */
export function groupIssuanceProposals(
  ops: Pick<IssuanceOperations, "deps">,
  hab: Hab,
): GroupIssuanceProposal[] {
  const { hby, exc } = ops.deps, found = new Map<string, GroupIssuanceProposal>();
  const self = localGroupMember(hby, hab.pre!).pre;
  for (const [, parent] of hby.db.exns.getTopItemIter()) {
    if (parent.route !== MULTISIG_EXN_ROUTE || parent.pvrsn.major !== 2) continue;
    const child = loadNests(hby.db, parent.said!)[0]?.body;
    if (
      !(child instanceof SerderKERI) || child.route !== "/ipex/grant" || child.pre !== hab.pre
      || typeof child.sad?.ri !== "string"
    ) continue;
    const known = found.get(child.said!);
    if (known && (parent.pre === self || known.proposer !== self)) continue;
    found.set(child.said!, {
      grant: child.said!,
      wrapper: parent.said!,
      group: hab.pre!,
      proposer: parent.pre!,
      recipient: child.sad.ri,
      complete: exc.complete(child.said!),
    });
  }
  return [...found.values()];
}

/** The exact proposal wrapper and child frame for `grant`: the supplied bytes, or the stored wrapper. */
function* proposalOf(
  ops: IssuanceOperations,
  hab: Hab,
  grant: string,
  proposal?: Uint8Array,
): Operation<{ parent: SerderKERI; child: CesrFrame }> {
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
    const stored = groupIssuanceProposals(ops, hab).find((item) => item.grant === grant);
    parent = stored ? deps.hby.db.exns.get([stored.wrapper]) ?? undefined : undefined;
    child = parent ? loadNests(deps.hby.db, parent.said!)[0] : undefined;
  }
  if (
    !(parent instanceof SerderKERI) || parent.route !== MULTISIG_EXN_ROUTE || !(child?.body instanceof SerderKERI)
    || child.body.said !== grant || child.body.pre !== hab.pre
  ) throw new ValidationError("Select one exact group issuance Grant proposal");
  if (!deps.exc.verifyAccepted(parent.said!, MULTISIG_EXN_ROUTE)) {
    throw new ValidationError("Grant proposal lacks member authentication");
  }
  return { parent, child };
}

/**
 * The issuer member's consent to a group Grant, and through it to contributing this member's signature to the DH
 * query when the custodian's arrives. Verifies the proposal and rebuilds the exact Grant from its fresh inputs,
 * signs this member's contribution, files it and records the operation. A custodian may pass a
 * credential and options instead of a prepared Grant. Returns after local commit: sending the contribution to the
 * other members, and everything after, is `processOnce`.
 *
 * Calling it again after a reload produces the same signature and resumes the operation: a member that reloads
 * between consent and completion consents again.
 *
 * @throws ValidationError for a selection or proposal the stores do not prove, an operation already begun, or a
 * Grant that differs from its exact fresh issuance inputs.
 */
export function* beginGroupIssuance(
  ops: IssuanceOperations,
  input: BeginGroupIssuanceInput,
): Operation<IssuanceBegun> {
  const { deps, discloser } = ops, sel = selected(ops, input), { hab, member } = sel;
  let grantSaid: string, proposal: Uint8Array | undefined;
  if ("credential" in input) {
    ({ grant: grantSaid, proposal } = yield* prepareGroupIssuance(ops, input));
  } else ({ grant: grantSaid, proposal } = input);
  if (ops.live.has(grantSaid) || deps.exc.complete(grantSaid)) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const { child } = yield* proposalOf(ops, hab, grantSaid, proposal);
  const factors = envelopeFromFrame(child);
  if (
    !factors.tsgs.length
    || factors.attachmentGroups.some((group) => group.name.replace(/^Big/, "") !== "TransIdxSigGroups")
  ) {
    throw new ValidationError("Fresh group Grant requires only explicit establishment-bound group contributions");
  }
  for (const proof of factors.tsgs) {
    const accepted = proof.sn <= BigInt(Number.MAX_SAFE_INTEGER)
      ? hab.db.kels.getLast(proof.pre, Number(proof.sn))
      : null;
    const establishment = accepted ? hab.db.getEvtSerder(proof.pre, accepted) : null;
    if (
      proof.pre !== hab.pre || accepted !== proof.said || !establishment?.estive || !proof.sigers.length
      || Kever.verifyIndexedSignatures(child.body.raw, proof.sigers, establishment.verfers).sigers.length
        !== proof.sigers.length
    ) throw new ValidationError("Invalid supplied group Grant contribution");
  }
  const grant = child.body as SerderKERI, nodes = child.nests ?? [];
  const origin = nodes[0]?.body;
  if (!(origin instanceof SerderACDC)) throw new ValidationError("Group Grant lacks its exact origin");
  const rebuilt = yield* discloser.prepareIssuanceGrantBody(hab.pre!, origin, {
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
  const own = parseBytes(exchangeWire(hab, grant, rebuilt.nests))[0];
  own.attachments = [...child.attachments, ...own.attachments];
  yield* retainLocalGrant(ops, own);
  const ownProposal = yield* wrapper(member, hab, own, MULTISIG_EXN_ROUTE);
  yield* deps.reactor.processBytes(ownProposal, { local: true });
  const xid = grant.ilk === "xip" ? grant.said! : grant.sad!.x as string;
  return ops.beginGroup({
    grant: grantSaid,
    xid,
    role: "issuer",
    sel,
    frozen: grant,
    nodes,
    registry: (origin as SerderACDC).regid!,
    peer: grant.sad!.ri as string,
    proposal: ownProposal,
    auths: input.auths,
    counsel: input.counsel,
  });
}

/**
 * The holder group member's consent to DH for one authenticated pending Grant addressed to the group. Approves DH
 * through the frozen coordinator and custodian; the member's contribution to the reply, and for the custodian the
 * keys, follow from `processOnce`. Admit is a separate consent.
 *
 * @throws ValidationError for a Grant that is not pending for this group, or an operation already begun.
 */
export function approveGroupIssuanceExchange(
  ops: IssuanceOperations,
  input: GroupIssuanceSelection & { grant: string },
): IssuanceBegun {
  const { deps } = ops, sel = selected(ops, input), { hab } = sel;
  if (ops.live.has(input.grant) || deps.exc.complete(input.grant)) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const retained = deps.exc.retainedInput(input.grant, { pending: true });
  const credential = retained?.nests?.[0]?.body;
  if (!retained || retained.serder.sad!.ri !== hab.pre || !(credential instanceof SerderACDC) || !credential.regid) {
    throw new ValidationError("Recipient setup selects an authenticated pending Grant");
  }
  const grant = retained.serder;
  return ops.beginGroup({
    grant: input.grant,
    xid: grant.ilk === "xip" ? grant.said! : grant.sad!.x as string,
    role: "holder",
    sel,
    frozen: grant,
    nodes: retained.nests ?? [],
    registry: credential.regid,
    peer: grant.pre!,
  });
}

/**
 * Follow a group issuance that has already been contributed to, only to verify and accept the custodian's final
 * proof: the file-free path of an issuer member that left after contributing and returns for the proof. Signs
 * nothing. The proof may already be stored (it arrives by mailbox), or be supplied as bytes.
 *
 * @throws ValidationError for a Grant this group is not party to as issuer, or one already begun.
 */
export function* followGroupIssuanceProof(
  ops: IssuanceOperations,
  input: GroupIssuanceSelection & { grant: string; proof?: Uint8Array },
): Operation<IssuanceBegun> {
  const { deps } = ops, sel = selected(ops, input);
  if (ops.live.has(input.grant) || deps.exc.complete(input.grant)) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const retained = deps.exc.retainedInput(input.grant, { pending: true });
  const origin = retained?.nests?.[0]?.body;
  if (!retained || retained.serder.pre !== sel.hab.pre || !(origin instanceof SerderACDC) || !origin.regid) {
    throw new ValidationError("Final group proof requires the group's authenticated pending Grant");
  }
  if (input.proof) yield* deps.reactor.processBytes(input.proof);
  const grant = retained.serder;
  return ops.beginGroup({
    grant: input.grant,
    xid: grant.ilk === "xip" ? grant.said! : grant.sad!.x as string,
    role: "issuer",
    sel,
    frozen: grant,
    nodes: retained.nests ?? [],
    registry: origin.regid,
    peer: grant.sad!.ri as string,
    proofOnly: true,
  });
}

/**
 * The custodian's exact public proof of a completed group issuance: the proof support and the
 * `/multisig/ipex-proof` wrapper every other member received, read back from the stores. A copy for members that
 * were away and for a file hand-off.
 *
 * @throws ValidationError unless the selection's member is the custodian and has published the proof of an accepted Grant.
 */
export function* groupIssuanceProof(
  ops: IssuanceOperations,
  input: GroupIssuanceSelection & { grant: string },
): Operation<Uint8Array> {
  const { deps, discloser } = ops, { hab, member, lead } = selected(ops, input);
  const retained = deps.exc.retainedInput(input.grant);
  if (!lead || !deps.exc.complete(input.grant) || !retained?.nests?.length) {
    throw new ValidationError("Only the custodian of an accepted group Grant has its public proof");
  }
  for (const [, parent] of deps.hby.db.exns.getTopItemIter()) {
    const attrs = parent.sad?.a as Record<string, unknown> | undefined;
    if (
      parent.route === MULTISIG_IPEX_PROOF_ROUTE && parent.pre === member.pre && attrs?.gid === hab.pre
      && attrs?.grant === input.grant
    ) {
      return concatBytes(
        discloser.proofSupport(yield* nodeStream(retained.nests), hab),
        yield* storedBytes(ops, parent.said!),
      );
    }
  }
  throw new ValidationError("The custodian has not published the proof of this group Grant");
}

/** What `IssuanceOperations.beginGroup` needs to record one group operation. */
export interface GroupBegin {
  grant: string;
  xid: string;
  role: "issuer" | "holder";
  sel: Selected;
  /** The exact Grant body every contribution signs. */
  frozen: SerderKERI;
  nodes: readonly CesrFrame[];
  registry: string;
  /** The other party: the holder (issuer role) or the issuer (holder role). */
  peer: string;
  /** Proposal wrapper this member still owes the other members. */
  proposal?: Uint8Array;
  /** DH is already approved (the holder approves with its consent). */
  approved?: boolean;
  auths?: WitnessAuthMap;
  counsel?: Omit<CounselInputs, "auths">;
  /** Only verify and accept the custodian's final proof. */
  proofOnly?: boolean;
  /** A custodian adopted after a restart: DH is complete, so no evidence, query or approval is sent again. */
  resumed?: boolean;
}

/** The per-operation state `IssuanceOperations` keeps for a group party; memory only. */
export class GroupIssuance {
  /** Wrappers received and not yet taken into DH, by SAID. */
  readonly pending = new Map<string, { wrapper: SerderKERI; child: CesrFrame }>();
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
  anchor?: RegistryEventRef;
  /** Proposal wrapper this member still owes the other members. */
  proposal?: Uint8Array;
  nodeBytes?: Uint8Array;
  readonly sel: Selected;
  readonly role: "issuer" | "holder";
  readonly frozenGrant: SerderKERI;
  readonly nodes: readonly CesrFrame[];
  readonly xid: string;
  readonly origin: SerderACDC;
  readonly proofOnly: boolean;
  readonly resumed: boolean;
  readonly auths?: WitnessAuthMap;
  readonly counsel?: Omit<CounselInputs, "auths">;

  constructor(begin: GroupBegin) {
    this.sel = begin.sel;
    this.role = begin.role;
    this.frozenGrant = begin.frozen;
    this.nodes = begin.nodes;
    this.xid = begin.xid;
    this.origin = begin.nodes[0].body as SerderACDC;
    this.proposal = begin.proposal;
    this.approved = begin.approved ?? false;
    this.proofOnly = begin.proofOnly ?? false;
    this.resumed = begin.resumed ?? false;
    this.auths = begin.auths;
    this.counsel = begin.counsel;
  }

  /** Whether `parent` is a DH child wrapper of this operation, beyond the structure every group wrapper has. */
  accepts(parent: SerderKERI, children: readonly CesrFrame[]): boolean {
    const { hab } = this.sel, issuer = this.role === "issuer";
    if (parent.route !== (issuer ? MULTISIG_QRY_ROUTE : MULTISIG_RPY_ROUTE)) return false;
    const body = children[0].body as SerderKERI, data = body.sad![issuer ? "q" : "a"] as { x?: string };
    return body.pre === hab.pre && data?.x === this.xid && (!this.frozen || bytesEqual(this.frozen, body.raw));
  }
}

/**
 * The structure every DH child wrapper has, whichever operation it is for: one ordinary-signature query or
 * reply of a local group's DH transaction, wrapped by a current signing member of that group. Operation-specific
 * checks follow in {@link GroupIssuance.accepts}.
 */
function structural(
  { hby }: Pick<IssuanceOperations["deps"], "hby">,
  parent: SerderKERI,
  children: readonly CesrFrame[],
): boolean {
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
  ops.groupRoutes = [MULTISIG_QRY_ROUTE, MULTISIG_RPY_ROUTE].map((route): [string, ExchangeRouteHandler] => [route, {
    resource: route,
    acceptsNests: true,
    verify: (args) => structural(deps, args.serder, args.nests ?? []),
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
function recover(ops: IssuanceOperations, g: GroupIssuance): void {
  const { deps } = ops;
  for (const [, parent] of deps.hby.db.exns.getTopItemIter()) {
    if (parent.route !== MULTISIG_QRY_ROUTE && parent.route !== MULTISIG_RPY_ROUTE) continue;
    const input = deps.exc.retainedInput(parent.said!);
    if (input?.nests && structural(deps, parent, input.nests) && g.accepts(parent, input.nests)) {
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
function* acceptProof(ops: IssuanceOperations, g: GroupIssuance, grant: string, proof: Uint8Array): Operation<boolean> {
  const { deps } = ops, { hab } = g.sel, { custodian } = g.sel;
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
function* scanProof(ops: IssuanceOperations, g: GroupIssuance, grant: string): Operation<boolean> {
  const { deps } = ops, now = deps.clock.now();
  if (now < g.nextProofScan) return false;
  g.nextProofScan = now + PROOF_SCAN_MS;
  for (const [, parent] of [...deps.hby.db.exns.getTopItemIter()]) {
    const attrs = parent.sad?.a as Record<string, unknown> | undefined;
    if (
      parent.route !== MULTISIG_IPEX_PROOF_ROUTE || parent.pre !== g.sel.custodian || attrs?.gid !== g.sel.hab.pre
      || attrs?.grant !== grant
    ) continue;
    if (yield* acceptProof(ops, g, grant, yield* storedBytes(ops, parent.said!))) return true;
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
  const g = op.group!, { deps } = ops, { hab, member, lead, coordinator, custodian } = g.sel;
  const { grant, xid } = op, dh = op.dh, issuer = g.role === "issuer";
  const send = function*(dest: string, msg: Uint8Array, topic = "multisig") {
    ops.enqueue(op, { src: member.pre!, dest, msg, topic });
  };
  const others = () => groupSigningMembers(deps.hby, hab.pre!).filter((peer) => peer !== member.pre);
  const broadcast = function*(msg: Uint8Array) {
    for (const peer of others()) yield* send(peer, msg);
  };
  if (deps.exc.complete(grant)) return true;
  if (op.expires === null) {
    const deadline = deps.exc.exchangeDeadline(g.frozenGrant);
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
    if (!g.proofOnly) recover(ops, g);
  }
  if (g.proofOnly) return yield* scanProof(ops, g, grant);
  if (!g.approved) {
    if (
      !deps.exc.pendingGrant(grant, { xid, sender: g.frozenGrant.pre!, recipient: g.frozenGrant.sad!.ri as string })
    ) {
      return false;
    }
    dh.approve(grant, { coordinator, custodian });
    g.approved = true;
    ops.setPhase(op, "exchangingKeys");
  }
  if (lead && !g.nodeBytes && g.resumed) g.nodeBytes = yield* nodeStream(g.nodes);
  if (lead && !g.nodeBytes) {
    g.nodeBytes = yield* nodeStream(g.nodes);
    const input = deps.exc.retainedInput(grant, { pending: true })!;
    const frame = parseBytes(messagize(input.serder, { tsgs: input.tsgs, cigars: input.cigars, gvrsn: Vrsn_2_0 }))[0];
    frame.nests = [...input.nests ?? []];
    const full = concatBytes(ops.discloser.proofSupport(g.nodeBytes, hab), yield* wire(frame));
    for (const peer of others()) yield* send(peer, full);
    if (issuer) {
      yield* send(g.frozenGrant.sad!.ri as string, full, "credential");
      const child = parseBytes(dh.start(grant))[0];
      g.frozen = child.body.raw;
      yield* deps.protocol.dispatch(child, { local: true });
      yield* broadcast(yield* wrapper(member, hab, child, MULTISIG_QRY_ROUTE));
    }
  }
  if (!lead && (g.contributed || !issuer) && (yield* scanProof(ops, g, grant))) return true;
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
        yield* broadcast(yield* wrapper(member, hab, contribution, issuer ? MULTISIG_QRY_ROUTE : MULTISIG_RPY_ROUTE));
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
      yield* broadcast(yield* wrapper(member, hab, child, MULTISIG_RPY_ROUTE));
    } else if (message.kin === "query") g.query = message.msg;
    else yield* send(message.dest, message.msg, "credential");
  }
  if (g.query && deps.clock.now() >= g.nextQuery && !dh.complete(xid)) {
    yield* send(g.frozenGrant.sad!.ri as string, g.query, "credential");
    g.nextQuery = deps.clock.now() + QUERY_RESEND_MS;
  }
  if (!lead || !dh.complete(xid)) return false;
  const { rgy, receiptor, derived, hby } = deps, registry = op.registry;
  if (issuer) {
    if (!g.anchor && rgy.store.headEvent(registry)?.ilk === "rip") {
      const reg = rgy.regs.get(registry);
      if (!reg || reg.hab !== hab) throw new ValidationError("Issuer custodian requires its managed registry");
      ops.setPhase(op, "awaitingAnchor");
      const custody = new RegistryCustody({ hby, hab, registry: rgy.store, store: derived });
      const staged = new RegistryAuthor(rgy, receiptor, custody).stage(reg, g.origin, "issued", { auths: g.auths });
      // The other issuer members approve this exact registry update as a separate proposal.
      const proposed = yield* proposeRegistryEvent(deps.group!.registry, hab, staged.event, staged.opening, {
        ...g.counsel,
        auths: g.auths,
      });
      g.anchor = registryEventRef(staged.event, proposed.event);
    }
    if (g.anchor) {
      const read = { db: hby.db, store: rgy.store, protocol: deps.protocol };
      if (registryEventStatus(read, g.anchor).state !== "accepted") {
        if ((yield* settleRegistryEvent(read, g.anchor)).state !== "accepted") return false;
      }
    }
  } else if (rgy.store.headEvent(registry)?.ilk !== "bup") return false;
  ops.setPhase(op, "proving");
  yield* dh.finish(xid);
  if (!deps.exc.complete(grant)) throw new ValidationError("Issued group Grant remains unaccepted");
  const completed = parseBytes(yield* storedBytes(ops, grant))[0];
  const support = ops.discloser.proofSupport(g.nodeBytes!, hab);
  // KERIpy form: the elected member shares the proof with the other members by mailbox.
  const wrapped = yield* wrapper(member, hab, completed, MULTISIG_IPEX_PROOF_ROUTE);
  // Kept locally, so the proof the members received is the one {@link groupIssuanceProof} exports.
  yield* deps.reactor.processBytes(wrapped, { local: true });
  const publicProof = concatBytes(support, wrapped);
  for (const peer of others()) yield* send(peer, publicProof);
  if (issuer) yield* send(g.frozenGrant.sad!.ri as string, support, "credential");
  return true;
}
