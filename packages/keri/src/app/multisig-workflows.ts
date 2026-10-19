/**
 * Multisig proposal and approval workflows.
 *
 * CLI orchestration owns timed waits, worker lifetimes, prompts and output.
 * This module publishes proposals and approves stored KEL/RPY/VDR proposals
 * without starting or driving background workers.
 */
import {
  concatBytes,
  Counter,
  Diger,
  Ilks,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  SerderKERI,
  TraitDex,
  type Versionage,
} from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { RegistryRecord } from "../core/records.ts";
import { Credentialer, Regery, Registry, serializeCredential } from "../vdr/credentialing.ts";
import { type AgentRuntime } from "./agent-runtime.ts";

import type { Reger } from "../db/reger.ts";
import {
  endpointRoleAccepted,
  groupEndorseReply,
  groupEventKeys,
  groupSigningMembers,
  localGroupMember,
  signLocalGroupEvent,
} from "./endpoint-roleing.ts";
import { findLocalGroupMember as findLocalMember, uniqueMembers } from "./group-members.ts";
import {
  MULTISIG_ICP_ROUTE,
  MULTISIG_ISS_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_RPY_ROUTE,
  MULTISIG_VCP_ROUTE,
  type MultisigChild,
  multisigChild,
  multisigChildGenusAttrs,
  type MultisigEventProposal,
  type MultisigMessage,
  prepareMultisigEventExn,
} from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";

const MULTISIG_TOPIC = "multisig";

export type MultisigKelRoute =
  | typeof MULTISIG_ICP_ROUTE
  | typeof MULTISIG_ROT_ROUTE
  | typeof MULTISIG_IXN_ROUTE;
export type MultisigVdrRoute = typeof MULTISIG_VCP_ROUTE | typeof MULTISIG_ISS_ROUTE;
export type MultisigRpyRoute = typeof MULTISIG_RPY_ROUTE;
export type MultisigProposalRoute = MultisigKelRoute | MultisigVdrRoute | MultisigRpyRoute;

/** Decoded child and membership fields consumed by KEL approval policy; child proofs are verified during intake. */
type KelApproval = MultisigChild & {
  group: string;
  proposal: Extract<MultisigEventProposal, { route: MultisigKelRoute }>;
};

export interface ApprovalResult {
  route: MultisigProposalRoute;
  said: string;
  embedded: string;
  group: string;
  accepted: boolean;
  deliveries: string[];
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

export interface MultisigApprovalOptions {
  group?: string;
  said?: string;
  callbacks: MultisigApprovalCallbacks;
}

interface NoticeLike {
  rid: string;
  attrs: { r?: unknown; d?: unknown };
}

/** Publish a route-correlated event proposal; grouping owns child identity and label derivation. */
export function* publishProposal(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  proposal: MultisigEventProposal,
  embeddedMessage: Uint8Array,
  childGvrsn?: Versionage,
): Operation<string[]> {
  const deliveries: string[] = [];
  for (const recipient of uniqueMembers(recipients)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) continue;
    const destination = runtime.postman.resolveRecipient(recipient);
    const prepared = yield* prepareMultisigEventExn(member.pre, proposal, embeddedMessage, {
      recipient: destination,
      childGvrsn,
    });
    deliveries.push(...yield* registerAndSendProposal(runtime, member, destination, prepared));
  }
  return deliveries;
}

/** VDR routes carry their own required children and only known publication attributes. */
type VdrPublication =
  | {
    route: typeof MULTISIG_VCP_ROUTE;
    payload: { gid: string; usage?: string; cgvrsn?: readonly [number, number] };
    embeds: { vcp: Uint8Array; anc: Uint8Array };
  }
  | {
    route: typeof MULTISIG_ISS_ROUTE;
    payload: { gid: string; cgvrsn?: readonly [number, number] };
    embeds: { acdc: Uint8Array; iss: Uint8Array; anc: Uint8Array };
  };

/** Publish a registry or issuance proposal with its required named children. */
function* publishVdrProposal(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  proposal: VdrPublication,
): Operation<string[]> {
  const { route, payload, embeds } = proposal;
  const deliveries: string[] = [];
  for (const recipient of uniqueMembers(recipients)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const destination = runtime.postman.resolveRecipient(recipient);
    const [serder, attachments] = exchange(route, payload, {
      sender: member.pre,
      recipient: destination,
      embeds,
    });
    deliveries.push(...yield* registerAndSendProposal(runtime, member, destination, [serder, attachments]));
  }
  return deliveries;
}

/** Register the exact signed proposal before peers can reply to its delivery. */
function* registerAndSendProposal(
  runtime: AgentRuntime,
  member: Hab,
  recipient: string,
  [serder, attachments]: MultisigMessage,
): Operation<string[]> {
  const message = concatBytes(member.endorse(serder, { pipelined: false }), attachments);
  yield* runtime.reactor.processBytes(message, { local: true });
  const postman = runtime.postman;
  const evt = postman.send({
    src: member.pre,
    dest: recipient,
    msg: message,
    topic: MULTISIG_TOPIC,
  }, { notify: true });
  const outcome = yield* postman.wait(evt);
  if (outcome.kin === "failed") throw outcome.error;
  return [...outcome.deliveries];
}

/** True when a KEL event is accepted locally. */
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

/** Approve the first matching stored proposal; host progress and deadlines belong to the caller. */
export function* approvePendingMultisigProposal(
  hby: Habery,
  runtime: AgentRuntime,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  const notifier = runtime.notifier;
  if (!notifier) {
    throw new ValidationError("Multisig join requires notification storage.");
  }
  const notices = notifier.list(0, 100) as NoticeLike[];
  for (const note of notices) {
    const route = note.attrs.r;
    const said = note.attrs.d;
    if (typeof route !== "string" || typeof said !== "string") {
      continue;
    }
    if (options.said && options.said !== said) {
      continue;
    }
    if (
      route !== MULTISIG_ICP_ROUTE
      && route !== MULTISIG_ROT_ROUTE
      && route !== MULTISIG_IXN_ROUTE
      && route !== MULTISIG_VCP_ROUTE
      && route !== MULTISIG_ISS_ROUTE
      && route !== MULTISIG_RPY_ROUTE
    ) {
      continue;
    }

    const exn = hby.db.exns.get([said]);
    if (!exn?.ked) {
      continue;
    }
    const rgy = isVdrRoute(route) ? runtime.vdr : null;
    const result = isKelRoute(route)
      ? yield* approveKelProposal(hby, runtime, exn, route, options)
      : isVdrRoute(route)
      ? yield* approveVdrProposal(hby, rgy, runtime, exn, route, options)
      : yield* approveRpyProposal(hby, runtime, exn, route, options);
    if (result) {
      notifier.remove(note.rid);
      return result;
    }
  }
  return null;
}

function* approveRpyProposal(
  hby: Habery,
  runtime: AgentRuntime,
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
  const child = multisigChild(hby, exn, "rpy");
  if (!child) return null;
  const { event: rpySerder, attachment, genus } = child;
  const embeddedSaid = rpySerder.said ?? "";
  if (!options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid || "<unknown>" })) {
    return null;
  }

  yield* runtime.reactor.processBytes(
    concatBytes(Counter.makeGVC(genus), rpySerder.raw, attachment),
    { local: true },
  );

  const localRpy = groupEndorseReply(hby, groupPre, rpySerder, genus);
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), localRpy), { local: true });
  yield* runtime.protocol.processEscrowsOnce();

  const attrs = rpyAttrs(rpySerder);
  const deliveries = yield* publishProposal(
    runtime,
    member,
    groupSigningMembers(hby, groupPre),
    { route, attrs: { gid: groupPre } },
    localRpy,
    genus,
  );
  const accepted = endpointRoleAccepted(hby, attrs.cid, attrs.role, attrs.eid);

  return { route, said: wrapperSaid, embedded: embeddedSaid, group: groupPre, accepted, deliveries };
}

function* approveKelProposal(
  hby: Habery,
  runtime: AgentRuntime,
  exn: SerderKERI,
  route: MultisigKelRoute,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const approval = kelApproval(hby, exn, route);
  if (!approval) {
    return null;
  }
  const { event: serder, group: groupPre, proposal } = approval;
  const { smids } = proposal.attrs;
  const embeddedSaid = serder.said;
  const members = proposal.route === MULTISIG_IXN_ROUTE ? smids : uniqueMembers([...smids, ...proposal.attrs.rmids]);
  const member = proposal.route === MULTISIG_IXN_ROUTE
    ? localGroupMember(hby, groupPre)
    : findLocalMember(hby, members);
  if (!member) {
    throw new ValidationError(`No local member found for multisig proposal ${wrapperSaid}.`);
  }

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
  // Keep the attachment set open until the peer signatures are appended.
  const localMessage = messagize(serder, { sigers, pipelined: false, gvrsn: approval.genus });
  yield* runtime.reactor.processBytes(
    concatBytes(Counter.makeGVC(approval.genus), localMessage, approval.attachment),
    { local: true },
  );
  yield* runtime.protocol.processEscrowsOnce();

  const deliveries = yield* publishProposal(
    runtime,
    member,
    members,
    proposal,
    localMessage,
    approval.genus,
  );
  const accepted = eventAccepted(hby, serder);
  if (accepted && proposal.route !== MULTISIG_IXN_ROUTE) {
    const rmids = proposal.attrs.rmids;
    hby.commitGroupHabMembers(groupPre, smids, rmids.length > 0 ? rmids : smids);
  }

  return { route, said: wrapperSaid, embedded: embeddedSaid ?? "", group: groupPre, accepted, deliveries };
}

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
  const label = route === MULTISIG_VCP_ROUTE ? "vcp" : "iss";
  const embeddedSad = embed?.[label];
  const anchor = multisigChild(hby, exn, "anc");
  if (!isRecord(embeddedSad) || !anchor) {
    return null;
  }
  if (anchor.event.pre !== groupPre) return null;

  const embeddedSerder = new SerderKERI({ sad: embeddedSad });
  // Required children must be decoded before approval can sign or accept the anchor.
  const acdcSad = embed?.acdc;
  const proposal = route === MULTISIG_VCP_ROUTE
    ? { route }
    : isRecord(acdcSad)
    ? { route, credential: new SerderACDC({ sad: acdcSad }) }
    : null;
  if (!proposal) return null;
  const { event: anchorSerder, attachment, genus } = anchor;
  const embeddedSaid = embeddedSerder.said ?? "";
  if (!options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid || "<unknown>" })) {
    return null;
  }

  // Declined or malformed proposals remain inert; require VDR before signing or intake.
  if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");

  const smids = groupSigningMembers(hby, groupPre);
  const keys = groupEventKeys(hby, groupPre, anchorSerder);
  const sigers = signLocalGroupEvent(hby, anchorSerder, smids, keys);
  // Keep the attachment set open until the peer signatures are appended.
  const localAnchor = messagize(anchorSerder, { sigers, pipelined: false, gvrsn: genus });
  yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), localAnchor, attachment), { local: true });
  yield* runtime.protocol.processEscrowsOnce();

  let accepted = false;
  let publication: VdrPublication;
  const attrs = { gid: groupPre, ...multisigChildGenusAttrs(anchorSerder, genus) };
  if (proposal.route === MULTISIG_VCP_ROUTE) {
    accepted = approveRegistryIncept(rgy, groupHab, embeddedSerder, anchorSerder, options);
    publication = {
      route: proposal.route,
      payload: { ...attrs, ...(typeof payload.usage === "string" ? { usage: payload.usage } : {}) },
      embeds: { vcp: embeddedSerder.raw, anc: localAnchor },
    };
  } else {
    const creder = proposal.credential;
    accepted = approveCredentialIssue(rgy, creder, embeddedSerder, anchorSerder);
    const seal = telCredentialSeal(embeddedSerder);
    publication = {
      route: proposal.route,
      payload: attrs,
      embeds: {
        acdc: serializeCredential(creder, seal.prefixer, seal.seqner, seal.saider, genus),
        iss: embeddedSerder.raw,
        anc: localAnchor,
      },
    };
  }

  const deliveries = yield* publishVdrProposal(runtime, member, smids, publication);
  return { route, said: wrapperSaid, embedded: embeddedSaid, group: groupPre, accepted, deliveries };
}

/** The supported route determines its one named KEL child. */
function kelProposalLabel(route: MultisigKelRoute): "icp" | "rot" | "ixn" {
  return route === MULTISIG_ICP_ROUTE ? "icp" : route === MULTISIG_ROT_ROUTE ? "rot" : "ixn";
}

/** Decode the fields used by approval, preserving existing missing-embed and member-list behavior. */
function kelApproval(hby: Habery, exn: SerderKERI, route: MultisigKelRoute): KelApproval | null {
  const child = multisigChild(hby, exn, kelProposalLabel(route));
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
  options: MultisigApprovalOptions,
): boolean {
  const seal = sourceSeal(anchorSerder);
  rgy.tvy.processEvent({ serder: vserder, seqner: seal.seqner, saider: seal.saider });
  rgy.processEscrows();

  const regk = requireSerderPrefix(vserder, "registry inception");
  const registryName = options.callbacks.chooseRegistryName(regk);
  const cnfg = stringArrayField(vserder.ked ?? {}, "c");
  registerRegistry(rgy, registryName, groupHab, regk, {
    noBackers: cnfg.includes(TraitDex.NoBackers),
    estOnly: cnfg.includes(TraitDex.EstOnly),
  });

  const eventSaid = requireSerderSaid(vserder, "registry inception");
  if (telAccepted(rgy.reger, regk, 0, eventSaid)) {
    markTelComplete(rgy.reger, regk, 0, eventSaid);
  }
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
  credentialer.validate(creder);
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

  const telPre = requireSerderPrefix(iserder, "credential issue");
  const eventSaid = requireSerderSaid(iserder, "credential issue");
  const sn = iserder.sn ?? 0;
  if (telAccepted(rgy.reger, telPre, sn, eventSaid)) {
    markTelComplete(rgy.reger, requireCredentialSaid(creder), sn, eventSaid);
  }
  return credentialer.complete(requireCredentialSaid(creder))
    || reger.saved.get([requireCredentialSaid(creder)]) !== null;
}

function registerRegistry(
  rgy: Regery,
  name: string,
  hab: Hab,
  regk: string,
  options: { noBackers: boolean; estOnly: boolean },
): void {
  rgy.reger.registries.add(regk);
  rgy.reger.regs.pin(name, new RegistryRecord({ registryKey: regk, prefix: hab.pre }));
  if (!rgy.registries.has(name)) {
    rgy.registries.set(
      name,
      new Registry({
        name,
        hab,
        reger: rgy.reger,
        tvy: rgy.tvy,
        cues: rgy.cues,
        regk,
        noBackers: options.noBackers,
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

function seqner(num: number | bigint): Seqner {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new Seqner({ code: NumDex.Huge, raw });
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

function markTelComplete(reger: Reger, pre: string, sn: number, eventSaid: string): void {
  reger.ctel.pin([pre, seqner(sn).qb64], new Saider({ qb64: eventSaid }));
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

function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
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

function isKelRoute(route: string): route is MultisigKelRoute {
  return route === MULTISIG_ICP_ROUTE || route === MULTISIG_ROT_ROUTE || route === MULTISIG_IXN_ROUTE;
}

function isVdrRoute(route: string): route is MultisigVdrRoute {
  return route === MULTISIG_VCP_ROUTE || route === MULTISIG_ISS_ROUTE;
}

function requireText(value: string | undefined, label: string): string {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
  return value;
}
