import { action, type Operation } from "npm:effection@^3.6.0";
import {
  type Cigar,
  concatBytes,
  Diger,
  makePather,
  parseSerder,
  Prefixer,
  Seqner,
  SerderKERI,
  type Siger,
  smell,
} from "../../../../cesr/mod.ts";
import {
  type AttachmentCounterProfile,
  normalizeAttachmentCounterProfile,
} from "../../core/attachment-counter-profile.ts";
import { TransIdxSigGroup } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { serializeMessage } from "../../core/protocol-exchanging.ts";
import { Reger } from "../../db/reger.ts";
import { type AgentRuntime, createAgentRuntime, processMailboxTurn } from "../agent-runtime.ts";
import { splitCesrStream } from "../cesr-http.ts";
import { embeddedBusinessExnSAD, MULTISIG_EXN_ROUTE, multisigPathedAttachment } from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import {
  credentialPresentationArtifacts,
  credentialPresentationSupportMessages,
  credentialSaidFromGrant,
  ipexCredentialAdmit,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
} from "../ipex-credentialing.ts";
import {
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
} from "../ipexing.ts";
import { setupHby } from "./common/existing.ts";

interface IpexBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
  alias?: string;
  recipient?: string;
  message?: string;
  out?: string;
  delivery?: "auto" | "direct" | "indirect";
  counterProfile?: AttachmentCounterProfile;
}

interface IpexGrantArgs extends IpexBaseArgs {
  said?: string;
  agree?: string;
  approvalTimeoutSeconds: number;
}

interface IpexAdmitArgs extends IpexBaseArgs {
  said?: string;
  grantFile?: string;
  noWait?: boolean;
}

interface IpexJoinArgs extends IpexBaseArgs {
  said?: string;
  auto?: boolean;
  pollTurns?: number;
  pollBudgetMs?: number;
}

export function* ipexApplyCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const schema = args.schema as string | undefined;
  requireNonEmpty(schema, "Schema");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const result = yield* runtime.poster.sendExchange(hab, {
      recipient,
      route: IPEX_APPLY_ROUTE,
      payload: {
        m: ipexArgs.message ?? "",
        s: schema,
        a: parseJsonArg(args.attrs as string | undefined) ?? {},
        i: recipient,
      },
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery: ipexArgs.delivery,
    });
    console.log(JSON.stringify({ said: result.serder.said, deliveries: result.deliveries, queued: result.queued }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const acdcFile = args.acdc as string | undefined;
  requireNonEmpty(acdcFile, "ACDC file");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const result = yield* runtime.poster.sendExchange(hab, {
      recipient,
      route: IPEX_OFFER_ROUTE,
      payload: { m: ipexArgs.message ?? "" },
      dig: args.apply as string | undefined,
      embeds: { acdc: Deno.readFileSync(acdcFile!) },
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery: ipexArgs.delivery,
    });
    console.log(JSON.stringify({ said: result.serder.said, deliveries: result.deliveries, queued: result.queued }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
  yield* sendPriorResponse(args, IPEX_AGREE_ROUTE, "offer");
}

export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
  yield* sendPriorResponse(args, IPEX_SPURN_ROUTE, "prior");
}

export function* ipexGrantCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs: IpexGrantArgs = {
    ...ipexBaseArgs(args),
    said: args.said as string | undefined,
    agree: args.agree as string | undefined,
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      120,
      "approval timeout seconds",
    ),
  };
  requireNonEmpty(ipexArgs.said, "Credential SAID");
  const { hby, runtime, reger } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = ipexArgs.out
      ? resolveAid(hby, requireString(ipexArgs.recipient, "Recipient"))
      : runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const grant = ipexCredentialGrant({
      hby,
      hab,
      reger,
      recipient,
      credentialSaid: ipexArgs.said!,
      message: ipexArgs.message ?? "",
      options: {
        agree: ipexArgs.agree ? hby.db.exns.get([ipexArgs.agree]) : null,
        counterProfile: ipexArgs.counterProfile,
      },
      sign: !isGroupHab(hby, hab),
    });
    const group = isGroupHab(hby, hab);
    if (group) {
      const partialGrant = groupIpexPartial(hby, hab, grant.grant, undefined, grant.attachments);
      runtime.reactor.processCompleteChunk(partialGrant, { local: true });
      runtime.reactor.processEscrowsOnce();

      const deliveries = yield* publishGroupIpexProposal(
        runtime,
        hab,
        partialGrant,
      );
      const complete = ipexArgs.approvalTimeoutSeconds > 0
        ? yield* waitForMultisigIpexCompletion(hby, runtime, hab, grant.grant.said!, ipexArgs.approvalTimeoutSeconds)
        : runtime.reactor.exchanger.complete(grant.grant.said!);

      if (!complete) {
        console.log(JSON.stringify({
          said: grant.grant.said,
          credential: ipexArgs.said,
          support: grant.support.length,
          status: "multisig-pending",
          deliveries,
        }));
        return;
      }

      const completedGrant = requireStoredExchange(hby, grant.grant.said!);
      const completedGrantWire = storedExchangeMessage(
        hby,
        completedGrant,
        ipexArgs.counterProfile,
      );
      const stream = concatBytes(...grant.support, completedGrantWire);
      if (ipexArgs.out) {
        Deno.writeFileSync(ipexArgs.out, stream);
      } else if (runtime.reactor.exchanger.lead(hab, completedGrant.said!)) {
        yield* sendCredentialBytes(
          runtime,
          localGroupMember(hby, hab.pre),
          recipient,
          [...grant.support, completedGrantWire],
          ipexArgs.delivery,
        );
      }
      console.log(JSON.stringify({
        said: completedGrant.said,
        credential: ipexArgs.said,
        support: grant.support.length,
        status: "multisig-complete",
        lead: runtime.reactor.exchanger.lead(hab, completedGrant.said!),
        deliveries,
      }));
      return;
    }

    const stream = concatBytes(...grant.support, grant.wire);
    if (ipexArgs.out) {
      Deno.writeFileSync(ipexArgs.out, stream);
    } else {
      yield* sendCredentialBytes(runtime, hab, recipient, [...grant.support, grant.wire], ipexArgs.delivery);
    }
    console.log(JSON.stringify({ said: grant.grant.said, credential: ipexArgs.said, support: grant.support.length }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs: IpexAdmitArgs = {
    ...ipexBaseArgs(args),
    said: args.said as string | undefined,
    grantFile: args.grantFile as string | undefined,
    noWait: args.noWait as boolean | undefined,
  };
  const { hby, runtime, reger } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const grant = loadGrant(hby, ipexArgs);
    const admit = ipexCredentialAdmit({
      hab,
      reger,
      grant,
      message: ipexArgs.message ?? "",
      options: { requireSaved: !(ipexArgs.noWait ?? false) },
    });
    const recipient = grantSender(grant);
    if (ipexArgs.out) {
      Deno.writeFileSync(ipexArgs.out, admit.wire);
    } else {
      yield* sendCredentialBytes(runtime, hab, recipient, [admit.wire], ipexArgs.delivery);
    }
    console.log(JSON.stringify({ said: admit.admit.said, grant: grant.said }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexListCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    for (const [, exn] of hby.db.exns.getTopItemIter()) {
      const route = exn.route ?? "";
      if (!route.startsWith("/ipex/")) {
        continue;
      }
      console.log(JSON.stringify({
        said: exn.said,
        route,
        sender: exn.ked?.i,
        prior: exn.ked?.p,
      }));
    }
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexPollCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const pollTurns = positiveInteger(args.pollTurns, 8, "poll turns");
  const pollBudgetMs = positiveInteger(args.pollBudgetMs, 5_000, "poll budget milliseconds");
  const { hby, runtime, reger } = yield* openRuntime(ipexArgs);
  try {
    const hab = ipexArgs.alias ? requireHab(hby, ipexArgs.alias) : undefined;
    const beforeExns = new Set(
      [...hby.db.exns.getTopItemIter()]
        .map(([, exn]) => exn.said)
        .filter((said): said is string => typeof said === "string"),
    );
    const beforeSaved = savedCredentials(reger);
    let batchesSeen = 0;
    let messagesSeen = 0;

    for (let turn = 0; turn < pollTurns; turn++) {
      const batches = yield* processMailboxTurn(runtime, { hab, budgetMs: pollBudgetMs });
      batchesSeen += batches.length;
      messagesSeen += batches.reduce((total, batch) => total + batch.messages.length, 0);
      processStoredCredentialGrants(hby, runtime, reger);
      runtime.reactor.processEscrowsOnce();
      if (newIpexMessages(hby, beforeExns).length > 0 || newSavedCredentials(reger, beforeSaved).length > 0) {
        break;
      }
    }

    console.log(JSON.stringify({
      batches: batchesSeen,
      messages: messagesSeen,
      ipex: newIpexMessages(hby, beforeExns),
      saved: newSavedCredentials(reger, beforeSaved),
    }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexJoinCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs: IpexJoinArgs = {
    ...ipexBaseArgs(args),
    said: args.said as string | undefined,
    auto: args.auto as boolean | undefined,
    pollTurns: args.pollTurns as number | undefined,
    pollBudgetMs: args.pollBudgetMs as number | undefined,
  };
  const pollTurns = positiveInteger(ipexArgs.pollTurns, 32, "poll turns");
  const pollBudgetMs = positiveInteger(ipexArgs.pollBudgetMs, 2000, "poll budget milliseconds");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const exn = ipexArgs.said
      ? hby.db.exns.get([ipexArgs.said])
      : yield* nextPendingMultisigIpex(hby, runtime, { ...ipexArgs, pollTurns, pollBudgetMs });
    if (!exn) {
      throw new ValidationError(
        ipexArgs.said
          ? `IPEX message ${ipexArgs.said} not found.`
          : "No pending multisig IPEX proposal was available to join.",
      );
    }

    if (exn.route?.startsWith("/ipex/")) {
      console.log(JSON.stringify({ said: exn.said, route: exn.route, status: "single-sig" }));
      return;
    }

    if (exn.route !== MULTISIG_EXN_ROUTE) {
      throw new ValidationError(`EXN ${ipexArgs.said} is not an IPEX or multisig IPEX message.`);
    }

    const embeddedSad = embeddedBusinessExnSAD(exn);
    if (!embeddedSad || typeof embeddedSad.r !== "string" || !embeddedSad.r.startsWith("/ipex/")) {
      throw new ValidationError(`Multisig EXN ${ipexArgs.said} does not wrap an IPEX message.`);
    }

    const embedded = new SerderKERI({ sad: embeddedSad });
    const group = embedded.pre;
    if (!group || !hby.habs.has(group)) {
      throw new ValidationError(`Multisig IPEX sender ${group ?? "<missing>"} is not a local group AID.`);
    }

    if (!ipexArgs.auto) {
      console.log(JSON.stringify({
        said: ipexArgs.said,
        route: exn.route,
        status: "multisig-pending",
        embedded: embedded.said,
        embeddedRoute: embedded.route,
        group,
      }));
      return;
    }

    const approval = yield* approveMultisigIpex(hby, runtime, exn, embedded, {
      publish: true,
      delivery: ipexArgs.delivery,
      counterProfile: ipexArgs.counterProfile,
    });
    console.log(JSON.stringify({
      said: ipexArgs.said,
      route: exn.route,
      status: approval.accepted ? "multisig-approved" : "multisig-escrowed",
      embedded: embedded.said,
      embeddedRoute: embedded.route,
      group,
      lead: runtime.reactor.exchanger.lead(hby.habs.get(group)!, embedded.said!),
      deliveries: approval.deliveries,
    }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

function* approveMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  wrapper: SerderKERI,
  embedded: SerderKERI,
  options: {
    publish?: boolean;
    delivery?: "auto" | "direct" | "indirect";
    sendLead?: boolean;
    counterProfile?: AttachmentCounterProfile;
  } = {},
): Operation<{ accepted: boolean; deliveries: string[]; approved: Uint8Array }> {
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
        options.counterProfile,
      )),
    );
  }
  return {
    accepted: hby.db.exns.get([embeddedSaid])?.said === embeddedSaid,
    deliveries,
    approved,
  };
}

function isGroupHab(hby: Habery, hab: Hab): boolean {
  return !!hab.pre && !!hby.db.getHab(hab.pre)?.mid;
}

function groupIpexPartial(
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

function localGroupMember(hby: Habery, groupPre: string): Hab {
  const record = hby.db.getHab(groupPre);
  const member = record?.mid ? hby.habs.get(record.mid) : null;
  if (!member) {
    throw new ValidationError(`Group ${groupPre} is missing local member metadata.`);
  }
  return member;
}

function groupSigningMembers(hby: Habery, groupPre: string): string[] {
  const stored = hby.ks.getSmids(groupPre).map((tuple) => tuple[0].qb64);
  if (stored.length > 0) {
    return stored;
  }
  const record = hby.db.getHab(groupPre);
  return record?.smids ?? [];
}

function* publishGroupIpexProposal(
  runtime: AgentRuntime,
  groupHab: Hab,
  embedded: Uint8Array,
  delivery?: "auto" | "direct" | "indirect",
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

function* waitForMultisigIpexCompletion(
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

function* approveStoredMultisigIpexWrappers(
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

function* nextPendingMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  args: IpexJoinArgs,
): Operation<SerderKERI | null> {
  const pollTurns = positiveInteger(args.pollTurns, 32, "poll turns");
  const pollBudgetMs = positiveInteger(args.pollBudgetMs, 2000, "poll budget milliseconds");
  const hab = args.alias ? requireHab(hby, args.alias) : undefined;
  for (let turn = 0; turn < pollTurns; turn += 1) {
    const found = findPendingMultisigIpex(hby, runtime);
    if (found) {
      return found;
    }
    yield* processMailboxTurn(runtime, { hab, budgetMs: pollBudgetMs });
    runtime.reactor.processEscrowsOnce();
    const afterPoll = findPendingMultisigIpex(hby, runtime);
    if (afterPoll) {
      return afterPoll;
    }
  }
  return null;
}

function findPendingMultisigIpex(hby: Habery, runtime: AgentRuntime): SerderKERI | null {
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

function* sendCompletedGroupIpex(
  runtime: AgentRuntime,
  groupHab: Hab,
  embedded: SerderKERI,
  delivery?: "auto" | "direct" | "indirect",
  counterProfile: AttachmentCounterProfile = "legacy",
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
        counterProfile,
      );
      grantPathed = grantPathedMaterials(artifacts);
      messages.push(...credentialPresentationSupportMessages(
        runtime.hby,
        reger,
        creder,
        recipient,
        counterProfile,
      ));
    }
  }

  messages.push(storedExchangeMessage(
    runtime.hby,
    requireStoredExchange(runtime.hby, embedded.said),
    counterProfile,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStoredExchange(hby: Habery, said: string): SerderKERI {
  const stored = hby.db.exns.get([said]);
  if (!stored) {
    throw new ValidationError(`Exchange ${said} is not stored as accepted.`);
  }
  return stored;
}

function storedExchangeMessage(
  hby: Habery,
  serder: SerderKERI,
  counterProfile: AttachmentCounterProfile = "legacy",
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
    counterProfile,
  });
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

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    return () => clearTimeout(timeout);
  });
}

function* sendPriorResponse(
  args: Record<string, unknown>,
  route: string,
  priorLabel: string,
): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const prior = args[priorLabel] as string | undefined;
  requireNonEmpty(prior, priorLabel);
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const result = yield* runtime.poster.sendExchange(hab, {
      recipient,
      route,
      payload: { m: ipexArgs.message ?? "" },
      dig: prior,
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery: ipexArgs.delivery,
    });
    console.log(JSON.stringify({ said: result.serder.said, deliveries: result.deliveries, queued: result.queued }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

function ipexBaseArgs(args: Record<string, unknown>): IpexBaseArgs {
  return {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    alias: args.alias as string | undefined,
    recipient: args.recipient as string | undefined,
    message: args.message as string | undefined,
    out: args.out as string | undefined,
    delivery: args.delivery as "auto" | "direct" | "indirect" | undefined,
    counterProfile: normalizeAttachmentCounterProfile(args.counterProfile),
  };
}

function* openRuntime(args: IpexBaseArgs): Operation<{ hby: Habery; runtime: AgentRuntime; reger: Reger }> {
  requireNonEmpty(args.name, "Name");
  const hby = yield* setupHby(
    args.name!,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      skipConfig: true,
    },
  );
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return { hby, runtime, reger };
}

function requireHab(hby: Habery, alias: string | undefined): Hab {
  requireNonEmpty(alias, "Alias");
  const hab = hby.habByName(alias!);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for alias ${alias}.`);
  }
  return hab;
}

function resolveAid(hby: Habery, value: string): string {
  return hby.habByName(value)?.pre ?? value;
}

function requireString(value: string | undefined, label: string): string {
  requireNonEmpty(value, label);
  return value!;
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${label} must be a finite nonnegative number.`);
  }
  return parsed;
}

function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}

function newIpexMessages(
  hby: Habery,
  before: Set<string>,
): Array<{ said: string; route: string; sender: unknown; prior: unknown }> {
  const messages: Array<{ said: string; route: string; sender: unknown; prior: unknown }> = [];
  for (const [, exn] of hby.db.exns.getTopItemIter()) {
    const said = exn.said;
    const route = exn.route ?? "";
    if (!said || before.has(said) || !route.startsWith("/ipex/")) {
      continue;
    }
    messages.push({
      said,
      route,
      sender: exn.ked?.i,
      prior: exn.ked?.p,
    });
  }
  return messages;
}

function savedCredentials(reger: Reger): Set<string> {
  return new Set([...reger.saved.getTopItemIter()].map(([keys]) => keys[0]).filter((key): key is string => !!key));
}

function newSavedCredentials(reger: Reger, before: Set<string>): string[] {
  return [...savedCredentials(reger)].filter((said) => !before.has(said));
}

function processStoredCredentialGrants(
  hby: Habery,
  runtime: AgentRuntime,
  reger: Reger,
): void {
  for (const [, grant] of hby.db.exns.getTopItemIter()) {
    if (grant.route !== IPEX_GRANT_ROUTE) {
      continue;
    }
    const credentialSaid = credentialSaidFromGrant(grant);
    if (!credentialSaid || reger.saved.get([credentialSaid])) {
      continue;
    }
    processCredentialPresentationArtifacts(
      runtime.reactor,
      storedGrantArtifacts(hby, grant),
    );
  }
}

function parseJsonArg(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const text = value.startsWith("@") ? Deno.readTextFileSync(value.slice(1)) : value;
  return JSON.parse(text) as Record<string, unknown>;
}

function loadGrant(hby: Habery, args: IpexAdmitArgs): SerderKERI {
  if (args.grantFile) {
    const raw = Deno.readFileSync(args.grantFile);
    for (const frame of splitCesrStream(raw)) {
      const { smellage } = smell(frame);
      const serder = parseSerder(frame.slice(0, smellage.size), smellage);
      if (serder instanceof SerderKERI && serder.route === IPEX_GRANT_ROUTE) {
        return serder;
      }
    }
    throw new ValidationError(`Grant file ${args.grantFile} does not contain an IPEX grant.`);
  }
  requireNonEmpty(args.said, "Grant SAID");
  const grant = hby.db.exns.get([args.said!]);
  if (!grant || grant.route !== IPEX_GRANT_ROUTE) {
    throw new ValidationError(`Grant ${args.said} not found.`);
  }
  return grant;
}

function grantSender(grant: SerderKERI): string {
  const sender = grant.ked?.i;
  if (typeof sender !== "string" || sender.length === 0) {
    throw new ValidationError("Grant is missing sender AID.");
  }
  return sender;
}

function* sendCredentialBytes(
  runtime: AgentRuntime,
  hab: Hab,
  recipient: string,
  messages: Uint8Array[],
  delivery: "auto" | "direct" | "indirect" | undefined,
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
