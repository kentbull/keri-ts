/**
 * Multisig proposal and approval workflows.
 *
 * CLI adapters own prompts, output, and argument parsing. This module owns
 * proposal publishing, mailbox polling, KEL/RPY/VDR approval, and delegation
 * completion for command-local multisig operations.
 */
import { action, type Operation } from "npm:effection@^3.6.0";
import {
  concatBytes,
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
} from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { RegistryRecord } from "../core/records.ts";
import { Reger } from "../db/reger.ts";
import { Credentialer, Regery, Registry, serializeCredential } from "../vdr/credentialing.ts";
import { Tevery } from "../vdr/eventing.ts";
import { type AgentRuntime, processMailboxTurn, processRuntimeUntil } from "./agent-runtime.ts";
import { resolveDelegationCommunicationHab } from "./delegating.ts";
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
  multisigPathedAttachment,
} from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import { queryTransportSink } from "./query-transport.ts";
import { Verifier } from "./verifying.ts";

const MULTISIG_TOPIC = "multisig";

export type MultisigKelRoute =
  | typeof MULTISIG_ICP_ROUTE
  | typeof MULTISIG_ROT_ROUTE
  | typeof MULTISIG_IXN_ROUTE;
export type MultisigVdrRoute = typeof MULTISIG_VCP_ROUTE | typeof MULTISIG_ISS_ROUTE;
export type MultisigRpyRoute = typeof MULTISIG_RPY_ROUTE;
export type MultisigProposalRoute = MultisigKelRoute | MultisigVdrRoute | MultisigRpyRoute;

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
  pollTurns: number;
  pollBudgetMs: number;
  callbacks: MultisigApprovalCallbacks;
}

interface NoticeLike {
  rid: string;
  attrs: { r?: unknown; d?: unknown };
}

/** Publish one KEL-style group proposal to remote members. */
export function* publishProposal(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  route: MultisigKelRoute,
  label: "icp" | "rot" | "ixn",
  payload: Record<string, unknown>,
  embeddedMessage: Uint8Array,
): Operation<string[]> {
  return yield* publishProposalEmbeds(
    runtime,
    member,
    recipients,
    route,
    payload,
    { [label]: embeddedMessage },
  );
}

/** Publish one multisig proposal with explicit embedded attachments. */
export function* publishProposalEmbeds(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  route: MultisigProposalRoute,
  payload: Record<string, unknown>,
  embeds: Record<string, Uint8Array>,
): Operation<string[]> {
  const deliveries: string[] = [];
  for (const recipient of uniqueMembers(recipients)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const result = yield* runtime.poster.sendExchange(member, {
      recipient,
      route,
      payload,
      embeds,
      topic: MULTISIG_TOPIC,
    });
    deliveries.push(...result.deliveries, ...result.queued);
  }
  return deliveries;
}

/** Poll until a specific group KEL event is accepted or attempts expire. */
export function* waitForGroupAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  serder: SerderKERI,
  options: MultisigApprovalOptions,
): Operation<boolean> {
  if (eventAccepted(hby, serder)) {
    return true;
  }
  for (let turn = 0; turn < options.pollTurns; turn++) {
    yield* processOnePendingApproval(hby, runtime, options);
    if (eventAccepted(hby, serder)) {
      return true;
    }
    yield* processMailboxTurn(runtime, { budgetMs: options.pollBudgetMs });
    runtime.reactor.processEscrowsOnce();
    yield* sleep(250);
  }
  return eventAccepted(hby, serder);
}

/** Poll for and approve one pending multisig notification. */
export function* waitForOneApproval(
  hby: Habery,
  runtime: AgentRuntime,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  for (let turn = 0; turn < options.pollTurns; turn++) {
    const result = yield* processOnePendingApproval(hby, runtime, options);
    if (result) {
      return result;
    }
    yield* processMailboxTurn(runtime, { budgetMs: options.pollBudgetMs });
    runtime.reactor.processEscrowsOnce();
    yield* sleep(250);
  }
  return null;
}

/** Wait for a locally authored group event to complete through stored approvals. */
export function* waitForLocalGroupCompletion(
  hby: Habery,
  runtime: AgentRuntime,
  options: MultisigApprovalOptions,
): Operation<ApprovalResult | null> {
  if (!options.group || options.said) {
    return null;
  }
  const groupHab = groupHabByAliasOrPrefix(hby, options.group);
  if (!groupHab?.pre) {
    return null;
  }
  const serder = localGroupJoinSerder(hby, groupHab.pre);
  if (!serder) {
    return null;
  }
  const route = routeForKelEvent(serder);
  if (!route) {
    return null;
  }
  const accepted = yield* waitForGroupAcceptance(hby, runtime, serder, options);
  return {
    route,
    said: "",
    embedded: serder.said ?? "",
    group: groupHab.pre,
    accepted,
    deliveries: [],
  };
}

/** Poll for endpoint-role reply state after a group RPY proposal. */
export function* waitForReplyAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  groupPre: string,
  role: string,
  eid: string,
  options: MultisigApprovalOptions,
): Operation<boolean> {
  if (endpointRoleAccepted(hby, groupPre, role, eid)) {
    return true;
  }
  for (let turn = 0; turn < options.pollTurns; turn++) {
    yield* processOnePendingApproval(hby, runtime, options);
    if (endpointRoleAccepted(hby, groupPre, role, eid)) {
      return true;
    }
    yield* processMailboxTurn(runtime, { budgetMs: options.pollBudgetMs });
    runtime.reactor.processEscrowsOnce();
    yield* sleep(250);
  }
  return endpointRoleAccepted(hby, groupPre, role, eid);
}

/** Complete the delegation workflow for an accepted delegated group event. */
export function* completeDelegationIfNeeded(
  hby: Habery,
  runtime: AgentRuntime,
  pre: string,
  proxy?: string,
): Operation<string | null> {
  const kever = hby.db.getKever(pre);
  if (!kever?.delpre) {
    return null;
  }
  const communicationHab = resolveDelegationCommunicationHab(hby, proxy);
  if (!communicationHab) {
    throw new ValidationError(
      `Delegated group event for ${pre} requires --proxy <alias>.`,
    );
  }
  runtime.delegating.beginLatest(pre, kever.sn, { communicationHab });
  const sink = queryTransportSink(runtime, hby, communicationHab);
  yield* processRuntimeUntil(
    runtime,
    () => runtime.delegating.complete(pre, kever.sn),
    { hab: communicationHab, sink, maxTurns: 512, pollMailbox: true },
  );
  return runtime.delegating.workflowStatus(pre, kever.sner.numh).phase;
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

function* processOnePendingApproval(
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
    const result = isKelRoute(route)
      ? yield* approveKelProposal(hby, runtime, exn, route, options)
      : isVdrRoute(route)
      ? yield* approveVdrProposal(hby, runtime, exn, route, options)
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
  const embeddedSad = embeddedSection(exn.ked ?? {})?.rpy;
  if (!isRecord(embeddedSad)) {
    return null;
  }

  const rpySerder = new SerderKERI({ sad: embeddedSad });
  const embeddedSaid = rpySerder.said ?? "";
  if (!options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid || "<unknown>" })) {
    return null;
  }

  const peerAttachment = multisigPathedAttachment(hby, wrapperSaid, "rpy");
  runtime.reactor.processChunk(
    concatBytes(rpySerder.raw, peerAttachment),
    { local: true },
  );

  const localRpy = groupEndorseReply(hby, groupPre, rpySerder);
  runtime.reactor.processChunk(localRpy, { local: true });
  runtime.reactor.processEscrowsOnce();

  const attrs = rpyAttrs(rpySerder);
  const deliveries = yield* publishProposalEmbeds(
    runtime,
    member,
    groupSigningMembers(hby, groupPre),
    route,
    payload,
    { rpy: localRpy },
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
  const payload = payloadSection(exn.ked ?? {});
  const label = route === MULTISIG_ICP_ROUTE ? "icp" : route === MULTISIG_ROT_ROUTE ? "rot" : "ixn";
  const embeddedSad = embeddedSection(exn.ked ?? {})?.[label];
  if (!isRecord(embeddedSad)) {
    return null;
  }
  const serder = new SerderKERI({ sad: embeddedSad });
  const embeddedSaid = serder.said;
  const groupPre = groupPrefixFromProposal(route, payload, serder);
  const members = proposalMembers(route, payload);
  const member = route === MULTISIG_IXN_ROUTE ? localGroupMember(hby, groupPre) : findLocalMember(hby, members);
  if (!member) {
    throw new ValidationError(`No local member found for multisig proposal ${wrapperSaid}.`);
  }

  if (!options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid ?? "<unknown>" })) {
    return null;
  }

  if (route === MULTISIG_ICP_ROUTE || (route === MULTISIG_ROT_ROUTE && !hby.habs.has(groupPre))) {
    const smids = stringArrayField(payload, "smids");
    const rmids = stringArrayField(payload, "rmids");
    const alias = options.callbacks.chooseGroupAlias(groupPre);
    hby.joinGroupHab(groupPre, alias, member, smids, rmids.length > 0 ? rmids : smids);
  }

  const keys = groupEventKeys(hby, groupPre, serder);
  const smids = route === MULTISIG_IXN_ROUTE ? stringArrayField(payload, "smids") : proposalSigningMembers(payload);
  const sigers = signLocalGroupEvent(hby, serder, smids, keys);
  const localMessage = messagize(serder, { sigers, pipelined: true });
  const peerAttachment = multisigPathedAttachment(hby, wrapperSaid, label);
  runtime.reactor.processChunk(concatBytes(localMessage, peerAttachment), { local: true });
  runtime.reactor.processEscrowsOnce();

  const deliveries = yield* publishProposal(runtime, member, members, route, label, payload, localMessage);
  const accepted = eventAccepted(hby, serder);

  return { route, said: wrapperSaid, embedded: embeddedSaid ?? "", group: groupPre, accepted, deliveries };
}

function* approveVdrProposal(
  hby: Habery,
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
  const anchorSad = embed?.anc;
  if (!isRecord(embeddedSad) || !isRecord(anchorSad)) {
    return null;
  }

  const embeddedSerder = new SerderKERI({ sad: embeddedSad });
  const anchorSerder = new SerderKERI({ sad: anchorSad });
  const embeddedSaid = embeddedSerder.said ?? "";
  if (!options.callbacks.approveProposal({ route, group: groupPre, embedded: embeddedSaid || "<unknown>" })) {
    return null;
  }

  const smids = groupSigningMembers(hby, groupPre);
  const keys = groupEventKeys(hby, groupPre, anchorSerder);
  const sigers = signLocalGroupEvent(hby, anchorSerder, smids, keys);
  const localAnchor = messagize(anchorSerder, { sigers, pipelined: true });
  const peerAnchorAttachment = multisigPathedAttachment(hby, wrapperSaid, "anc");
  runtime.reactor.processChunk(concatBytes(localAnchor, peerAnchorAttachment), { local: true });
  runtime.reactor.processEscrowsOnce();

  let accepted = false;
  let embeds: Record<string, Uint8Array>;
  if (route === MULTISIG_VCP_ROUTE) {
    accepted = approveRegistryIncept(runtime, groupHab, embeddedSerder, anchorSerder, options);
    embeds = { vcp: embeddedSerder.raw, anc: localAnchor };
  } else {
    const acdcSad = embed?.acdc;
    if (!isRecord(acdcSad)) {
      return null;
    }
    const creder = new SerderACDC({ sad: acdcSad });
    accepted = approveCredentialIssue(runtime, hby, creder, embeddedSerder, anchorSerder);
    const seal = telCredentialSeal(embeddedSerder);
    embeds = {
      acdc: serializeCredential(creder, seal.prefixer, seal.seqner, seal.saider),
      iss: embeddedSerder.raw,
      anc: localAnchor,
    };
  }

  const deliveries = yield* publishProposalEmbeds(runtime, member, smids, route, payload, embeds);
  return { route, said: wrapperSaid, embedded: embeddedSaid, group: groupPre, accepted, deliveries };
}

function groupPrefixFromProposal(
  route: MultisigKelRoute,
  payload: Record<string, unknown>,
  serder: SerderKERI,
): string {
  if (route === MULTISIG_ICP_ROUTE) {
    return requireText(serder.pre ?? undefined, "Group prefix");
  }
  return requireText(stringField(payload, "gid") || serder.pre || undefined, "Group prefix");
}

function proposalMembers(route: MultisigKelRoute, payload: Record<string, unknown>): string[] {
  if (route === MULTISIG_IXN_ROUTE) {
    return stringArrayField(payload, "smids");
  }
  return uniqueMembers([...stringArrayField(payload, "smids"), ...stringArrayField(payload, "rmids")]);
}

function proposalSigningMembers(payload: Record<string, unknown>): string[] {
  return stringArrayField(payload, "smids");
}

function approveRegistryIncept(
  runtime: AgentRuntime,
  groupHab: Hab,
  vserder: SerderKERI,
  anchorSerder: SerderKERI,
  options: MultisigApprovalOptions,
): boolean {
  const seal = sourceSeal(anchorSerder);
  requireTevery(runtime).processEvent({ serder: vserder, seqner: seal.seqner, saider: seal.saider });
  requireRegery(runtime).processEscrows();

  const regk = requireSerderPrefix(vserder, "registry inception");
  const registryName = options.callbacks.chooseRegistryName(regk);
  const cnfg = stringArrayField(vserder.ked ?? {}, "c");
  registerRegistry(requireRegery(runtime), registryName, groupHab, regk, {
    noBackers: cnfg.includes(TraitDex.NoBackers),
    estOnly: cnfg.includes(TraitDex.EstOnly),
  });

  const eventSaid = requireSerderSaid(vserder, "registry inception");
  if (telAccepted(runtime, regk, 0, eventSaid)) {
    markTelComplete(runtime, regk, 0, eventSaid);
  }
  return telAccepted(runtime, regk, 0, eventSaid);
}

function approveCredentialIssue(
  runtime: AgentRuntime,
  hby: Habery,
  creder: SerderACDC,
  iserder: SerderKERI,
  anchorSerder: SerderKERI,
): boolean {
  const seal = sourceSeal(anchorSerder);
  requireTevery(runtime).processEvent({ serder: iserder, seqner: seal.seqner, saider: seal.saider });
  requireRegery(runtime).processEscrows();

  const reger = requireReger(runtime);
  const vry = requireVerifier(runtime);
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
  if (telAccepted(runtime, telPre, sn, eventSaid)) {
    markTelComplete(runtime, requireCredentialSaid(creder), sn, eventSaid);
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

function telAccepted(runtime: AgentRuntime, pre: string, sn: number, eventSaid: string): boolean {
  return requireReger(runtime).tels.getOn(pre, sn)?.qb64 === eventSaid;
}

function markTelComplete(runtime: AgentRuntime, pre: string, sn: number, eventSaid: string): void {
  requireReger(runtime).ctel.pin([pre, seqner(sn).qb64], new Saider({ qb64: eventSaid }));
}

function requireReger(runtime: AgentRuntime): Reger {
  if (!(runtime.vdr.reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return runtime.vdr.reger;
}

function requireRegery(runtime: AgentRuntime): Regery {
  if (!(runtime.vdr.rgy instanceof Regery)) {
    throw new ValidationError("VDR runtime did not open Regery.");
  }
  return runtime.vdr.rgy;
}

function requireTevery(runtime: AgentRuntime): Tevery {
  if (!(runtime.vdr.tvy instanceof Tevery)) {
    throw new ValidationError("VDR runtime did not open Tevery.");
  }
  return runtime.vdr.tvy;
}

function requireVerifier(runtime: AgentRuntime): Verifier {
  if (!(runtime.vdr.vry instanceof Verifier)) {
    throw new ValidationError("VDR runtime did not open Verifier.");
  }
  return runtime.vdr.vry;
}

function rpyAttrs(serder: SerderKERI): { cid: string; role: string; eid: string } {
  const attrs = serder.ked?.a as Record<string, unknown> | undefined;
  const cid = typeof attrs?.cid === "string" ? attrs.cid : "";
  const role = typeof attrs?.role === "string" ? attrs.role : "";
  const eid = typeof attrs?.eid === "string" ? attrs.eid : "";
  if (!cid || !role || !eid) {
    throw new ValidationError("Multisig reply is missing cid, role, or eid.");
  }
  return { cid, role, eid };
}

function groupHabByAliasOrPrefix(hby: Habery, group: string): Hab | null {
  return hby.habByName(group) ?? hby.habs.get(group) ?? null;
}

function localGroupJoinSerder(hby: Habery, groupPre: string): SerderKERI | null {
  const kever = hby.db.getKever(groupPre);
  if (kever?.serder) {
    return kever.serder;
  }
  return hby.db.getEvtSerder(groupPre, groupPre);
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

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    return () => clearTimeout(id);
  });
}
