import { Organizer } from "../identity/organizing.ts";
/**
 * Multisig proposal and approval workflows.
 *
 * CLI orchestration owns timed waits, worker lifetimes, prompts and output.
 * This module publishes proposals and approves stored KEL/RPY/VDR proposals
 * without starting or driving background workers.
 */
import {
  attachmentPayload,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  Ilks,
  NumberPrimitive,
  NumDex,
  parseBytes,
  Prefixer,
  SerderACDC,
  SerderKERI,
  type Siger,
  TraitDex,
  Verfer,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import {
  type RegistryDisclosure,
  verifyRegistryAnchor,
  vetBlind,
} from "../../acdc/regeventing.ts";
import { publicOpeningAttachment } from "../../acdc/registering.ts";
import { ValidationError } from "../../core/errors.ts";
import { isV2RegistryRoute } from "../../core/exchange/protocol-exchanging.ts";
import { Kever } from "../../core/kel/kever.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { RegistryRecord } from "../../core/records.ts";
import { dgKey } from "../../db/core/keys.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import { Credentialer, Regery, Registry, serializeCredential } from "../../vdr/credentialing.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import { type AgentRuntime } from "../runtime/agent-runtime.ts";

import type { Reger } from "../../db/reger.ts";
import {
  groupCredentialAnchorReady,
  validateCredentialIssueProposal,
  validateCredentialRevocationProposal,
  validateCredentialSource,
  validateRegistryName,
  validateRegistryProposal,
} from "../credentials/credential-proposals.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import {
  endpointRoleAccepted,
  groupEndorseReply,
  groupEventKeys,
  groupSigningMembers,
  localGroupMember,
  signLocalGroupEvent,
} from "../identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { Reactor } from "../protocol/reactor.ts";
import { abortable } from "../runtime/abortable.ts";
import { collectBytes } from "../transport/byte-source.ts";
import { findLocalGroupMember as findLocalMember, groupMemberHasKey, uniqueMembers } from "./group-members.ts";
import {
  acdcV2RegistryProposal,
  MULTISIG_BUP_ROUTE,
  MULTISIG_ICP_ROUTE,
  MULTISIG_ISS_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_REV_ROUTE,
  MULTISIG_RIP_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_RPY_ROUTE,
  MULTISIG_VCP_ROUTE,
  type MultisigChild,
  multisigChild,
  multisigChildEvidence,
  multisigChildGenusAttrs,
  type MultisigEventProposal,
  type MultisigMessage,
  type MultisigVdrProposal,
  prepareAcdcV2RegistryExn,
  prepareMultisigEventExn,
  prepareMultisigVdrExn,
  registryProposalEvent,
} from "./grouping.ts";
import {
  admitAndSendGroupMessage,
  type GroupDelivery,
  type GroupSendResult,
  groupSendResult,
  multisigPayloadSaid,
  prepareGroupMessage,
  remoteGroupMembers,
  signGroupMessage,
  storedGroupMessage,
} from "./multisig-messaging.ts";

/** Approve one exact ACDC v2 TEL/anchor through existing member signing and ordinary processors.
 * A returned wrapper records consent, not quorum/witness/TEL completion; retry the accepted-state owners.
 */
export function* approveAcdcV2Registry(
  hby: Habery,
  protocol: ProtocolProcessor,
  group: Hab,
  event: SerderACDC,
  { anchor, opening }: { anchor?: SerderKERI; opening?: RegistryDisclosure } = {},
): Operation<MultisigMessage> {
  const registry = protocol.registry, member = localGroupMember(hby, group.pre);
  if (!registry || group.db !== hby.db || registry.db !== hby.db) {
    throw new ValidationError("ACDC v2 group registry owner is unavailable.");
  }
  if (!group.kever || !groupSigningMembers(hby, group.pre).includes(member.pre)) {
    throw new ValidationError("Registry approval requires an accepted group and current local signing member.");
  }
  const checked = registryProposalEvent(event, group.pre, registry.store);
  if (!checked) {
    throw new ValidationError("ACDC v2 TEL belongs to another group or is unavailable.");
  }
  if (opening && (event.ilk !== "bup" || !vetBlind(opening, event.sad!.b as string))) {
    throw new ValidationError("Invalid proposed event opening.");
  }
  const seal = { i: checked.regid, s: event.sad!.n, d: event.said! };
  const retained = registry.store.anchor(event.said!);
  if (
    !anchor && retained
    && verifyRegistryAnchor(checked, { db: hby.db, issuer: group.pre, number: retained[0], diger: retained[1] })
  ) {
    anchor = hby.db.getEvtSerder(group.pre, retained[1].qb64) ?? undefined;
  }
  const seals = (candidate: SerderKERI | null | undefined) =>
    !!candidate?.seals.some(value => isRecord(value) && value.i === seal.i && value.s === seal.s && value.d === seal.d);
  // A rerun resumes an accepted group anchor whose TEL still awaits evidence; it never authors a second anchor.
  for (let sn = group.kever.sn; !anchor && sn > 0; sn--) {
    const said = hby.db.kels.getLast(group.pre, sn);
    const candidate = said ? hby.db.getEvtSerder(group.pre, said) : null;
    if (seals(candidate)) anchor = candidate!;
  }
  let authored = false;
  if (!anchor) {
    const pending = hby.db.pses.getLast(group.pre, group.kever!.sn + 1);
    if (pending) anchor = hby.db.getEvtSerder(group.pre, pending) ?? undefined;
    if (!anchor) {
      authored = true;
      anchor = (group.kever!.estOnly
        ? hby.rotateGroupHab(group.name, undefined, undefined, { data: [seal], version: Vrsn_2_0 })
        : hby.interactGroupHab(group.name, undefined, { data: [seal], version: Vrsn_2_0 })).serder;
    }
  }
  if (
    anchor.pvrsn.major !== 2 || anchor.pvrsn.minor !== 0 || !anchor.verify()
    || anchor.pre !== group.pre || !["ixn", "rot", "drt"].includes(anchor.ilk ?? "")
    || !anchor.seals.some(value => isRecord(value) && value.i === seal.i && value.s === seal.s && value.d === seal.d)
  ) {
    throw new ValidationError("Group anchor must be V2 and seal the exact proposed TEL.");
  }
  if (!authored && hby.db.kels.getLast(group.pre, anchor.sn!) === anchor.said) {
    // Accepted anchors reuse only this member's authenticated exact recorded contribution.
    let establishment: SerderKERI | null = anchor;
    while (establishment && !establishment.estive) {
      establishment = establishment.prior ? hby.db.getEvtSerder(group.pre, establishment.prior) : null;
    }
    for (const index of hby.db.meids.get([anchor.said!])) {
      const retained = hby.db.exns.get([index.qb64]);
      const payload = retained?.sad?.a;
      if (
        !retained || retained.pre !== member.pre || retained.route !== `/multisig/${event.ilk}` || !isRecord(payload)
        || payload.gid !== group.pre || payload.tel !== event.said || payload.anc !== anchor.said
        || !protocol.exc.verifyAccepted(retained.said!, retained.route!)
      ) {
        continue;
      }
      const frames = loadNests(hby.db, retained.said!);
      const verified = establishment && frames[1] && Kever.verifyIndexedSignatures(
        anchor.raw,
        envelopeFromFrame(frames[1]).sigers,
        establishment.verfers,
      );
      if (
        !verified
        || !verified.sigers.some(siger =>
          groupMemberHasKey(hby.db, member.pre, establishment!.verfers[siger.index].qb64)
        )
      ) {
        continue;
      }
      const replay = yield* abortable(signal => collectBytes(protocol.exc.replay(retained.said!, signal)));
      const [frame] = parseBytes(replay);
      const foot = yield* abortable(signal => collectPayload(attachmentPayload(frame), signal));
      return [retained, foot] as const;
    }
    throw new ValidationError("Accepted registry anchor has no retained exact local approval.");
  }
  if (!authored && (anchor.sn !== group.kever.sn + 1 || anchor.prior !== group.kever.serder.said)) {
    throw new ValidationError("Registry anchor does not extend the current group event.");
  }
  const keys = groupEventKeys(hby, group.pre, anchor);
  const sigers = signLocalGroupEvent(hby, anchor, groupSigningMembers(hby, group.pre), keys);
  const own = messagize(anchor, { sigers, gvrsn: Vrsn_2_0 });
  const tel = concatBytes(
    event.raw,
    Counter.enclose({
      code: "AttachmentGroup",
      version: Vrsn_2_0,
      qb64: opening ? publicOpeningAttachment(opening) : new Uint8Array(),
    }),
  );
  const input = new Reactor(protocol);
  yield* input.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), tel), { local: true });
  yield* input.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), own), { local: true });
  const proposal = yield* prepareAcdcV2RegistryExn(member.pre, tel, own, registry.store);
  const signed = signGroupMessage(member, "", proposal);
  yield* input.processBytes(signed.message, { local: true });
  yield* protocol.processEscrowsOnce();
  return [proposal[0], signed.message.subarray(proposal[0].raw.length)] as const;
}

/** Publish this member's exact approved TEL/anchor wrapper; the caller runs and joins delivery. */
export function* publishAcdcV2Registry(
  hby: Habery,
  postman: Poster,
  group: Hab,
  approval: MultisigMessage,
): Operation<GroupSendResult> {
  const member = localGroupMember(hby, group.pre), outcomes: GroupDelivery[] = [];
  const wire = concatBytes(approval[0].raw, approval[1]);
  for (const recipient of remoteGroupMembers(hby, member, groupSigningMembers(hby, group.pre))) {
    const evt = postman.sendStream({ src: member.pre, dest: recipient, msgs: [wire], topic: "multisig" }, {
      notify: true,
    });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    outcomes.push({
      recipient,
      exnSaid: approval[0].said!,
      payloadSaid: (approval[0].sad!.a as { anc: string }).anc,
      deliveries: outcome.deliveries,
    });
  }
  return groupSendResult(outcomes);
}

export type MultisigKelRoute =
  | typeof MULTISIG_ICP_ROUTE
  | typeof MULTISIG_ROT_ROUTE
  | typeof MULTISIG_IXN_ROUTE;
export type MultisigVdrRoute = typeof MULTISIG_VCP_ROUTE | typeof MULTISIG_ISS_ROUTE | typeof MULTISIG_REV_ROUTE;
export type MultisigRpyRoute = typeof MULTISIG_RPY_ROUTE;
export type MultisigProposalRoute =
  | MultisigKelRoute
  | MultisigVdrRoute
  | MultisigRpyRoute
  | typeof MULTISIG_RIP_ROUTE
  | typeof MULTISIG_BUP_ROUTE;

/** Decoded child and membership fields consumed by KEL approval policy; child proofs are verified during intake. */
export type KelApproval = MultisigChild & {
  group: string;
  proposal: Extract<MultisigEventProposal, { route: MultisigKelRoute }>;
};

export interface ApprovalResult extends GroupSendResult {
  /** Present for VCP/ISS/REV: exact TEL coordinates and local publication, separate from business acceptance and member delivery. */
  tel?: { pre: string; sn: number; publicationComplete: boolean };
  route: MultisigProposalRoute;
  said: string;
  embedded: string;
  group: string;
  accepted: boolean;
}

export interface ApprovalPromptContext {
  route: string;
  group: string;
  embedded: string;
}

export interface MultisigApprovalCallbacks {
  approveProposal(context: ApprovalPromptContext): boolean;
  chooseGroupAlias(groupPre: string): string;
  chooseRegistryName(regk: string): string;
}

/** Collaborators KEL and reply approval need; an `AgentRuntime` fits, and no host is required to have one. */
export interface ApprovalChannels {
  readonly exc: Exchanger;
  readonly reactor: Reactor;
  readonly protocol: ProtocolProcessor;
  readonly postman: Poster;
}

export interface MultisigApprovalOptions {
  group?: string;
  said?: string;
  callbacks: MultisigApprovalCallbacks;
}

interface NoticeLike {
  rid: string;
  attrs: { r?: unknown; d?: unknown };
}

/**
 * Publish a route-correlated event proposal; grouping owns child identity and label derivation.
 *
 * @param hby Borrowed group identities and accepted state.
 * @param protocol Shared semantic owner; this publication owns its byte-input context.
 * @param postman Borrowed delivery owner; the caller runs and joins its worker.
 * @param member Local member signing habitat, distinct from the group AID.
 * @param recipients Member AIDs; local recipients are skipped.
 * @param proposal Route-correlated group proposal with its named business fields.
 * @param embeddedMessage Signed child wire to include under the route-derived label.
 * @param childGvrsn Optional explicit attachment genus for the child.
 * @param wrapperVersion Optional wrapper protocol version; an approval mirrors its proposal's.
 * @returns Stable proposal/wrapper identities and completed deliveries, independent of group acceptance.
 */
export function* publishProposal(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  member: Hab,
  recipients: readonly string[],
  proposal: MultisigEventProposal,
  embeddedMessage: Uint8Array,
  childGvrsn?: Versionage,
  wrapperVersion?: Versionage,
): Operation<GroupSendResult> {
  const input = new Reactor(protocol);
  const outcomes: GroupDelivery[] = [];
  for (const recipient of remoteGroupMembers(hby, member, recipients)) {
    const destination = new Organizer(hby.db, hby.signator).resolveRecipient(recipient);
    const prepared = yield* prepareMultisigEventExn(member.pre, proposal, embeddedMessage, {
      recipient: destination,
      childGvrsn,
      ...(wrapperVersion ? { pvrsn: wrapperVersion } : {}),
    });
    const signed = yield* prepareGroupMessage(protocol.exc, member, destination, prepared);
    outcomes.push(yield* admitAndSendGroupMessage(input, postman, signed));
  }
  return groupSendResult(outcomes);
}

/** Publish typed registry evidence, processing each exact local wrapper before delivery. */
function* publishVdrProposal(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  member: Hab,
  recipients: readonly string[],
  proposal: MultisigVdrProposal,
): Operation<GroupSendResult> {
  const input = new Reactor(protocol);
  const outcomes: GroupDelivery[] = [];
  for (const recipient of remoteGroupMembers(hby, member, recipients)) {
    const destination = new Organizer(hby.db, hby.signator).resolveRecipient(recipient);
    const prepared = prepareMultisigVdrExn(member.pre, proposal, { recipient: destination });
    const signed = yield* prepareGroupMessage(protocol.exc, member, destination, prepared);
    outcomes.push(yield* admitAndSendGroupMessage(input, postman, signed));
  }
  return groupSendResult(outcomes);
}

/** True when a KEL event is accepted locally. */
/**
 * Commit the members of a locally accepted group establishment event.
 *
 * Only the current latest establishment event commits; replaying an older
 * approval must not restore historical group membership. Returns whether the
 * members were committed.
 */
export function commitAcceptedGroupMembers(
  hby: Habery,
  serder: SerderKERI,
  smids: readonly string[],
  rmids: readonly string[],
): boolean {
  const pre = serder.pre;
  if (!pre || !eventAccepted(hby, serder) || hby.db.getKever(pre)?.lastEst.d !== serder.said) {
    return false;
  }
  hby.commitGroupHabMembers(pre, smids, rmids.length > 0 ? rmids : smids);
  return true;
}

export function eventAccepted(hby: Habery, serder: SerderKERI): boolean {
  const pre = serder.pre;
  const said = serder.said;
  const sn = serder.sn;
  if (!pre || !said || sn === null) {
    return false;
  }
  return hby.db.kels.getLast(pre, sn) === said;
}

export function routeForKelEvent(serder: SerderKERI): MultisigKelRoute | null {
  switch (serder.ilk) {
    case Ilks.icp:
    case Ilks.dip:
      return MULTISIG_ICP_ROUTE;
    case Ilks.rot:
    case Ilks.drt:
      return MULTISIG_ROT_ROUTE;
    case Ilks.ixn:
      return MULTISIG_IXN_ROUTE;
    default:
      return null;
  }
}

/**
 * Select accepted coordination evidence before any approval effects.
 * An explicit SAID names the outer EXN and survives notification consumption.
 * Notices discover candidates; their attributes do not authorize a route or group.
 * An explicit accepted wrapper missing its handler index is replayed by the caller.
 */
function* pendingMultisigProposals(
  hby: Habery,
  runtime: AgentRuntime,
  notices: readonly NoticeLike[],
  options: MultisigApprovalOptions,
): Operation<{ exn: SerderKERI; route: MultisigProposalRoute; indexed: boolean }[]> {
  const candidates = options.said ? [options.said] : notices.map(note => note.attrs.d);
  const group = options.group && (hby.habByName(options.group)?.pre ?? options.group);
  const selected: { exn: SerderKERI; route: MultisigProposalRoute; indexed: boolean }[] = [];
  for (const said of new Set(candidates)) {
    if (typeof said !== "string") continue;
    const exn = hby.db.exns.get([said]);
    if (!exn?.ked) continue;
    const route = exn.route ?? "";
    if (!isKelRoute(route) && !isVdrRoute(route) && route !== MULTISIG_RPY_ROUTE && !isV2RegistryRoute(route)) {
      continue;
    }
    const payloadSaid = multisigPayloadSaid(exn);
    if (!payloadSaid) continue;
    const indexed = hby.db.meids.get([payloadSaid]).some(index => index.qb64 === said);
    if (!indexed && !options.said) continue;
    const proposalGroup = isKelRoute(route)
      ? kelApproval(exn, route, yield* kelChild(hby, runtime, exn, route))?.group
      : stringField(payloadSection(exn.ked), "gid");
    if (!proposalGroup) continue;
    if (group && group !== proposalGroup) {
      if (options.said) {
        throw new ValidationError(`Multisig exchange ${said} belongs to group ${proposalGroup}, not ${group}.`);
      }
      continue;
    }
    selected.push({ exn, route, indexed });
  }
  return selected;
}

/** Approve matching stored evidence; host progress and deadlines belong to the caller. */
export function* approvePendingMultisigProposal(
  hby: Habery,
  runtime: AgentRuntime,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  const notifier = runtime.notifier;
  if (!notifier && !options.said) {
    throw new ValidationError("Multisig join requires notification storage or an explicit exchange SAID.");
  }
  const notices = (notifier?.list(0, 100) ?? []) as NoticeLike[];
  for (const { exn, route, indexed } of yield* pendingMultisigProposals(hby, runtime, notices, options)) {
    if (!indexed) {
      // Acceptance commits before the asynchronous handler. Resume that ordinary
      // authenticated intake after interruption; never synthesize approval indexes.
      const message = yield* abortable(signal => collectBytes(runtime.exc.replay(exn.said!, signal)));
      yield* runtime.reactor.processBytes(message, { local: true });
      const payloadSaid = multisigPayloadSaid(exn)!;
      if (!hby.db.meids.get([payloadSaid]).some(index => index.qb64 === exn.said)) continue;
    }
    const rgy = isVdrRoute(route) ? runtime.vdr : null;
    let result: ApprovalResult | null;
    if (isKelRoute(route)) {
      result = yield* approveKelProposal(hby, runtime, exn, route, options);
    } else if (isVdrRoute(route)) {
      result = yield* approveVdrProposal(hby, rgy, runtime, exn, route, options);
    } else if (isV2RegistryRoute(route)) {
      const nests = loadNests(hby.db, exn.said!);
      const proposal = acdcV2RegistryProposal(exn, nests, runtime.acdc?.store ?? null);
      const group = proposal?.anchor.pre ? hby.habs.get(proposal.anchor.pre) : null;
      if (!proposal || !group) continue;
      const head = group.kever?.serder.said;
      if (!head) throw new ValidationError("Registry approval requires an accepted local group.");
      if (!options.callbacks.approveProposal({ route, group: group.pre, embedded: proposal.tel.said! })) continue;
      if (group.kever?.serder.said !== head || !acdcV2RegistryProposal(exn, nests, runtime.acdc?.store ?? null)) {
        throw new ValidationError("Group or registry changed while approval was pending.");
      }
      const envelope = envelopeFromFrame(nests[0]), opening = [...envelope.bsqs, ...envelope.bsss];
      if (opening.length > 1) throw new ValidationError("Registry proposal carries multiple openings.");
      const approval = yield* approveAcdcV2Registry(hby, runtime.protocol, group, proposal.tel, {
        anchor: proposal.anchor,
        opening: opening[0],
      });
      const published = yield* publishAcdcV2Registry(hby, runtime.postman, group, approval);
      const regid = proposal.tel.ilk === "rip" ? proposal.tel.said! : proposal.tel.regid!;
      const accepted =
        runtime.acdc!.store.seqEvent(regid, Number(BigInt(`0x${proposal.tel.sad!.n}`)))?.said === proposal.tel.said;
      result = { route, said: exn.said!, embedded: proposal.tel.said!, group: group.pre, accepted, ...published };
    } else {
      result = yield* approveRpyProposal(hby, runtime, exn, route, options);
    }
    if (result) {
      for (const note of notices) {
        if (note.attrs.d === exn.said) notifier?.remove(note.rid);
      }
      return result;
    }
  }
  return null;
}

/**
 * Approve and publish a local contribution to one endpoint-role reply proposal.
 * Validate required child evidence before signing, process the local contribution,
 * and await concrete member deliveries. Transmission is not group acceptance.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param exn Stored multisig exchange wrapper.
 * @param route Selected multisig route identifying the proposal kind.
 * @param options Human approval/alias callbacks and workflow choices; refusal leaves the proposal inert.
 * @returns Approval result with protocol acceptance and deliveries, or null for declined/incomplete input.
 */
export function* approveRpyProposal(
  hby: Habery,
  runtime: ApprovalChannels,
  exn: SerderKERI,
  route: MultisigRpyRoute,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const payload = payloadSection(exn.ked ?? {});
  const groupPre = requireText(stringField(payload, "gid") || undefined, "Group prefix");
  const groupHab = hby.habs.get(groupPre);
  if (!groupHab) {
    throw new ValidationError(`Group ${groupPre} must be joined before approving ${route}.`);
  }
  const member = localGroupMember(hby, groupPre);
  const child = yield* replyChild(hby, runtime, exn);
  if (!child) return null;
  const { event: rpySerder, attachment, genus } = child;
  const embeddedSaid = rpySerder.said ?? "";
  const prior = storedGroupMessage(hby.db, member.pre, exn);
  if (!prior && !options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid || "<unknown>" })) {
    return null;
  }

  yield* runtime.reactor.processBytes(
    concatBytes(Counter.makeGVC(genus), rpySerder.raw, attachment),
    { local: true },
  );

  let localRpy: Uint8Array;
  if (prior) {
    const retained = yield* replyChild(hby, runtime, prior);
    if (!retained || retained.event.said !== embeddedSaid || !retained.attachment.length) {
      throw new ValidationError(`Stored multisig approval ${prior.said} lacks its rpy contribution.`);
    }
    localRpy = concatBytes(retained.event.raw, retained.attachment);
  } else localRpy = groupEndorseReply(hby, groupPre, rpySerder, genus);
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), localRpy), { local: true });
  yield* runtime.protocol.processEscrowsOnce();

  const attrs = rpyAttrs(rpySerder);
  const publication = yield* publishProposal(
    hby,
    runtime.protocol,
    runtime.postman,
    member,
    groupSigningMembers(hby, groupPre),
    { route, attrs: { gid: groupPre } },
    localRpy,
    genus,
  );
  const accepted = endpointRoleAccepted(hby, attrs.cid, attrs.role, attrs.eid);

  return { route, said: wrapperSaid, embedded: embeddedSaid, group: groupPre, accepted, ...publication };
}

/**
 * Approve and publish a local contribution to one KEL event proposal.
 * Validate required child evidence before signing, process the local contribution,
 * and await concrete member deliveries. Transmission is not group acceptance.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param exn Stored multisig exchange wrapper.
 * @param route Selected multisig route identifying the proposal kind.
 * @param options Human approval/alias callbacks and workflow choices; refusal leaves the proposal inert.
 * @returns Approval result with protocol acceptance and deliveries, or null for declined/incomplete input.
 */
export function* approveKelProposal(
  hby: Habery,
  runtime: ApprovalChannels,
  exn: SerderKERI,
  route: MultisigKelRoute,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const selected = kelApproval(exn, route, yield* kelChild(hby, runtime, exn, route));
  if (!selected) return null;
  const member = selected.proposal.route === MULTISIG_IXN_ROUTE
    ? localGroupMember(hby, selected.group)
    : findLocalMember(hby, kelApprovalMembers(selected));
  if (!member) {
    throw new ValidationError(`No local member found for multisig proposal ${wrapperSaid}.`);
  }
  const prior = storedGroupMessage(hby.db, member.pre, exn);
  // A resume reuses the member's recorded membership choices as well as its
  // child signatures; a later peer wrapper cannot replace that decision.
  const approval = prior ? kelApproval(prior, route, yield* kelChild(hby, runtime, prior, route)) : selected;
  if (!approval || approval.group !== selected.group || approval.event.said !== selected.event.said) {
    throw new ValidationError(`Stored multisig approval does not match ${wrapperSaid}.`);
  }
  const { event: serder, group: groupPre, proposal } = approval;
  const { smids } = proposal.attrs;
  const embeddedSaid = serder.said;
  const members = kelApprovalMembers(approval);
  let localMessage: Uint8Array;
  if (prior) {
    // The resumed approval was decoded from this member's own recorded wrapper and child proof.
    if (!approval.attachment.length) {
      throw new ValidationError(
        `Stored multisig approval ${prior.said} lacks its ${kelProposalLabel(route)} contribution.`,
      );
    }
    localMessage = concatBytes(serder.raw, approval.attachment);
  } else {
    // A proposal already accepted locally that names no local signing member (for example
    // an earlier rotation that only committed to this member's next key) has nothing to
    // approve. Skip it so a later proposal for the same group can be selected.
    if (eventAccepted(hby, serder) && !smids.some(mid => hby.habs.has(mid))) {
      return null;
    }
    // Signing writes the member's signatures to `sigs.` when the event is first
    // processed, before any wrapper exists. Finding them means consent was given and
    // the group joined in an earlier attempt: reuse them, never prompt or sign again.
    const signed = recordedLocalSignatures(hby, serder, groupPre, smids);
    if (signed) {
      localMessage = messagize(serder, { sigers: signed, pipelined: false, gvrsn: approval.genus });
    } else {
      if (!options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid ?? "<unknown>" })) {
        return null;
      }
      if (proposal.route === MULTISIG_ICP_ROUTE || (proposal.route === MULTISIG_ROT_ROUTE && !hby.habs.has(groupPre))) {
        const rmids = proposal.attrs.rmids;
        const alias = options.callbacks.chooseGroupAlias(groupPre);
        hby.joinGroupHab(groupPre, alias, member, smids, rmids.length > 0 ? rmids : smids);
      }
      const keys = groupEventKeys(hby, groupPre, serder);
      const sigers = signLocalGroupEvent(hby, serder, smids, keys);
      localMessage = messagize(serder, { sigers, pipelined: false, gvrsn: approval.genus });
    }
  }
  // Each contribution may already own a counted attachment enclosure. Admit
  // complete messages separately and let the ordinary KEL owner union proofs.
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(approval.genus), localMessage), { local: true });
  yield* runtime.reactor.processBytes(
    concatBytes(Counter.makeGVC(approval.genus), serder.raw, approval.attachment),
    { local: true },
  );
  yield* runtime.protocol.processEscrowsOnce();

  const publication = yield* publishProposal(
    hby,
    runtime.protocol,
    runtime.postman,
    member,
    members,
    proposal,
    localMessage,
    approval.genus,
    // KERIpy indexes contributions by wrapper form (v1 `e` SAID, v2 child SAID), so an
    // approval must reuse its proposal's wrapper version for the proposer to merge it.
    exn.pvrsn,
  );
  const accepted = eventAccepted(hby, serder);
  if (proposal.route !== MULTISIG_IXN_ROUTE) {
    commitAcceptedGroupMembers(hby, serder, smids, proposal.attrs.rmids);
  }

  return { route, said: wrapperSaid, embedded: embeddedSaid ?? "", group: groupPre, accepted, ...publication };
}

/**
 * Approve and publish a local contribution to one registry/credential TEL proposal.
 * Validate required child evidence before signing, process the local contribution,
 * and await concrete member deliveries. Transmission is not group acceptance.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param rgy Borrowed legacy registry owner, or null; required only after a valid proposal is approved.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param exn Stored multisig exchange wrapper.
 * @param route Selected multisig route identifying the proposal kind.
 * @param options Human approval/alias callbacks and workflow choices; refusal leaves the proposal inert.
 * @returns Approval result with protocol acceptance and deliveries, or null for declined/incomplete input.
 */
function* approveVdrProposal(
  hby: Habery,
  rgy: Regery | null,
  runtime: AgentRuntime,
  exn: SerderKERI,
  route: MultisigVdrRoute,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const payload = payloadSection(exn.ked ?? {});
  const groupPre = requireText(stringField(payload, "gid") || undefined, "Group prefix");
  const groupHab = hby.habs.get(groupPre);
  if (!groupHab) {
    throw new ValidationError(`Group ${groupPre} must be joined before approving ${route}.`);
  }
  const member = localGroupMember(hby, groupPre);
  const embed = embeddedSection(exn.ked ?? {});
  const label = vdrProposalLabel(route);
  const embeddedSad = embed?.[label];
  const anchor = multisigChild(hby, exn, "anc");
  if (!isRecord(embeddedSad) || !anchor) {
    return null;
  }
  if (anchor.event.pre !== groupPre) return null;

  const embeddedSerder = new SerderKERI({ sad: embeddedSad });
  // Required children must be decoded before approval can sign or accept the anchor.
  const acdcSad = embed?.acdc;
  let proposal:
    | { route: typeof MULTISIG_VCP_ROUTE }
    | { route: typeof MULTISIG_REV_ROUTE }
    | { route: typeof MULTISIG_ISS_ROUTE; credential: SerderACDC };
  if (route !== MULTISIG_ISS_ROUTE) {
    proposal = { route };
  } else {
    if (!isRecord(acdcSad)) return null;
    proposal = { route, credential: new SerderACDC({ sad: acdcSad }) };
  }
  const { event: anchorSerder, attachment, genus } = anchor;
  const embeddedSaid = embeddedSerder.said ?? "";
  if (proposal.route === MULTISIG_VCP_ROUTE) {
    validateRegistryProposal(groupPre, embeddedSerder, anchorSerder);
  } else if (proposal.route === MULTISIG_REV_ROUTE) {
    if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
    const said = requireText(stringField(payload, "said") || undefined, "Credential SAID");
    if (!validateCredentialRevocationProposal(rgy, groupPre, said, embeddedSerder, anchorSerder)) return null;
  } else {
    if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
    const evidence = multisigChildEvidence(hby, exn, "acdc", proposal.credential);
    if (!evidence.attachment.length) return null;
    validateCredentialSource(proposal.credential, embeddedSerder, evidence.attachment, evidence.genus);
    if (!validateCredentialIssueProposal(rgy, groupPre, proposal.credential, embeddedSerder, anchorSerder)) return null;
  }
  const prior = storedGroupMessage(hby.db, member.pre, exn);
  if (!prior && !groupCredentialAnchorReady(hby, groupPre, anchorSerder)) return null;
  if (!prior && !options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid || "<unknown>" })) {
    return null;
  }

  // Declined or malformed proposals remain inert; require VDR before signing or intake.
  if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");

  let registryName: string | undefined;
  if (proposal.route === MULTISIG_VCP_ROUTE && !prior) {
    registryName = options.callbacks.chooseRegistryName(embeddedSerder.pre!);
    validateRegistryName(rgy.reger, registryName, embeddedSerder.pre!);
  }
  const smids = groupSigningMembers(hby, groupPre);
  let localAnchor: Uint8Array;
  if (prior) {
    localAnchor = storedContribution(hby, prior, "anc", anchorSerder.said!);
  } else {
    const keys = groupEventKeys(hby, groupPre, anchorSerder);
    const sigers = signLocalGroupEvent(hby, anchorSerder, smids, keys);
    localAnchor = messagize(anchorSerder, { sigers, pipelined: false, gvrsn: genus });
  }
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), localAnchor), { local: true });
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), anchorSerder.raw, attachment), {
    local: true,
  });
  yield* runtime.protocol.processEscrowsOnce();

  let accepted = false;
  let publication: MultisigVdrProposal;
  const attrs = { gid: groupPre, ...multisigChildGenusAttrs(anchorSerder, genus) };
  if (proposal.route === MULTISIG_VCP_ROUTE) {
    accepted = approveRegistryIncept(rgy, groupHab, embeddedSerder, anchorSerder, registryName);
    publication = {
      route: proposal.route,
      attrs: { ...attrs, ...(typeof payload.usage === "string" ? { usage: payload.usage } : {}) },
      embeds: { vcp: embeddedSerder.raw, anc: localAnchor },
    };
  } else if (proposal.route === MULTISIG_REV_ROUTE) {
    const seal = sourceSeal(anchorSerder);
    rgy.tvy.processEvent({ serder: embeddedSerder, seqner: seal.seqner, saider: seal.saider });
    rgy.processEscrows();
    rgy.publication.track(embeddedSerder, anchorSerder);
    accepted = telAccepted(rgy.reger, embeddedSerder.pre!, embeddedSerder.sn!, embeddedSerder.said!);
    publication = {
      route: proposal.route,
      attrs: { ...attrs, said: embeddedSerder.pre! },
      embeds: { rev: embeddedSerder.raw, anc: localAnchor },
    };
  } else {
    const creder = proposal.credential;
    accepted = approveCredentialIssue(rgy, creder, embeddedSerder, anchorSerder);
    const seal = telCredentialSeal(embeddedSerder);
    publication = {
      route: proposal.route,
      attrs,
      embeds: {
        acdc: serializeCredential(creder, seal.prefixer, seal.seqner, seal.saider, genus),
        iss: embeddedSerder.raw,
        anc: localAnchor,
      },
    };
  }

  const published = yield* publishVdrProposal(hby, runtime.protocol, runtime.postman, member, smids, publication);
  return {
    route,
    said: wrapperSaid,
    embedded: embeddedSaid,
    group: groupPre,
    accepted,
    tel: {
      pre: embeddedSerder.pre!,
      sn: embeddedSerder.sn!,
      publicationComplete: rgy.publication.complete(embeddedSerder.pre!, embeddedSerder.sn!),
    },
    ...published,
  };
}

/**
 * This process's verified signatures for a group event, one per local signing
 * member, read from `sigs.`; null unless every local member's key index has one.
 * Remote members' signatures in the same row never count.
 */
function recordedLocalSignatures(
  hby: Habery,
  serder: SerderKERI,
  groupPre: string,
  smids: readonly string[],
): Siger[] | null {
  if (!hby.habs.has(groupPre) || !serder.pre || !serder.said) return null;
  const local = smids.flatMap((mid, index) => hby.habs.has(mid) ? [index] : []);
  const stored = hby.db.sigs.get(dgKey(serder.pre, serder.said));
  if (local.length === 0 || stored.length === 0) return null;
  const verfers = groupEventKeys(hby, groupPre, serder).map(qb64 => new Verfer({ qb64 }));
  const { sigers } = Kever.verifyIndexedSignatures(serder.raw, stored, verfers);
  const own = sigers.filter(siger => local.includes(siger.index));
  return local.every(index => own.some(siger => siger.index === index))
    ? own.sort((left, right) => left.index - right.index)
    : null;
}

/** Preserve the recorded signing/rotation participant order during approval and resume. */
export function kelApprovalMembers({ proposal }: KelApproval): string[] {
  if (proposal.route === MULTISIG_IXN_ROUTE) return [...proposal.attrs.smids];
  return uniqueMembers([...proposal.attrs.smids, ...proposal.attrs.rmids]);
}

/** Revalidate v2 nested reply commitments through ordinary exchange admission before reading proofs. */
function replyChild(hby: Habery, runtime: ApprovalChannels, wrapper: SerderKERI): Operation<MultisigChild | null> {
  return nestedChild(hby, runtime, wrapper, MULTISIG_RPY_ROUTE, "rpy");
}

/** Read a KEL proposal's named v1 embed, or its v2 nested child after authenticated wrapper admission. */
function kelChild(
  hby: Habery,
  runtime: ApprovalChannels,
  wrapper: SerderKERI,
  route: MultisigKelRoute,
): Operation<MultisigChild | null> {
  return nestedChild(hby, runtime, wrapper, route, kelProposalLabel(route));
}

/** v1 reads the named pathed embed; v2 reads the first nest of an accepted wrapper with its own proof. */
function* nestedChild(
  hby: Habery,
  runtime: ApprovalChannels,
  wrapper: SerderKERI,
  route: MultisigKelRoute | typeof MULTISIG_RPY_ROUTE,
  label: string,
): Operation<MultisigChild | null> {
  if (wrapper.pvrsn.major === 1) return multisigChild(hby, wrapper, label);
  if (!wrapper.said || !runtime.exc.verifyAccepted(wrapper.said, route)) return null;
  const [child] = loadNests(hby.db, wrapper.said);
  if (!(child?.body instanceof SerderKERI)) return null;
  const attachment = yield* abortable(signal => collectPayload(attachmentPayload(child), signal));
  return { event: child.body, attachment, genus: child.gvrsn ?? child.body.gvrsn ?? child.body.pvrsn };
}

/** Reuse a recorded member's child proof; never sign a replacement during resume. */
function storedContribution(hby: Habery, wrapper: SerderKERI, label: string, said: string): Uint8Array {
  const child = multisigChild(hby, wrapper, label);
  if (!child || child.event.said !== said || child.attachment.length === 0) {
    throw new ValidationError(`Stored multisig approval ${wrapper.said} lacks its ${label} contribution.`);
  }
  return concatBytes(child.event.raw, child.attachment);
}

/** VDR coordination keeps KERIpy's named child for each legacy route. */
function vdrProposalLabel(route: MultisigVdrRoute): "vcp" | "iss" | "rev" {
  switch (route) {
    case MULTISIG_VCP_ROUTE:
      return "vcp";
    case MULTISIG_ISS_ROUTE:
      return "iss";
    case MULTISIG_REV_ROUTE:
      return "rev";
  }
}

/** The supported route determines its one named KEL child. */
function kelProposalLabel(route: MultisigKelRoute): "icp" | "rot" | "ixn" {
  switch (route) {
    case MULTISIG_ICP_ROUTE:
      return "icp";
    case MULTISIG_ROT_ROUTE:
      return "rot";
    case MULTISIG_IXN_ROUTE:
      return "ixn";
  }
}

/** Decode the fields used by approval, preserving existing missing-embed and member-list behavior. */
export function kelApproval(exn: SerderKERI, route: MultisigKelRoute, child: MultisigChild | null): KelApproval | null {
  if (!child) return null;
  const { event } = child;
  const attrs: unknown = exn.ked?.a;
  const payload = isRecord(attrs) ? attrs : {};
  const group = requireText(
    route === MULTISIG_ICP_ROUTE
      ? event.pre ?? undefined
      : (typeof payload.gid === "string" ? payload.gid : "") || event.pre || undefined,
    "Group prefix",
  );
  // Approval must name the same group whose event we will sign.
  if (group !== event.pre) return null;
  const smids = stringArrayField(payload, "smids");
  if (route === MULTISIG_IXN_ROUTE) {
    return { ...child, group, proposal: { route, attrs: { gid: group, smids } } };
  }
  const rmids = stringArrayField(payload, "rmids");
  const proposal: KelApproval["proposal"] = route === MULTISIG_ICP_ROUTE
    ? {
      route,
      attrs: { smids, rmids, ...(typeof payload.delegator === "string" ? { delegator: payload.delegator } : {}) },
    }
    : { route, attrs: { gid: group, smids, rmids } };
  return { ...child, group, proposal };
}

function approveRegistryIncept(
  rgy: Regery,
  groupHab: Hab,
  vserder: SerderKERI,
  anchorSerder: SerderKERI,
  registryName: string | undefined,
): boolean {
  const seal = sourceSeal(anchorSerder);
  rgy.tvy.processEvent({ serder: vserder, seqner: seal.seqner, saider: seal.saider });
  rgy.processEscrows();

  const regk = requireSerderPrefix(vserder, "registry inception");
  if (registryName !== undefined) {
    const cnfg = stringArrayField(vserder.ked ?? {}, "c");
    registerRegistry(rgy, registryName, groupHab, regk, {
      estOnly: cnfg.includes(TraitDex.EstOnly),
    });
  }

  const eventSaid = requireSerderSaid(vserder, "registry inception");
  rgy.publication.track(vserder, anchorSerder);
  return telAccepted(rgy.reger, regk, 0, eventSaid);
}

function approveCredentialIssue(
  rgy: Regery,
  creder: SerderACDC,
  iserder: SerderKERI,
  anchorSerder: SerderKERI,
): boolean {
  const { hby } = rgy;
  const seal = sourceSeal(anchorSerder);
  rgy.tvy.processEvent({ serder: iserder, seqner: seal.seqner, saider: seal.saider });
  rgy.processEscrows();

  const reger = rgy.reger;
  const vry = rgy.vry;
  const credentialer = new Credentialer(hby, { reger, vry });
  const credentialSeal = telCredentialSeal(iserder);
  const verifierDecision = vry.processCredential({
    creder,
    prefixer: credentialSeal.prefixer,
    seqner: credentialSeal.seqner,
    saider: credentialSeal.saider,
  });
  if (verifierDecision.kind === "accept") {
    reger.ccrd.pin(requireCredentialSaid(creder), creder);
  }
  vry.processEscrows();

  rgy.publication.track(iserder, anchorSerder);
  return credentialer.complete(requireCredentialSaid(creder))
    || reger.saved.get([requireCredentialSaid(creder)]) !== null;
}

function registerRegistry(
  rgy: Regery,
  name: string,
  hab: Hab,
  regk: string,
  options: { estOnly: boolean },
): void {
  rgy.reger.registries.add(regk);
  rgy.reger.regs.pin(name, new RegistryRecord({ registryKey: regk, prefix: hab.pre }));
  if (!rgy.registries.has(name)) {
    rgy.registries.set(
      name,
      new Registry({
        publication: rgy.publication,
        name,
        hab,
        reger: rgy.reger,
        tvy: rgy.tvy,
        cues: rgy.cues,
        regk,
        estOnly: options.estOnly,
      }),
    );
  }
}

function sourceSeal(serder: SerderKERI): { seqner: NumberPrimitive; saider: Diger } {
  return { seqner: ordinal(serder.sn ?? 0), saider: new Diger({ qb64: requireSerderSaid(serder, "anchor event") }) };
}

function telCredentialSeal(serder: SerderKERI): { prefixer: Prefixer; seqner: NumberPrimitive; saider: Diger } {
  return {
    prefixer: new Prefixer({ qb64: requireSerderPrefix(serder, "credential TEL event") }),
    seqner: ordinal(serder.sn ?? 0),
    saider: new Diger({ qb64: requireSerderSaid(serder, "credential TEL event") }),
  };
}

function ordinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function requireSerderPrefix(serder: SerderKERI, label: string): string {
  if (!serder.pre) {
    throw new ValidationError(`${label} is missing prefix.`);
  }
  return serder.pre;
}

function requireSerderSaid(serder: SerderKERI, label: string): string {
  if (!serder.said) {
    throw new ValidationError(`${label} is missing SAID.`);
  }
  return serder.said;
}

function requireCredentialSaid(creder: SerderACDC): string {
  if (!creder.said) {
    throw new ValidationError("Credential is missing SAID.");
  }
  return creder.said;
}

function telAccepted(reger: Reger, pre: string, sn: number, eventSaid: string): boolean {
  return reger.tels.getOn(pre, sn)?.qb64 === eventSaid;
}

function rpyAttrs(serder: SerderKERI): { cid: string; role: string; eid: string } {
  const attrs: unknown = serder.ked?.a;
  if (
    !attrs || typeof attrs !== "object"
    || !("cid" in attrs) || typeof attrs.cid !== "string" || !attrs.cid
    || !("role" in attrs) || typeof attrs.role !== "string" || !attrs.role
    || !("eid" in attrs) || typeof attrs.eid !== "string" || !attrs.eid
  ) {
    throw new ValidationError("Multisig reply is missing cid, role, or eid.");
  }
  return { cid: attrs.cid, role: attrs.role, eid: attrs.eid };
}

export function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ked.a) ? ked.a : {};
}

function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(ked.e)) {
    return ked.e;
  }
  const attrs = payloadSection(ked);
  return isRecord(attrs.e) ? attrs.e : null;
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isKelRoute(route: string): route is MultisigKelRoute {
  return route === MULTISIG_ICP_ROUTE || route === MULTISIG_ROT_ROUTE || route === MULTISIG_IXN_ROUTE;
}

export function isVdrRoute(route: string): route is MultisigVdrRoute {
  return route === MULTISIG_VCP_ROUTE || route === MULTISIG_ISS_ROUTE || route === MULTISIG_REV_ROUTE;
}

function requireText(value: string | undefined, label: string): string {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
  return value;
}
