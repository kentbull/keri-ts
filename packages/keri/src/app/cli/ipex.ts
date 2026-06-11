import { type Operation } from "npm:effection@^3.6.0";
import {
  concatBytes,
  parseSerder,
  SerderKERI,
  smell,
  type Versionage,
} from "../../../../cesr/mod.ts";
import { parseGvrsn } from "../../core/attachment-countering.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { Reger } from "../../db/reger.ts";
import { type AgentRuntime, processMailboxTurn } from "../agent-runtime.ts";
import { splitCesrStream } from "../cesr-http.ts";
import {
  isLocalGroupHab,
  localGroupMember,
} from "../group-members.ts";
import { embeddedBusinessExnSAD, MULTISIG_EXN_ROUTE } from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import {
  credentialSaidFromGrant,
  ipexCredentialAdmit,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
} from "../ipex-credentialing.ts";
import {
  approveMultisigIpex,
  groupIpexPartial,
  nextPendingMultisigIpex,
  publishGroupIpexProposal,
  requireStoredExchange,
  sendCredentialBytes,
  storedExchangeMessage,
  waitForMultisigIpexCompletion,
} from "../ipex-grouping.ts";
import {
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
} from "../ipexing.ts";
import { withAgentRuntime } from "./common/context.ts";

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
  gvrsn?: Versionage;
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

/** Implement `tufa ipex apply` by sending a schema/attribute request EXN. */
export function* ipexApplyCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const schema = args.schema as string | undefined;
  requireNonEmpty(schema, "Schema");
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
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
  });
}

/** Implement `tufa ipex offer` with one embedded ACDC stream reference. */
export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const acdcFile = args.acdc as string | undefined;
  requireNonEmpty(acdcFile, "ACDC file");
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
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
  });
}

/** Implement `tufa ipex agree` as a response to an accepted offer EXN. */
export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
  yield* sendPriorResponse(args, IPEX_AGREE_ROUTE, "offer");
}

/** Implement `tufa ipex spurn` as a rejection response in an IPEX thread. */
export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
  yield* sendPriorResponse(args, IPEX_SPURN_ROUTE, "prior");
}

/** Implement `tufa ipex grant` and optional grant artifact export/delivery. */
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
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
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
        gvrsn: ipexArgs.gvrsn,
      },
      sign: !isLocalGroupHab(hby, hab),
    });
    const group = isLocalGroupHab(hby, hab);
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
        ipexArgs.gvrsn,
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
  });
}

/** Implement `tufa ipex admit` and holder-side grant artifact processing. */
export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs: IpexAdmitArgs = {
    ...ipexBaseArgs(args),
    said: args.said as string | undefined,
    grantFile: args.grantFile as string | undefined,
    noWait: args.noWait as boolean | undefined,
  };
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
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
  });
}

/** Implement `tufa ipex list` by printing locally accepted IPEX EXNs. */
export function* ipexListCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  yield* withIpexRuntime(ipexArgs, function*({ hby }) {
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
  });
}

/** Implement bounded mailbox polling plus stored grant replay for holders. */
export function* ipexPollCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const pollTurns = positiveInteger(args.pollTurns, 8, "poll turns");
  const pollBudgetMs = positiveInteger(args.pollBudgetMs, 5_000, "poll budget milliseconds");
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
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
  });
}

/** Implement multisig IPEX approval over a pending `/multisig/exn` wrapper. */
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
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const pollHab = ipexArgs.alias ? requireHab(hby, ipexArgs.alias) : undefined;
    const exn = ipexArgs.said
      ? hby.db.exns.get([ipexArgs.said])
      : yield* nextPendingMultisigIpex(hby, runtime, { hab: pollHab, pollTurns, pollBudgetMs });
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
      gvrsn: ipexArgs.gvrsn,
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
  yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
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
  });
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
    gvrsn: parseGvrsn(args.gvrsn),
  };
}

interface IpexRuntimeContext {
  hby: Habery;
  runtime: AgentRuntime;
  reger: Reger;
}

function* withIpexRuntime<TResult>(
  args: IpexBaseArgs,
  use: (context: IpexRuntimeContext) => Operation<TResult>,
): Operation<TResult> {
  requireNonEmpty(args.name, "Name");
  return yield* withAgentRuntime(
    args,
    {
      compat: args.compat ?? false,
      skipConfig: true,
    },
    function*({ hby, runtime }) {
      const reger = requireReger(runtime);
      return yield* use({ hby, runtime, reger });
    },
  );
}

function requireReger(runtime: AgentRuntime): Reger {
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return reger;
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
