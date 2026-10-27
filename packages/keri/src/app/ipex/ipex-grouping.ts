/**
 * Group IPEX workflow orchestration.
 *
 * This module owns multisig coordination around embedded `/ipex/*` messages.
 * CLI adapters supply parsed options and output/file handling; this service
 * signs, publishes and sends completed group IPEX messages. CLI orchestration
 * owns timed waits and worker lifetimes. Approval borrows explicit semantic,
 * delivery and credential owners; its byte-input context belongs to the operation.
 */
import {
  type CesrFrame,
  type Cigar,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  nestedPayload,
  parseBytes,
  Prefixer,
  Seqner,
  type SerderACDC,
  SerderKERI,
  type Siger,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import { evaluateAcdcRelations } from "../../acdc/graphing.ts";
import type { RegistryState } from "../../acdc/regeventing.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { validateSchema } from "../../acdc/scheming.ts";
import { resolveAttachmentGvrsn } from "../../core/attachment-countering.ts";
import { TransIdxSigGroup } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import { verifyExchangeProofs } from "../../core/exchange/exchange-proofing.ts";
import { exchange, serializeMessage } from "../../core/exchange/protocol-exchanging.ts";
import { Kever } from "../../core/kel/kever.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import { messageAttachmentGroups } from "../../core/protocol-serialization.ts";
import type { Baser } from "../../db/basing.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import type { Reger } from "../../db/reger.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { groupMemberHasKey, groupSigningMembers, localGroupMember } from "../multisig/group-members.ts";
import {
  embeddedBusinessExnSAD,
  MULTISIG_EXN_ROUTE,
  multisigChild,
  multisigChildGenusAttrs,
} from "../multisig/grouping.ts";
import {
  type GroupDelivery,
  type GroupSendResult,
  groupSendResult,
  multisigPayloadSaid,
  prepareGroupMessage,
  remoteGroupMembers,
  sendGroupMessage,
  type SignedGroupMessage,
  storedGroupMessage,
} from "../multisig/multisig-messaging.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { Reactor } from "../protocol/reactor.ts";
import { abortable } from "../runtime/abortable.ts";
import { collectBytes } from "../transport/byte-source.ts";
import {
  credentialGrantReady,
  credentialPresentationSupportMessages,
  credentialSaidFromGrant,
  validateAdmitGrant,
} from "./ipex-credentialing.ts";
import { walkIpexGraph } from "./ipex-graph.ts";
import { authenticateIpexNode } from "./ipex-node-authentication.ts";
import { IPEX_ADMIT_ROUTE, IPEX_GRANT_ROUTE, ipexConversationReady, ipexRecipient } from "./ipexing.ts";

/** Authenticate the exact disclosed graph; only the existing evaluator's explicit true authorizes new use. */
function acdcV2GraphUse(
  hby: Habery,
  registry: RegistryStore | null,
  origin: string,
  nests: readonly CesrFrame[],
): boolean | null {
  const graph = walkIpexGraph(origin, nests, true, hby.db);
  if (graph && "kind" in graph) return null;
  if (!graph) throw new ValidationError("ACDC v2 group graph is malformed or incomplete.");
  const states = new Map<string, RegistryState>();
  for (const [said, node] of graph.nodes) {
    const schema = validateSchema(node.body, hby.db);
    if (schema.kind === "missing") return null;
    if (schema.kind === "invalid") throw new ValidationError("ACDC v2 group node violates its own schema.");
    const auth = authenticateIpexNode(node.body, envelopeFromFrame(node), hby.db, registry);
    if (auth.kind === "missing") return null;
    if (auth.kind !== "authenticated") throw new ValidationError("ACDC v2 group issuer proof is invalid.");
    if (auth.registration) states.set(said, auth.registration);
  }
  if (evaluateAcdcRelations(graph, hby.db, states) !== true) {
    throw new ValidationError("ACDC v2 group graph is false or unresolved.");
  }
  return true;
}
/** Current retained Grant authentication and graph truth are separate from protocol completion/history. */
function acdcV2GrantUse(
  hby: Habery,
  exchanger: Exchanger,
  registry: RegistryStore | null,
  said: string,
): boolean | null {
  const grant = hby.db.exns.get([said]);
  if (!grant || !exchanger.verifyAccepted(said, IPEX_GRANT_ROUTE)) return null;
  const origins = (grant.sad!.a as { o?: unknown }).o;
  if (!Array.isArray(origins) || origins.length !== 1 || typeof origins[0] !== "string") {
    throw new ValidationError("ACDC v2 group Grant requires one origin.");
  }
  return acdcV2GraphUse(hby, registry, origins[0], loadNests(hby.db, said));
}

/** Recheck current graph authorization at an accepted group's new delivery, output or consent action. */
export function requireAcdcV2GroupUse(hby: Habery, protocol: ProtocolProcessor, embedded: SerderKERI): void {
  const grant = embedded.route === IPEX_GRANT_ROUTE
    ? embedded.said
    : embedded.route === IPEX_ADMIT_ROUTE
    ? embedded.sad!.p
    : undefined;
  if (
    typeof grant === "string" && acdcV2GrantUse(hby, protocol.exc, protocol.registry?.store ?? null, grant) !== true
  ) {
    throw new ValidationError("ACDC v2 group graph is unavailable for completed use.");
  }
}
/** Approve exactly one ACDC v2 IPEX stream before adding this member's signature; no new acceptance rows are manufactured. */
export function* prepareAcdcV2GroupIpex(
  hby: Habery,
  protocol: ProtocolProcessor,
  group: Hab,
  raw: Uint8Array,
): Operation<Uint8Array | null> {
  const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), raw));
  const frame = frames[0], embedded = frame?.body;
  if (
    frames.length !== 1 || !(embedded instanceof SerderKERI) || embedded.pvrsn.major !== 2 || embedded.pre !== group.pre
    || !embedded.route?.startsWith("/ipex/")
  ) {
    throw new ValidationError("ACDC v2 group approval requires one exact group-authored IPEX message.");
  }
  localGroupMember(hby, group.pre);
  const envelope = envelopeFromFrame(frame);
  const prior = localIpexContribution(
    hby.db,
    localGroupMember(hby, group.pre).pre,
    embedded,
    rebuildStoredExchangeGroups(hby.db, embedded.said!),
  );
  if (!prior) {
    // A group candidate legitimately carries fewer than its final threshold.
    // Verify each supplied contribution against its accepted establishment keys;
    // the ordinary Exchanger still owns threshold completion after explicit approval.
    for (const proof of envelope.tsgs.filter(proof => proof.pre === group.pre)) {
      if (proof.sn > BigInt(Number.MAX_SAFE_INTEGER)) throw new ValidationError("Invalid group proof ordinal.");
      const said = hby.db.kels.getLast(group.pre, Number(proof.sn));
      const event = said ? hby.db.getEvtSerder(group.pre, said) : null;
      if (!event) return null;
      if (
        said !== proof.said || !event.estive
        || Kever.verifyIndexedSignatures(embedded.raw, proof.sigers, event.verfers).sigers.length
          !== proof.sigers.length
      ) {
        throw new ValidationError("Invalid group member contribution.");
      }
    }
    const supplied = verifyExchangeProofs(hby.db, embedded, {
      tsgs: envelope.tsgs.filter(proof => proof.pre !== group.pre),
      cigars: envelope.cigars,
      sourceSeals: envelope.ssts,
    });
    if (supplied.invalid) throw new ValidationError("ACDC v2 group candidate contains invalid exchange proof.");
    if (supplied.missing.length) return null;
    if (embedded.route === IPEX_GRANT_ROUTE) {
      const origins = (embedded.sad!.a as { o?: unknown }).o;
      if (!Array.isArray(origins) || origins.length !== 1 || typeof origins[0] !== "string") {
        throw new ValidationError("ACDC v2 group Grant requires one origin.");
      }
      if (acdcV2GraphUse(hby, protocol.registry?.store ?? null, origins[0], frame.nests ?? []) !== true) return null;
    } else if (embedded.route === IPEX_ADMIT_ROUTE) {
      if (
        typeof embedded.sad!.p !== "string"
        || acdcV2GrantUse(hby, protocol.exc, protocol.registry?.store ?? null, embedded.sad!.p) !== true
      ) return null;
    }
  }
  const establishment = group.kever!, sigers = prior ? prior.sigers : group.sign(embedded.raw, true);
  const proof = prior
    ?? new TransIdxSigGroup(
      new Prefixer({ qb64: group.pre }),
      hby.db.getEvtSerder(group.pre, establishment.lastEst.d)!.sner!,
      new Diger({ qb64: establishment.lastEst.d }),
      sigers,
    );
  const approved = {
    ...frame,
    attachments: [...frame.attachments, ...messageAttachmentGroups({ tsgs: [proof] }, Vrsn_2_0)],
  };
  const wire = yield* call(() => collectPayload(framePayload(approved, { gvrsn: Vrsn_2_0 })));
  yield* new Reactor(protocol).processBytes(wire, { local: true });
  yield* protocol.processEscrowsOnce();
  return wire;
}

export interface MultisigIpexApprovalOptions {
  publish?: boolean;
  sendLead?: boolean;
  gvrsn?: Versionage;
}

export interface MultisigIpexApprovalResult extends GroupSendResult {
  accepted: boolean;
  /** Null while this member lacks required evidence, even if other members completed the child. */
  approved: Uint8Array | null;
}

/**
 * Approve one pending multisig wrapper around an embedded IPEX message.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param protocol Borrowed semantic owner; this approval creates its own byte-input context.
 * @param postman Borrowed delivery owner; the caller runs and joins its worker.
 * @param reger Explicit legacy store, required for grant approval/delivery and fresh admit approval.
 * @param wrapper Accepted multisig exchange carrying the proposed IPEX child.
 * @param options Approval/genus policy used for the existing group workflow.
 * @returns Approval and current group/protocol completion information.
 */
export function* approveMultisigIpex(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  reger: Reger | null,
  wrapper: SerderKERI,
  options: MultisigIpexApprovalOptions = {},
): Operation<MultisigIpexApprovalResult> {
  const { child, groupHab } = loadIpexProposal(hby, wrapper);
  const { event: embedded, genus } = child;
  const embeddedSaid = embedded.said!;
  if (embedded.pvrsn.major === 1 && embedded.route === IPEX_GRANT_ROUTE && !reger) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  const payloadSaid = multisigPayloadSaid(wrapper);
  if (!payloadSaid) throw new ValidationError("Multisig IPEX approval requires its coordination identity.");
  if (!hby.db.meids.get([payloadSaid]).some(index => index.qb64 === wrapper.said)) {
    // Recover only this explicitly selected accepted wrapper after an interrupted
    // handler. Ordinary intake owns the index; do not synthesize it or sweep history.
    const message = yield* abortable(signal => collectBytes(protocol.exc.replay(wrapper.said!, signal)));
    yield* new Reactor(protocol).processBytes(message, { local: true });
    if (!hby.db.meids.get([payloadSaid]).some(index => index.qb64 === wrapper.said)) {
      throw new ValidationError("Selected IPEX wrapper was not indexed by ordinary intake.");
    }
  }
  const approved = yield* approveIpexChild(hby, protocol, groupHab, child, wrapper, reger);
  if (!approved) return { approved: null, accepted: protocol.exc.complete(embeddedSaid), messages: [], deliveries: [] };
  const publication = options.publish
    ? yield* publishGroupIpexProposal(hby, protocol, postman, groupHab, approved, genus)
    : { messages: [], deliveries: [] };
  const deliveries = publication.deliveries;
  if (
    (options.sendLead ?? true)
    && hby.db.exns.get([embeddedSaid])?.said === embeddedSaid
    && protocol.exc.lead(groupHab, embeddedSaid)
  ) {
    deliveries.push(
      ...(yield* sendCompletedGroupIpex(
        hby,
        postman,
        reger,
        groupHab,
        embedded,
        options.gvrsn,
        protocol.registry?.store ?? null,
        protocol.exc,
      )),
    );
  }
  return {
    accepted: hby.db.exns.get([embeddedSaid])?.said === embeddedSaid,
    messages: publication.messages,
    deliveries,
    approved,
  };
}

/** Decode one accepted coordination wrapper and select its actual local group signing state. */
function loadIpexProposal(hby: Habery, wrapper: SerderKERI) {
  const frame = wrapper.pvrsn.major === 2 ? loadNests(hby.db, wrapper.said!)[0] : undefined;
  const child = frame && frame.body instanceof SerderKERI
    ? { event: frame.body, attachment: new Uint8Array(), genus: frame.gvrsn!, frame }
    : multisigChild(hby, wrapper, "exn");
  if (!child) throw new ValidationError("Multisig IPEX approval requires an embedded child.");
  const group = child.event.pre;
  if (!group || !child.event.said || !wrapper.said) {
    throw new ValidationError("Multisig IPEX approval requires wrapper, group, and embedded SAIDs.");
  }
  const groupHab = hby.habs.get(group);
  if (!groupHab) throw new ValidationError(`Local group ${group} is missing member signing state.`);
  return { child, groupHab };
}

/**
 * Admit peer evidence, reuse or sign the local contribution, then advance ordinary escrows.
 * The operation owns its byte-input context, borrowing only semantic owners and identities.
 * It neither publishes member wrappers nor sends the completed business exchange.
 */
function* approveIpexChild(
  hby: Habery,
  protocol: ProtocolProcessor,
  groupHab: Hab,
  child: ReturnType<typeof loadIpexProposal>["child"],
  wrapper: SerderKERI,
  reger: Reger | null,
): Operation<Uint8Array | null> {
  const { event: embedded, attachment: peerAttachment, genus } = child;
  if (embedded.pvrsn.major === 2 && "frame" in child) {
    const raw = yield* call(() => collectPayload(framePayload(child.frame, { gvrsn: Vrsn_2_0 })));
    return yield* prepareAcdcV2GroupIpex(hby, protocol, groupHab, raw);
  }
  if (embedded.route === IPEX_GRANT_ROUTE) {
    if (!reger) throw new ValidationError("Grant approval requires the local credential wallet.");
    if (!credentialGrantReady(hby, reger, embedded, peerAttachment, genus)) return null;
  }
  const input = new Reactor(protocol);
  if (peerAttachment.length > 0) {
    yield* input.processBytes(concatBytes(Counter.makeGVC(genus), embedded.raw, peerAttachment), { local: true });
    yield* protocol.processEscrowsOnce();
  }
  const member = localGroupMember(hby, groupHab.pre);
  const prior = storedGroupMessage(hby.db, member.pre, wrapper);
  let approved: Uint8Array;
  if (prior) {
    // Accepted child proofs can replace provisional sets. The recipient wrapper
    // retains this member's actual contribution independently of that merged row.
    const retained = multisigChild(hby, prior, "exn");
    if (!retained || retained.event.said !== embedded.said) {
      throw new ValidationError("Recorded IPEX approval has a different child.");
    }
    const frames = parseBytes(concatBytes(Counter.makeGVC(retained.genus), retained.event.raw, retained.attachment));
    if (frames.length !== 1) throw new ValidationError("Recorded IPEX approval must retain one child message.");
    const proof = localIpexContribution(hby.db, member.pre, embedded, envelopeFromFrame(frames[0]).tsgs);
    if (!proof) throw new ValidationError("Recorded IPEX approval lacks a valid member contribution.");
    approved = concatBytes(serializeMessage(embedded, { tsgs: [proof], gvrsn: genus }), peerAttachment);
  } else {
    if (!ipexConversationReady(hby.db, embedded)) return null;
    if (embedded.route === IPEX_ADMIT_ROUTE) {
      if (!reger) throw new ValidationError("Admit approval requires the local credential wallet.");
      const prior = embedded.ked?.p;
      const grant = typeof prior === "string" && prior.length > 0 ? hby.db.exns.get([prior]) : null;
      if (!grant) throw new ValidationError("Admit approval requires its accepted grant.");
      validateAdmitGrant(grant, groupHab.pre, reger);
      if (ipexRecipient(embedded, grant) !== grant.pre) {
        throw new ValidationError("Admit recipient does not match its grant sender.");
      }
      const response = hby.db.erpy.get([grant.said!]);
      if (response && response.qb64 !== embedded.said) {
        throw new ValidationError("Grant already has another accepted response.");
      }
    }
    approved = groupIpexPartial(hby, groupHab, embedded, peerAttachment, genus);
  }
  yield* input.processBytes(concatBytes(Counter.makeGVC(genus), approved), { local: true });
  yield* protocol.processEscrowsOnce();
  return approved;
}

/**
 * Reuse this member's verified stored contribution, or sign its first partial.
 * Group and member rotation cannot replace a recorded signature. Peer proof
 * bytes remain distinct input; only a genuine local signature permits reuse.
 */
export function groupIpexPartial(
  hby: Habery,
  groupHab: Hab,
  embedded: SerderKERI,
  attachments: Uint8Array = new Uint8Array(),
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  if (embedded.pvrsn.major === 2) {
    throw new ValidationError("ACDC v2 group IPEX requires exact-stream prepareAcdcV2GroupIpex approval.");
  }
  const group = groupHab.pre;
  const groupRecord = hby.db.getHab(group);
  const memberPre = groupRecord?.mid;
  const memberHab = memberPre ? hby.habs.get(memberPre) : null;
  if (embedded.pre !== group || !embedded.said) {
    throw new ValidationError("IPEX sender must match the selected group and have a SAID.");
  }
  const prior = memberHab
    ? localIpexContribution(hby.db, memberHab.pre, embedded, rebuildStoredExchangeGroups(hby.db, embedded.said))
    : null;
  if (prior) return concatBytes(serializeMessage(embedded, { tsgs: [prior], gvrsn }), attachments);
  const groupKever = groupHab.kever;
  if (!group || !groupKever || !memberHab) {
    throw new ValidationError(`Local group ${group || "<missing>"} is missing member signing state.`);
  }

  // Hab owns contribution selection, including a member that rotated ahead of
  // the group's accepted key list. A fresh endorsement needs current authority
  // only; recorded contributions above retain their original proof bytes.
  const sigers = groupHab.sign(embedded.raw, true);
  const estSaid = groupKever.lastEst.d || groupKever.said;
  const estEvent = estSaid ? hby.db.getEvtSerder(group, estSaid) : null;
  const seqner = estEvent?.sner;
  if (!estSaid || !seqner) {
    throw new ValidationError(`Missing establishment event material for group ${group}.`);
  }
  const tsg = new TransIdxSigGroup(
    new Prefixer({ qb64: group }),
    seqner,
    new Diger({ qb64: estSaid }),
    sigers,
  );
  return concatBytes(
    serializeMessage(embedded, { tsgs: [tsg], pipelined: false, gvrsn }),
    attachments,
  );
}

/**
 * Select only a cryptographically valid local partial at an accepted group establishment.
 * The shared esigs table can hold unverified escrow candidates, so a matching
 * index or an authenticated parent wrapper alone is not recorded child approval.
 */
function localIpexContribution(
  db: Baser,
  member: string,
  embedded: SerderKERI,
  proofs: readonly TransIdxSigGroup[],
): TransIdxSigGroup | null {
  for (const proof of proofs) {
    if (proof.pre !== embedded.pre || proof.sn > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const said = db.kels.getLast(proof.pre, Number(proof.sn));
    const event = said === proof.said ? db.getEvtSerder(proof.pre, said) : null;
    if (!event?.estive) continue;
    const verified = Kever.verifyIndexedSignatures(embedded.raw, proof.sigers, event.verfers);
    for (const siger of verified.sigers) {
      if (groupMemberHasKey(db, member, event.verfers[siger.index].qb64)) {
        return new TransIdxSigGroup(proof.prefixer, event.sner!, proof.diger, [siger]);
      }
    }
  }
  return null;
}

/**
 * Prepare recipient-specific wrappers, replaying recorded ones, and admit each
 * exact packet locally before returning any transmission work. Composition owns
 * the delivery worker. Ordinary Baser/Multiplexor evidence is the recovery record;
 * there is no new queue or cross-store/network transaction.
 */
function* prepareGroupIpexMessages(
  hby: Habery,
  protocol: ProtocolProcessor,
  groupHab: Hab,
  embedded: Uint8Array,
  childGvrsn?: Versionage,
): Operation<SignedGroupMessage[]> {
  const member = localGroupMember(hby, groupHab.pre);
  const frames = parseBytes(childGvrsn ? concatBytes(Counter.makeGVC(childGvrsn), embedded) : embedded);
  const childFrame = frames[0], child = childFrame?.body;
  if (frames.length !== 1 || !(child instanceof SerderKERI)) {
    throw new ValidationError("Group IPEX requires one complete exchange.");
  }
  const genus = childFrame.gvrsn ?? child.gvrsn ?? childGvrsn ?? child.pvrsn;
  if (child.pvrsn.major === 2) {
    if (child.route === IPEX_GRANT_ROUTE) {
      const origins = (child.sad!.a as { o?: unknown }).o;
      if (
        !Array.isArray(origins) || origins.length !== 1 || typeof origins[0] !== "string"
        || acdcV2GraphUse(hby, protocol.registry?.store ?? null, origins[0], childFrame.nests ?? []) !== true
      ) {
        throw new ValidationError("ACDC v2 group graph is unavailable before proposal publication.");
      }
    } else if (
      child.route === IPEX_ADMIT_ROUTE && (typeof child.sad!.p !== "string"
        || acdcV2GrantUse(hby, protocol.exc, protocol.registry?.store ?? null, child.sad!.p) !== true)
    ) {
      throw new ValidationError("ACDC v2 group Grant is unavailable before Admit publication.");
    }
  }
  const payload = { gid: groupHab.pre, ...multisigChildGenusAttrs(child, genus) };
  const input = new Reactor(protocol);
  const messages: SignedGroupMessage[] = [];
  for (const recipient of remoteGroupMembers(hby, member, groupSigningMembers(hby, groupHab.pre))) {
    const prepared = child.pvrsn.major === 2
      ? [
        exchange(MULTISIG_EXN_ROUTE, { gid: groupHab.pre, exn: child.said! }, {
          sender: member.pre,
          recipient,
          version: Vrsn_2_0,
        })[0],
        yield* call(() => collectPayload(nestedPayload(childFrame, Vrsn_2_0))),
      ] as const
      : exchange(MULTISIG_EXN_ROUTE, payload, { sender: member.pre, recipient, embeds: { exn: embedded } });
    const signed = yield* prepareGroupMessage(protocol.exc, member, recipient, prepared);
    yield* input.processBytes(signed.message, { local: true });
    if (
      !protocol.exc.complete(signed.exnSaid)
      || !hby.db.meids.get([signed.payloadSaid]).some(index => index.qb64 === signed.exnSaid)
    ) {
      throw new ValidationError("Group IPEX wrapper was not accepted and indexed locally.");
    }
    messages.push(signed);
  }
  return messages;
}

/** Publish approval wrappers through ordinary Poster sends; never acquire workers or stores here. */
export function* publishGroupIpexProposal(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  groupHab: Hab,
  embedded: Uint8Array,
  childGvrsn?: Versionage,
): Operation<GroupSendResult> {
  const outcomes: GroupDelivery[] = [];
  for (const message of yield* prepareGroupIpexMessages(hby, protocol, groupHab, embedded, childGvrsn)) {
    outcomes.push(yield* sendGroupMessage(postman, message));
  }
  return groupSendResult(outcomes);
}

/**
 * Publish an initial command's member wrappers with StreamPoster's original
 * first-present-role routing. Shared preparation signs/replays and admits locally;
 * this concrete operation retains its existing finite-stream transport contract.
 */
export function* publishInitialGroupIpex(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  groupHab: Hab,
  embedded: Uint8Array,
  childGvrsn?: Versionage,
): Operation<GroupSendResult> {
  const outcomes: GroupDelivery[] = [];
  for (const message of yield* prepareGroupIpexMessages(hby, protocol, groupHab, embedded, childGvrsn)) {
    const evt = postman.sendStream({
      src: message.src,
      dest: message.recipient,
      msgs: [message.message],
      topic: "multisig",
    }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    outcomes.push({
      recipient: message.recipient,
      exnSaid: message.exnSaid,
      payloadSaid: message.payloadSaid,
      deliveries: outcome.deliveries,
    });
  }
  return groupSendResult(outcomes);
}

/** Approve stored wrappers for one IPEX child without external lead sending or acquiring stores/workers. */
export function* approveStoredMultisigIpexWrappers(
  hby: Habery,
  protocol: ProtocolProcessor,
  embeddedSaid: string,
  reger: Reger | null,
): Operation<void> {
  for (const [, wrapper] of hby.db.exns.getTopItemIter()) {
    if (wrapper.route !== MULTISIG_EXN_ROUTE) {
      continue;
    }
    const embeddedSad = wrapper.pvrsn.major === 2
      ? loadNests(hby.db, wrapper.said!)[0]?.body.ked
      : embeddedBusinessExnSAD(wrapper);
    if (!embeddedSad || embeddedSad.d !== embeddedSaid) {
      continue;
    }
    const { child, groupHab } = loadIpexProposal(hby, wrapper);
    yield* approveIpexChild(hby, protocol, groupHab, child, wrapper, reger);
  }
}

/**
 * Return the first incomplete stored `/multisig/exn` wrapping `/ipex/*`.
 *
 * @param db Borrowed accepted exchanges; discovery does not mutate notices or approval state.
 * @returns First incomplete stored IPEX proposal, or no result when none exists.
 */
export function findPendingMultisigIpex(db: Baser): SerderKERI | null {
  for (const [, wrapper] of db.exns.getTopItemIter()) {
    if (wrapper.route !== MULTISIG_EXN_ROUTE) {
      continue;
    }
    const embeddedSad = wrapper.pvrsn.major === 2
      ? loadNests(db, wrapper.said!)[0]?.body.ked
      : embeddedBusinessExnSAD(wrapper);
    if (!embeddedSad || typeof embeddedSad.r !== "string" || !embeddedSad.r.startsWith("/ipex/")) {
      continue;
    }
    const embeddedSaid = embeddedSad.d;
    if (typeof embeddedSaid !== "string" || db.exns.get([embeddedSaid])?.said === embeddedSaid) {
      continue;
    }
    return wrapper;
  }
  return null;
}

/**
 * Send a completed group IPEX message from the elected local lead.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param reger Borrowed credential evidence store for grant artifacts.
 * @param groupHab Group sender whose elected local lead publishes completed output.
 * @param embedded Completed embedded IPEX message.
 * @param gvrsn Attachment genus for the outgoing child/artifact stream.
 * @returns Completed delivery results when this member is the elected sender.
 */
export function* sendCompletedGroupIpex(
  hby: Habery,
  postman: Poster,
  reger: Reger | null,
  groupHab: Hab,
  embedded: SerderKERI,
  gvrsn: Versionage = Vrsn_1_0,
  registry: RegistryStore | null = null,
  exchanger?: Exchanger,
): Operation<string[]> {
  if (!embedded.said) {
    throw new ValidationError("Completed group IPEX message is missing a SAID.");
  }
  const priorSaid = embedded.ked?.p;
  const prior = typeof priorSaid === "string" && priorSaid.length > 0 ? hby.db.exns.get([priorSaid]) : null;
  const recipient = embedded.pvrsn.major === 2 && typeof embedded.sad?.ri === "string"
    ? embedded.sad.ri
    : ipexRecipient(embedded, prior ?? undefined);
  if (!recipient) {
    throw new ValidationError(`Unable to find recipient for ${embedded.route ?? "<unknown>"} ${embedded.said}.`);
  }

  const messages: Uint8Array[] = [];
  if (embedded.pvrsn.major === 2) {
    if (!exchanger) {
      throw new ValidationError("ACDC v2 group delivery requires its actual exchange verification owner.");
    }
    const grant = embedded.route === IPEX_GRANT_ROUTE
      ? embedded.said
      : embedded.route === IPEX_ADMIT_ROUTE
      ? embedded.sad!.p
      : undefined;
    if (typeof grant === "string" && acdcV2GrantUse(hby, exchanger, registry, grant) !== true) {
      throw new ValidationError("ACDC v2 group graph is unavailable for completed delivery.");
    }
    if (embedded.route === IPEX_GRANT_ROUTE) {
      const nests = loadNests(hby.db, embedded.said!), aids = new Set([groupHab.pre]), regids = new Set<string>();
      for (const node of nests) {
        const body = node.body as SerderACDC;
        if (body.issuer) aids.add(body.issuer);
        if (body.issuee) aids.add(body.issuee);
        if (body.regid) regids.add(body.regid);
        const a = body.sad!.a as { rd?: unknown };
        if (a && typeof a === "object" && typeof a.rd === "string") regids.add(a.rd);
      }
      messages.push(Counter.makeGVC(Vrsn_2_0));
      for (const aid of aids) {
        const state = hby.db.getKever(aid);
        if (state) messages.push(...hby.db.cloneDelegation(state, Vrsn_2_0), ...hby.db.clonePreIter(aid, 0, Vrsn_2_0));
      }
      for (const regid of regids) {
        if (!registry) throw new ValidationError("ACDC v2 group delivery registry evidence is unavailable.");
        messages.push(registry.cloneTel(regid));
      }
    }
  } else if (embedded.route === IPEX_GRANT_ROUTE) {
    if (!reger) {
      throw new ValidationError("VDR runtime did not open Reger.");
    }
    messages.push(...groupGrantSupport(hby, reger, embedded, recipient, gvrsn));
  }

  if (embedded.pvrsn.major === 2) {
    messages.push(yield* abortable(signal => collectBytes(exchanger!.replay(embedded.said!, signal))));
    return yield* sendCredentialStream(postman, localGroupMember(hby, groupHab.pre), recipient, messages);
  } else {
    messages.push(storedExchangeMessage(hby, requireStoredExchange(hby, embedded.said), gvrsn));
  }
  return yield* sendCredentialBytes(
    postman,
    localGroupMember(hby, groupHab.pre),
    recipient,
    messages,
  );
}

/** Build credential support from the explicitly selected legacy store. */
function groupGrantSupport(
  hby: Habery,
  reger: Reger,
  embedded: SerderKERI,
  recipient: string,
  gvrsn: Versionage,
): Uint8Array[] {
  const credentialSaid = credentialSaidFromGrant(embedded);
  if (!credentialSaid) throw new ValidationError("Grant is missing its credential SAID.");
  const [creder] = reger.cloneCred(credentialSaid);
  return credentialPresentationSupportMessages(hby, reger, creder, recipient, gvrsn);
}

/** Load one accepted stored EXN by SAID. */
export function requireStoredExchange(hby: Habery, said: string): SerderKERI {
  const stored = hby.db.exns.get([said]);
  if (!stored) {
    throw new ValidationError(`Exchange ${said} is not stored as accepted.`);
  }
  return stored;
}

/**
 * Rebuild an accepted EXN with its signatures and path/proof payloads.
 * epath stores complete counted groups; remove each source counter before the
 * serializer supplies the selected output genus's counter. Retain the selected
 * grant's actual child proofs; support reconstruction must not replace them.
 */
export function storedExchangeMessage(
  hby: Habery,
  serder: SerderKERI,
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  if (!serder.said) {
    throw new ValidationError("Exchange message is missing a SAID.");
  }
  const cigars = hby.db.ecigs.get([serder.said]).map(([, cigar]) => cigar) as Cigar[];
  const sourceGenus = resolveAttachmentGvrsn(serder, hby.db.exchangeMeta.get([serder.said])?.gvrsn);
  const pathed = hby.db.epath.get([serder.said]).map((text) => {
    const raw = new TextEncoder().encode(text);
    return raw.slice(new Counter({ qb64b: raw, version: sourceGenus }).fullSize);
  });
  return serializeMessage(serder, {
    tsgs: rebuildStoredExchangeGroups(hby.db, serder.said),
    cigars,
    pathed,
    pipelined: false,
    gvrsn,
  });
}

/**
 * Send raw credential/IPEX bytes over the credential mailbox topic.
 *
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param dest Final recipient AID.
 * @param msgs Complete signed credential/IPEX messages in required order.
 * @returns Successful destination URLs; failed concrete outcomes throw.
 */
export function* sendCredentialBytes(
  postman: Poster,
  hab: Hab,
  dest: string,
  msgs: Uint8Array[],
): Operation<string[]> {
  const sent: string[] = [];
  for (const msg of msgs) {
    const evt = postman.send({
      src: hab.pre,
      dest,
      msg,
      topic: CREDENTIAL_MAILBOX_TOPIC,
    }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    sent.push(...outcome.deliveries);
  }
  return sent;
}

/**
 * Send an initial IPEX command's prepared batch through one stream admission.
 *
 * @param postman Borrowed Poster; an independently running worker owns delivery.
 * @param hab Local source signer; bytes are already signed before admission.
 * @param dest Resolved final recipient AID.
 * @param msgs Finite ordered support and business messages sharing endpoint selection.
 * @returns Actual delivered URLs; a failed concrete outcome throws its original error.
 */
export function* sendCredentialStream(
  postman: Poster,
  hab: Hab,
  dest: string,
  msgs: Uint8Array[],
): Operation<string[]> {
  const evt = postman.sendStream({ src: hab.pre, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msgs }, { notify: true });
  const outcome = yield* postman.wait(evt);
  if (outcome.kin === "failed") throw outcome.error;
  return outcome.deliveries;
}

function rebuildStoredExchangeGroups(db: Baser, said: string): TransIdxSigGroup[] {
  const groups: TransIdxSigGroup[] = [];
  let currentKey: string[] | null = null;
  let currentSigers: Siger[] = [];

  const flush = () => {
    if (!currentKey || currentSigers.length === 0) {
      return;
    }
    groups.push(
      new TransIdxSigGroup(
        new Prefixer({ qb64: currentKey[0] }),
        seqnerFromSnh(currentKey[1]),
        new Diger({ qb64: currentKey[2] }),
        currentSigers,
      ),
    );
    currentSigers = [];
  };

  for (const [keys, siger] of db.esigs.getTopItemIter([said, ""])) {
    const groupKey = keys.slice(1);
    if (!groupKey[0] || !groupKey[1] || !groupKey[2]) {
      continue;
    }
    if (
      currentKey
      && (currentKey[0] !== groupKey[0] || currentKey[1] !== groupKey[1] || currentKey[2] !== groupKey[2])
    ) {
      flush();
    }
    currentKey = [groupKey[0], groupKey[1], groupKey[2]];
    currentSigers.push(siger);
  }

  flush();
  return groups;
}

function seqnerFromSnh(snh: string): Seqner {
  return new Seqner({ code: "0A", raw: hexToFixedBytes(snh, 16) });
}

function hexToFixedBytes(hex: string, size: number): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new ValidationError(`Invalid hex ordinal ${hex}`);
  }
  if (normalized.length > size * 2) {
    throw new ValidationError(`Hex ordinal ${hex} exceeds ${size} bytes.`);
  }

  const raw = new Uint8Array(size);
  const padded = normalized.padStart(size * 2, "0");
  for (let index = 0; index < size; index += 1) {
    raw[index] = Number.parseInt(padded.slice(index * 2, (index * 2) + 2), 16);
  }
  return raw;
}
