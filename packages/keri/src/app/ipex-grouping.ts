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
  type Cigar,
  concatBytes,
  Counter,
  Diger,
  makePather,
  Prefixer,
  Seqner,
  SerderKERI,
  type Siger,
  smell,
  type Versionage,
  Vrsn_1_0,
} from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { serializeMessage } from "../core/protocol-exchanging.ts";
import type { Baser } from "../db/basing.ts";
import type { Reger } from "../db/reger.ts";
import { createExchangeMessage } from "./exchange-messaging.ts";
import type { Poster, PosterMsg } from "./forwarding.ts";
import { groupSigningMembers, localGroupMember } from "./group-members.ts";
import { embeddedBusinessExnSAD, MULTISIG_EXN_ROUTE, multisigChild, multisigChildGenusAttrs } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import {
  credentialPresentationArtifacts,
  credentialPresentationSupportMessages,
  credentialSaidFromGrant,
} from "./ipex-credentialing.ts";
import { IPEX_GRANT_ROUTE } from "./ipexing.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import { Reactor } from "./reactor.ts";

export interface MultisigIpexApprovalOptions {
  publish?: boolean;
  sendLead?: boolean;
  gvrsn?: Versionage;
}

export interface MultisigIpexApprovalResult {
  accepted: boolean;
  deliveries: string[];
  approved: Uint8Array;
}

/**
 * Approve one pending multisig wrapper around an embedded IPEX message.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param protocol Borrowed semantic owner; this approval creates its own byte-input context.
 * @param postman Borrowed delivery owner; the caller runs and joins its worker.
 * @param reger Explicit legacy evidence store, required only when sending a completed grant.
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
  if (embedded.route === IPEX_GRANT_ROUTE && (options.sendLead ?? true) && !reger) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  const approved = yield* approveIpexChild(hby, protocol, groupHab, child);
  const deliveries = options.publish
    ? yield* publishGroupIpexProposal(hby, postman, groupHab, approved, genus)
    : [];
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
      )),
    );
  }
  return {
    accepted: hby.db.exns.get([embeddedSaid])?.said === embeddedSaid,
    deliveries,
    approved,
  };
}

/** Decode one accepted coordination wrapper and select its actual local group signing state. */
function loadIpexProposal(hby: Habery, wrapper: SerderKERI) {
  const child = multisigChild(hby, wrapper, "exn");
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
 * Admit peer evidence, sign the local contribution and advance ordinary escrows in that order.
 * The operation owns its byte-input context, borrowing only semantic owners and identities.
 * It neither publishes member wrappers nor sends the completed business exchange.
 */
function* approveIpexChild(
  hby: Habery,
  protocol: ProtocolProcessor,
  groupHab: Hab,
  { event: embedded, attachment: peerAttachment, genus }: ReturnType<typeof loadIpexProposal>["child"],
): Operation<Uint8Array> {
  const input = new Reactor(protocol);
  if (peerAttachment.length > 0) {
    yield* input.processBytes(concatBytes(Counter.makeGVC(genus), embedded.raw, peerAttachment), { local: true });
    yield* protocol.processEscrowsOnce();
  }
  const approved = groupIpexPartial(hby, groupHab, embedded, peerAttachment, genus);
  yield* input.processBytes(concatBytes(Counter.makeGVC(genus), approved), { local: true });
  yield* protocol.processEscrowsOnce();
  return approved;
}

/** Sign a group IPEX body and append the supplied proof bytes in the selected attachment genus. */
export function groupIpexPartial(
  hby: Habery,
  groupHab: Hab,
  embedded: SerderKERI,
  attachments: Uint8Array = new Uint8Array(),
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  const group = groupHab.pre;
  const groupRecord = hby.db.getHab(group);
  const memberPre = groupRecord?.mid;
  const memberHab = memberPre ? hby.habs.get(memberPre) : null;
  const groupKever = groupHab.kever;
  const memberKey = memberHab?.kever?.verfers[0]?.qb64;
  if (!group || !groupKever || !memberHab || !memberKey) {
    throw new ValidationError(`Local group ${group || "<missing>"} is missing member signing state.`);
  }

  const groupIndex = groupKever.verfers.findIndex((verfer) => verfer.qb64 === memberKey);
  if (groupIndex < 0) {
    throw new ValidationError(`Local member ${memberHab.pre} is not a current signer for group ${group}.`);
  }

  const sigers = memberHab.mgr.sign(embedded.raw, {
    pubs: [memberKey],
    indexed: true,
    indices: [groupIndex],
  });
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
 * Publish one group IPEX proposal to remote signing members.
 *
 * @param hby Borrowed group/member identities and accepted state.
 * @param postman Borrowed delivery owner; the caller runs and joins its worker.
 * @param groupHab Group habitat whose signing members receive the proposal.
 * @param embedded IPEX exchange body/attachments to wrap.
 * @param childGvrsn Attachment genus of the embedded child, independent of outer EXN framing.
 * @returns Proposal delivery results after matching Poster outcomes.
 */
export function* publishGroupIpexProposal(
  hby: Habery,
  postman: Poster,
  groupHab: Hab,
  embedded: Uint8Array,
  childGvrsn?: Versionage,
): Operation<string[]> {
  const deliveries: string[] = [];
  for (const msg of groupIpexProposals(hby, groupHab, embedded, childGvrsn)) {
    const evt = postman.send(msg, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    deliveries.push(...outcome.deliveries);
  }
  return deliveries;
}

/**
 * Construct member proposals before their caller chooses its real Poster operation.
 * Initial IPEX commands use stream admission; join completion uses ordinary sends.
 *
 * @param hby Borrowed group/member identities and accepted state.
 * @param groupHab Local group whose remote signing members receive proposals.
 * @param embedded Independently signed IPEX message to embed.
 * @param childGvrsn Optional child attachment genus, independent of outer framing.
 * @returns Prepared source records; construction publishes no delivery work.
 */
export function groupIpexProposals(
  hby: Habery,
  groupHab: Hab,
  embedded: Uint8Array,
  childGvrsn?: Versionage,
): PosterMsg[] {
  const member = localGroupMember(hby, groupHab.pre);
  const child = new SerderKERI({ raw: embedded });
  const genus = child.gvrsn ?? childGvrsn ?? child.pvrsn;
  const payload = { gid: groupHab.pre, ...multisigChildGenusAttrs(child, genus) };
  const msgs: PosterMsg[] = [];
  for (const recipient of groupSigningMembers(hby, groupHab.pre)) {
    if (recipient === member.pre || hby.habs.has(recipient)) continue;
    const { msg } = createExchangeMessage(member, {
      dest: recipient,
      route: MULTISIG_EXN_ROUTE,
      payload,
      embeds: { exn: embedded },
    });
    msgs.push({ src: member.pre, dest: recipient, topic: "multisig", msg });
  }
  return msgs;
}

/** Approve stored wrappers for one IPEX child without external lead sending or acquiring stores/workers. */
export function* approveStoredMultisigIpexWrappers(
  hby: Habery,
  protocol: ProtocolProcessor,
  embeddedSaid: string,
): Operation<void> {
  for (const [, wrapper] of hby.db.exns.getTopItemIter()) {
    if (wrapper.route !== MULTISIG_EXN_ROUTE) {
      continue;
    }
    const embeddedSad = embeddedBusinessExnSAD(wrapper);
    if (!embeddedSad || embeddedSad.d !== embeddedSaid) {
      continue;
    }
    const { child, groupHab } = loadIpexProposal(hby, wrapper);
    yield* approveIpexChild(hby, protocol, groupHab, child);
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
    const embeddedSad = embeddedBusinessExnSAD(wrapper);
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
): Operation<string[]> {
  if (!embedded.said) {
    throw new ValidationError("Completed group IPEX message is missing a SAID.");
  }
  const recipient = ipexRecipient(embedded);
  if (!recipient) {
    throw new ValidationError(`Unable to find recipient for ${embedded.route ?? "<unknown>"} ${embedded.said}.`);
  }

  const messages: Uint8Array[] = [];
  let grantPathed: Uint8Array[] | undefined;
  if (embedded.route === IPEX_GRANT_ROUTE) {
    if (!reger) {
      throw new ValidationError("VDR runtime did not open Reger.");
    }
    const support = groupGrantSupport(hby, reger, embedded, recipient, gvrsn);
    grantPathed = support.pathed;
    messages.push(...support.messages);
  }

  messages.push(storedExchangeMessage(
    hby,
    requireStoredExchange(hby, embedded.said),
    gvrsn,
    grantPathed,
  ));
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
): { pathed?: Uint8Array[]; messages: Uint8Array[] } {
  const credentialSaid = credentialSaidFromGrant(embedded);
  if (!credentialSaid) return { messages: [] };
  const [creder] = reger.cloneCred(credentialSaid);
  const artifacts = credentialPresentationArtifacts(hby, reger, credentialSaid, gvrsn);
  return {
    pathed: grantPathedMaterials(artifacts),
    messages: credentialPresentationSupportMessages(hby, reger, creder, recipient, gvrsn),
  };
}

/** Load one accepted stored EXN by SAID. */
export function requireStoredExchange(hby: Habery, said: string): SerderKERI {
  const stored = hby.db.exns.get([said]);
  if (!stored) {
    throw new ValidationError(`Exchange ${said} is not stored as accepted.`);
  }
  return stored;
}

/** Rebuild a stored EXN wire message with signatures and pathed material. */
export function storedExchangeMessage(
  hby: Habery,
  serder: SerderKERI,
  gvrsn: Versionage = Vrsn_1_0,
  pathedOverride?: readonly Uint8Array[],
): Uint8Array {
  if (!serder.said) {
    throw new ValidationError("Exchange message is missing a SAID.");
  }
  const cigars = hby.db.ecigs.get([serder.said]).map(([, cigar]) => cigar) as Cigar[];
  return serializeMessage(serder, {
    tsgs: rebuildStoredExchangeGroups(hby, serder.said),
    cigars,
    pathed: pathedOverride ?? hby.db.epath.get([serder.said]),
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

function ipexRecipient(exn: SerderKERI): string | null {
  const rp = exn.ked?.rp;
  if (typeof rp === "string" && rp.length > 0) {
    return rp;
  }
  const attrs = exn.ked?.a;
  if (isRecord(attrs) && typeof attrs.i === "string" && attrs.i.length > 0) {
    return attrs.i;
  }
  return null;
}

function grantPathedMaterials(
  artifacts: ReturnType<typeof credentialPresentationArtifacts>,
): Uint8Array[] {
  return [
    pathedMaterial("anc", artifacts.anc.wire),
    pathedMaterial("iss", artifacts.iss.wire),
    pathedMaterial("acdc", artifacts.acdc.wire),
  ];
}

function pathedMaterial(label: string, message: Uint8Array): Uint8Array {
  const { smellage } = smell(message);
  const atc = message.slice(smellage.size);
  if (atc.length === 0) {
    return makePather(["e", label]).qb64b;
  }
  return concatBytes(makePather(["e", label]).qb64b, atc);
}

function rebuildStoredExchangeGroups(hby: Habery, said: string): TransIdxSigGroup[] {
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

  for (const [keys, siger] of hby.db.esigs.getTopItemIter([said, ""])) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
