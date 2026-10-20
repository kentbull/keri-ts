/**
 * Group IPEX workflow orchestration.
 *
 * This module owns multisig coordination around embedded `/ipex/*` messages.
 * CLI adapters supply parsed options and output/file handling; this service
 * signs, publishes and sends completed group IPEX messages. CLI orchestration
 * owns timed waits and worker lifetimes.
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
import type { Reger } from "../db/reger.ts";
import { type AgentRuntime } from "./agent-runtime.ts";
import { createExchangeMessage } from "./exchange-messaging.ts";
import type { Poster } from "./forwarding.ts";
import { groupSigningMembers, localGroupMember } from "./group-members.ts";
import { embeddedBusinessExnSAD, MULTISIG_EXN_ROUTE, multisigChild, multisigChildGenusAttrs } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import {
  credentialPresentationArtifacts,
  credentialPresentationSupportMessages,
  credentialSaidFromGrant,
} from "./ipex-credentialing.ts";
import { IPEX_GRANT_ROUTE } from "./ipexing.ts";

export type IpexDeliveryPreference = "auto" | "direct" | "indirect";

export interface MultisigIpexApprovalOptions {
  publish?: boolean;
  delivery?: IpexDeliveryPreference;
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
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param wrapper Accepted multisig exchange carrying the proposed IPEX child.
 * @param options Approval/genus/delivery policy used for the existing group workflow.
 * @returns Approval and current group/protocol completion information.
 */
export function* approveMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  wrapper: SerderKERI,
  options: MultisigIpexApprovalOptions = {},
): Operation<MultisigIpexApprovalResult> {
  const child = multisigChild(hby, wrapper, "exn");
  if (!child) throw new ValidationError("Multisig IPEX approval requires an embedded child.");
  const { event: embedded, attachment: peerAttachment, genus } = child;
  const group = embedded.pre;
  const embeddedSaid = embedded.said;
  const wrapperSaid = wrapper.said;
  if (!group || !embeddedSaid || !wrapperSaid) {
    throw new ValidationError("Multisig IPEX approval requires wrapper, group, and embedded SAIDs.");
  }

  const groupHab = hby.habs.get(group);
  if (!groupHab) {
    throw new ValidationError(`Local group ${group} is missing member signing state.`);
  }
  const reger = embedded.route === IPEX_GRANT_ROUTE && (options.sendLead ?? true)
    ? runtime.vdr?.reger ?? null
    : null;
  if (embedded.route === IPEX_GRANT_ROUTE && (options.sendLead ?? true) && !reger) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  if (peerAttachment.length > 0) {
    yield* runtime.reactor.processBytes(
      concatBytes(Counter.makeGVC(genus), embedded.raw, peerAttachment),
      { local: true },
    );
    yield* runtime.protocol.processEscrowsOnce();
  }
  const approved = groupIpexPartial(hby, groupHab, embedded, peerAttachment, genus);
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), approved), { local: true });
  yield* runtime.protocol.processEscrowsOnce();
  const deliveries = options.publish
    ? yield* publishGroupIpexProposal(runtime, groupHab, approved, undefined, genus)
    : [];
  if (
    (options.sendLead ?? true)
    && hby.db.exns.get([embeddedSaid])?.said === embeddedSaid
    && runtime.exc.lead(groupHab, embeddedSaid)
  ) {
    deliveries.push(
      ...(yield* sendCompletedGroupIpex(
        hby,
        runtime.postman,
        reger,
        groupHab,
        embedded,
        options.delivery,
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
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param groupHab Group habitat whose signing members receive the proposal.
 * @param embedded IPEX exchange body/attachments to wrap.
 * @param delivery Existing Poster route preference.
 * @param childGvrsn Attachment genus of the embedded child, independent of outer EXN framing.
 * @returns Proposal delivery results after matching Poster outcomes.
 */
export function* publishGroupIpexProposal(
  runtime: AgentRuntime,
  groupHab: Hab,
  embedded: Uint8Array,
  delivery?: IpexDeliveryPreference,
  childGvrsn?: Versionage,
): Operation<string[]> {
  const member = localGroupMember(runtime.hby, groupHab.pre);
  const child = new SerderKERI({ raw: embedded });
  const genus = child.gvrsn ?? childGvrsn ?? child.pvrsn;
  const payload = { gid: groupHab.pre, ...multisigChildGenusAttrs(child, genus) };
  const deliveries: string[] = [];
  for (const recipient of groupSigningMembers(runtime.hby, groupHab.pre)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const { msg } = createExchangeMessage(member, {
      dest: recipient,
      route: MULTISIG_EXN_ROUTE,
      payload,
      embeds: { exn: embedded },
    });
    const postman = runtime.postman;
    const evt = postman.send({ src: member.pre, dest: recipient, topic: "multisig", msg, delivery }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    deliveries.push(...outcome.deliveries);
  }
  return deliveries;
}

/** Approve all stored multisig wrappers for one embedded IPEX SAID. */
export function* approveStoredMultisigIpexWrappers(
  hby: Habery,
  runtime: AgentRuntime,
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
    yield* approveMultisigIpex(hby, runtime, wrapper, {
      publish: false,
      sendLead: false,
    });
  }
}

/**
 * Return the first incomplete stored `/multisig/exn` wrapping `/ipex/*`.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @returns First incomplete stored IPEX proposal, or no result when none exists.
 */
export function findPendingMultisigIpex(hby: Habery, runtime: AgentRuntime): SerderKERI | null {
  for (const [, wrapper] of hby.db.exns.getTopItemIter()) {
    if (wrapper.route !== MULTISIG_EXN_ROUTE) {
      continue;
    }
    const embeddedSad = embeddedBusinessExnSAD(wrapper);
    if (!embeddedSad || typeof embeddedSad.r !== "string" || !embeddedSad.r.startsWith("/ipex/")) {
      continue;
    }
    const embeddedSaid = embeddedSad.d;
    if (typeof embeddedSaid !== "string" || runtime.exc.complete(embeddedSaid)) {
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
 * @param delivery Existing Poster route preference.
 * @param gvrsn Attachment genus for the outgoing child/artifact stream.
 * @returns Completed delivery results when this member is the elected sender.
 */
export function* sendCompletedGroupIpex(
  hby: Habery,
  postman: Poster,
  reger: Reger | null,
  groupHab: Hab,
  embedded: SerderKERI,
  delivery?: IpexDeliveryPreference,
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
    delivery,
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
 * @param delivery Existing route preference.
 * @returns Successful destination URLs; failed concrete outcomes throw.
 */
export function* sendCredentialBytes(
  postman: Poster,
  hab: Hab,
  dest: string,
  msgs: Uint8Array[],
  delivery: IpexDeliveryPreference | undefined,
): Operation<string[]> {
  const sent: string[] = [];
  for (const msg of msgs) {
    const evt = postman.send({
      src: hab.pre,
      dest,
      msg,
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery,
    }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    sent.push(...outcome.deliveries);
  }
  return sent;
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
