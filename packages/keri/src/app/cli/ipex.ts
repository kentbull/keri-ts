import { type Operation } from "npm:effection@^3.6.0";
import { concatBytes, Diger, parseSerder, Prefixer, SerderKERI, smell } from "../../../../cesr/mod.ts";
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
}

interface IpexGrantArgs extends IpexBaseArgs {
  said?: string;
  agree?: string;
}

interface IpexAdmitArgs extends IpexBaseArgs {
  said?: string;
  grantFile?: string;
  noWait?: boolean;
}

interface IpexJoinArgs extends IpexBaseArgs {
  said?: string;
  auto?: boolean;
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
      },
    });
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
  const maxTurns = positiveInteger(args.maxTurns, 8, "max turns");
  const budgetMs = positiveInteger(args.budgetMs, 5_000, "budget milliseconds");
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

    for (let turn = 0; turn < maxTurns; turn++) {
      const batches = yield* processMailboxTurn(runtime, { hab, budgetMs });
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
  };
  requireNonEmpty(ipexArgs.said, "EXN SAID");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const exn = hby.db.exns.get([ipexArgs.said!]);
    if (!exn) {
      throw new ValidationError(`IPEX message ${ipexArgs.said} not found.`);
    }

    if (exn.route?.startsWith("/ipex/")) {
      console.log(JSON.stringify({ said: ipexArgs.said, route: exn.route, status: "single-sig" }));
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

    const approval = approveMultisigIpex(hby, runtime, exn, embedded);
    console.log(JSON.stringify({
      said: ipexArgs.said,
      route: exn.route,
      status: approval.accepted ? "multisig-approved" : "multisig-escrowed",
      embedded: embedded.said,
      embeddedRoute: embedded.route,
      group,
      lead: runtime.reactor.exchanger.lead(hby.habs.get(group)!, embedded.said!),
    }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

function approveMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  wrapper: SerderKERI,
  embedded: SerderKERI,
): { accepted: boolean } {
  const group = embedded.pre;
  const embeddedSaid = embedded.said;
  const wrapperSaid = wrapper.said;
  if (!group || !embeddedSaid || !wrapperSaid) {
    throw new ValidationError("Multisig IPEX approval requires wrapper, group, and embedded SAIDs.");
  }

  const groupHab = hby.habs.get(group);
  const groupRecord = hby.db.getHab(group);
  const memberPre = groupRecord?.mid;
  const memberHab = memberPre ? hby.habs.get(memberPre) : null;
  const groupKever = groupHab?.kever;
  const memberKey = memberHab?.kever?.verfers[0]?.qb64;
  if (!groupHab || !groupKever || !memberHab || !memberKey) {
    throw new ValidationError(`Local group ${group} is missing member signing state.`);
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
  const tsg = new TransIdxSigGroup(
    new Prefixer({ qb64: group }),
    groupKever.sner,
    new Diger({ qb64: groupKever.said }),
    sigers,
  );
  const pathed = multisigPathedAttachment(hby, wrapperSaid, "exn");
  const approved = concatBytes(
    serializeMessage(embedded, { tsgs: [tsg], pipelined: true }),
    pathed,
  );
  runtime.reactor.processChunk(approved, { local: true });
  runtime.reactor.processEscrowsOnce();
  return { accepted: hby.db.exns.get([embeddedSaid])?.said === embeddedSaid };
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
): Operation<void> {
  for (const message of messages) {
    yield* runtime.poster.sendBytes(hab, {
      recipient,
      message,
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery,
    });
  }
}
