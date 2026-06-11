/**
 * Group IPEX workflow orchestration.
 *
 * This module owns multisig coordination around embedded `/ipex/*` messages.
 * CLI adapters supply parsed options and output/file handling; this service
 * signs, publishes, waits, and sends completed group IPEX messages.
 */
import { action, type Operation } from "npm:effection@^3.6.0";
import {
  type Cigar,
  concatBytes,
  Diger,
  makePather,
  Prefixer,
  Seqner,
  SerderKERI,
  type Siger,
  smell,
  type Versionage,
  Vrsn_1_0,
} from "../../../cesr/mod.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { serializeMessage } from "../core/protocol-exchanging.ts";
import { Reger } from "../db/reger.ts";
import { type AgentRuntime, processMailboxTurn } from "./agent-runtime.ts";
import { groupSigningMembers, localGroupMember } from "./group-members.ts";
import { embeddedBusinessExnSAD, MULTISIG_EXN_ROUTE, multisigPathedAttachment } from "./grouping.ts";
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

export interface PendingMultisigIpexOptions {
  hab?: Hab;
  pollTurns: number;
  pollBudgetMs: number;
}

/** Approve one pending multisig wrapper around an embedded IPEX message. */
export function* approveMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  wrapper: SerderKERI,
  embedded: SerderKERI,
  options: MultisigIpexApprovalOptions = {},
): Operation<MultisigIpexApprovalResult> {
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
  const peerAttachment = multisigPathedAttachment(hby, wrapperSaid, "exn");
  if (peerAttachment.length > 0) {
    runtime.reactor.processCompleteChunk(
      concatBytes(embedded.raw, peerAttachment),
      { local: true },
    );
    runtime.reactor.processEscrowsOnce();
  }
  const approved = groupIpexPartial(hby, groupHab, embedded, wrapperSaid);
  runtime.reactor.processCompleteChunk(approved, { local: true });
  runtime.reactor.processEscrowsOnce();
  const deliveries = options.publish ? yield* publishGroupIpexProposal(runtime, groupHab, approved) : [];
  if (
    (options.sendLead ?? true)
    && hby.db.exns.get([embeddedSaid])?.said === embeddedSaid
    && runtime.reactor.exchanger.lead(groupHab, embeddedSaid)
  ) {
    deliveries.push(
      ...(yield* sendCompletedGroupIpex(
        runtime,
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

/** Build the locally signed group IPEX partial stream. */
export function groupIpexPartial(
  hby: Habery,
  groupHab: Hab,
  embedded: SerderKERI,
  wrapperSaid?: string,
  attachments: Uint8Array = new Uint8Array(),
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
  const message = concatBytes(
    serializeMessage(embedded, { tsgs: [tsg], pipelined: false }),
    attachments,
  );
  if (!wrapperSaid) {
    return message;
  }
  return concatBytes(message, multisigPathedAttachment(hby, wrapperSaid, "exn"));
}

/** Publish one group IPEX proposal to remote signing members. */
export function* publishGroupIpexProposal(
  runtime: AgentRuntime,
  groupHab: Hab,
  embedded: Uint8Array,
  delivery?: IpexDeliveryPreference,
): Operation<string[]> {
  const member = localGroupMember(runtime.hby, groupHab.pre);
  const deliveries: string[] = [];
  for (const recipient of groupSigningMembers(runtime.hby, groupHab.pre)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const result = yield* runtime.poster.sendExchange(member, {
      recipient,
      route: MULTISIG_EXN_ROUTE,
      payload: { gid: groupHab.pre },
      embeds: { exn: embedded },
      topic: "multisig",
      delivery,
    });
    deliveries.push(...result.deliveries, ...result.queued);
  }
  return deliveries;
}

/** Wait for a group IPEX message to become complete while approving stored wrappers. */
export function* waitForMultisigIpexCompletion(
  hby: Habery,
  runtime: AgentRuntime,
  groupHab: Hab,
  embeddedSaid: string,
  approvalTimeoutSeconds: number,
): Operation<boolean> {
  const member = localGroupMember(hby, groupHab.pre);
  const deadline = Date.now() + approvalTimeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    yield* approveStoredMultisigIpexWrappers(hby, runtime, embeddedSaid);
    runtime.reactor.processEscrowsOnce();
    if (runtime.reactor.exchanger.complete(embeddedSaid)) {
      return true;
    }

    yield* processMailboxTurn(runtime, { hab: member, budgetMs: 1000 });
    yield* approveStoredMultisigIpexWrappers(hby, runtime, embeddedSaid);
    runtime.reactor.processEscrowsOnce();
    if (runtime.reactor.exchanger.complete(embeddedSaid)) {
      return true;
    }
    yield* sleep(250);
  }
  return runtime.reactor.exchanger.complete(embeddedSaid);
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
    const embedded = new SerderKERI({ sad: embeddedSad });
    yield* approveMultisigIpex(hby, runtime, wrapper, embedded, {
      publish: false,
      sendLead: false,
    });
  }
}

/** Poll for the next stored pending multisig IPEX proposal. */
export function* nextPendingMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  options: PendingMultisigIpexOptions,
): Operation<SerderKERI | null> {
  for (let turn = 0; turn < options.pollTurns; turn += 1) {
    const found = findPendingMultisigIpex(hby, runtime);
    if (found) {
      return found;
    }
    yield* processMailboxTurn(runtime, { hab: options.hab, budgetMs: options.pollBudgetMs });
    runtime.reactor.processEscrowsOnce();
    const afterPoll = findPendingMultisigIpex(hby, runtime);
    if (afterPoll) {
      return afterPoll;
    }
  }
  return null;
}

/** Return the first incomplete stored `/multisig/exn` wrapping `/ipex/*`. */
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
    if (typeof embeddedSaid !== "string" || runtime.reactor.exchanger.complete(embeddedSaid)) {
      continue;
    }
    return wrapper;
  }
  return null;
}

/** Send a completed group IPEX message from the elected local lead. */
export function* sendCompletedGroupIpex(
  runtime: AgentRuntime,
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
  const reger = runtime.vdr.reger;
  if (embedded.route === IPEX_GRANT_ROUTE) {
    if (!(reger instanceof Reger)) {
      throw new ValidationError("VDR runtime did not open Reger.");
    }
    const credentialSaid = credentialSaidFromGrant(embedded);
    if (credentialSaid) {
      const [creder] = reger.cloneCred(credentialSaid);
      const artifacts = credentialPresentationArtifacts(
        runtime.hby,
        reger,
        credentialSaid,
        gvrsn,
      );
      grantPathed = grantPathedMaterials(artifacts);
      messages.push(...credentialPresentationSupportMessages(
        runtime.hby,
        reger,
        creder,
        recipient,
        gvrsn,
      ));
    }
  }

  messages.push(storedExchangeMessage(
    runtime.hby,
    requireStoredExchange(runtime.hby, embedded.said),
    gvrsn,
    grantPathed,
  ));
  return yield* sendCredentialBytes(
    runtime,
    localGroupMember(runtime.hby, groupHab.pre),
    recipient,
    messages,
    delivery,
  );
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

/** Send raw credential/IPEX bytes over the credential mailbox topic. */
export function* sendCredentialBytes(
  runtime: AgentRuntime,
  hab: Hab,
  recipient: string,
  messages: Uint8Array[],
  delivery: IpexDeliveryPreference | undefined,
): Operation<string[]> {
  const sent: string[] = [];
  for (const message of messages) {
    const result = yield* runtime.poster.sendBytes(hab, {
      recipient,
      message,
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery,
      split: false,
    });
    sent.push(...result.deliveries, ...result.queued);
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
    pathedMaterial("anc", artifacts.anc),
    pathedMaterial("iss", artifacts.iss),
    pathedMaterial("acdc", artifacts.acdc),
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

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    return () => clearTimeout(timeout);
  });
}
