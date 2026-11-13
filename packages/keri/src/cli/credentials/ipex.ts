import { concatBytes, Counter, parse, SerderKERI, type Versionage } from "cesr-ts";
import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import { Organizer } from "../../app/identity/organizing.ts";
import { approveGroupIpex, groupIpexStatus, waitForGroupIpex } from "../../app/ipex/group-ipex.ts";
import {
  type IpexSendDeps,
  requireIpexPrior,
  sendIpexAgree,
  sendIpexApply,
  sendIpexOffer,
  sendIpexSpurn,
  waitForIpexExchange,
} from "../../app/ipex/ipex-conversation.ts";
import {
  ipexCredentialAdmit,
  ipexCredentialGrant,
} from "../../app/ipex/ipex-credentialing.ts";
import {
  requireAdmittableGrant,
  sendIpexAdmit,
  sendIpexGrant,
  settleGrantCredential,
} from "../../app/ipex/ipex-granting.ts";
import {
  approveMultisigIpex,
  approveStoredMultisigIpexWrappers,
  findPendingMultisigIpex,
  groupIpexPartial,
  publishInitialGroupIpex,
  requireStoredExchange,
  sendCompletedGroupIpex,
  sendCredentialStream,
  storedExchangeMessage,
  storedMultisigIpexBody,
} from "../../app/ipex/ipex-grouping.ts";
import {
  IPEX_ADMIT_ROUTE,
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
  validateIpexReply,
} from "../../app/ipex/ipexing.ts";
import {
  ipexBaseline,
  MailboxIntakeTally,
  settleStoredGrants,
  waitForIpexArrival,
} from "../../app/mailbox/ipex-arrival.ts";
import { isLocalGroupHab, localGroupMember } from "../../app/multisig/group-members.ts";
import { MULTISIG_EXN_ROUTE } from "../../app/multisig/grouping.ts";
import type { GroupSendResult } from "../../app/multisig/multisig-messaging.ts";
import type { ProtocolProcessor } from "../../app/protocol/protocol-processing.ts";
import { abortable } from "../../app/runtime/abortable.ts";
import { type AgentRuntime, runAgentRuntime, settleMailboxPollBatch } from "../../app/runtime/agent-runtime.ts";
import { chunkBytes, collectBytes } from "../../app/transport/byte-source.ts";
import { fileBytes } from "../../app/transport/file-bytes.ts";
import { parseGvrsn } from "../../core/attachment-countering.ts";
import { ValidationError } from "../../core/errors.ts";
import { exchange } from "../../core/exchange/protocol-exchanging.ts";
import { Reger } from "../../db/reger.ts";
import { type CommandHaberyOptions, withAgentRuntime } from "../common/context.ts";
import { parseBooleanOption, parseNumberOption, parseStringOption } from "../common/parsing.ts";
import { withRuntimeWorkers } from "../common/runtime-workers.ts";

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
  timeout: number;
  approvalTimeoutSeconds: number;
}

/** Selected proposal and finite approval policy; stores and runtime remain borrowed. */
export interface IpexJoinOptions {
  alias?: string;
  gvrsn?: Versionage;
  said?: string;
  auto?: boolean;
  approvalTimeoutSeconds: number;
}

/** Captured EXN and finished transport destinations; presentation belongs to Tufa. */
export interface IpexSendResult {
  exn: SerderKERI;
  deliveries: string[];
  group?: GroupSendResult & { complete: boolean; lead: boolean | null };
}

/** Grant facts survive command cleanup. Group completion is distinct from completed member delivery. */
export interface IpexGrantResult {
  grant: SerderKERI;
  credential: string;
  support: number;
  deliveries: string[];
  group?: GroupSendResult & { complete: boolean; lead: boolean | null };
}

/** Wallet and authored-admit facts after cleanup; null admit means no response was signed. */
export interface IpexAdmitResult {
  admit: SerderKERI | null;
  grant: SerderKERI;
  credential: string;
  saved: boolean;
  deliveries: string[];
  group?: GroupSendResult & { complete: boolean; lead: boolean | null };
}

/** Settled mailbox observations and ordinary Serders, captured before the stores close. */
export interface IpexPollResult {
  batches: number;
  messages: number;
  ipex: SerderKERI[];
  saved: string[];
}

/** One selected exchange; null group approval/lead facts mean approval was not requested. */
export interface IpexJoinResult {
  exn: SerderKERI;
  group?: GroupSendResult & {
    embedded: SerderKERI;
    accepted: boolean | null;
    /** Local member approval; null in preview and independent of group acceptance. */
    approved: boolean | null;
    lead: boolean | null;
    /** Present for admit approval; each member checks its own wallet before a fresh signature. */
    credentialSaved?: boolean;
  };
}

/**
 * Implement `tufa ipex apply` by sending a schema/attribute request EXN.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexApplyCommand(args: Record<string, unknown>): Operation<IpexSendResult> {
  const ipexArgs = ipexBaseArgs(args);
  const timeout = nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds");
  const schema = parseStringOption(args.schema, "schema");
  requireNonEmpty(schema, "Schema");
  const attrs = parseJsonArg(parseStringOption(args.attrs, "attrs")) ?? {};
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
      requireString(ipexArgs.recipient, "Recipient"),
    );
    if (isLocalGroupHab(hby, hab)) {
      // TODO(group proposal API): replace with the multisig proposal API from app/multisig/counseling.ts.
      const prepared = exchange(IPEX_APPLY_ROUTE, {
        m: ipexArgs.message ?? "",
        s: schema,
        a: attrs,
        i: recipient,
      }, { sender: hab.pre, recipient });
      return yield* sendGroupConversation(hby, runtime, hab, recipient, prepared, timeout);
    }
    return yield* withRuntimeWorkers(runtime, { hab }, () =>
      sendIpexApply(ipexSendDeps(hby, runtime), hab, {
        recipient,
        schema: schema!,
        attrs,
        message: ipexArgs.message,
      }));
  });
}

/**
 * Implement `tufa ipex offer` with one embedded ACDC stream reference.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexOfferCommand(args: Record<string, unknown>): Operation<IpexSendResult> {
  const ipexArgs = ipexBaseArgs(args);
  const timeout = nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds");
  const acdcFile = parseStringOption(args.acdc, "acdc");
  requireNonEmpty(acdcFile, "ACDC file");
  const apply = parseStringOption(args.apply, "apply");
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
      requireString(ipexArgs.recipient, "Recipient"),
    );
    // A bad prior is reported before an unreadable ACDC file.
    if (apply) requireIpexPrior(hby, hab.pre, recipient, apply, "offer");
    const acdc = Deno.readFileSync(acdcFile!);
    if (isLocalGroupHab(hby, hab)) {
      // TODO(group proposal API): replace with the multisig proposal API from app/multisig/counseling.ts.
      const prepared = exchange(IPEX_OFFER_ROUTE, { m: ipexArgs.message ?? "" }, {
        sender: hab.pre,
        recipient,
        dig: apply,
        embeds: { acdc },
      });
      return yield* sendGroupConversation(hby, runtime, hab, recipient, prepared, timeout);
    }
    return yield* withRuntimeWorkers(
      runtime,
      { hab },
      () => sendIpexOffer(ipexSendDeps(hby, runtime), hab, { recipient, acdc, apply, message: ipexArgs.message }),
    );
  });
}

/** Implement `tufa ipex agree` as a response to an accepted offer EXN. */
export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<IpexSendResult> {
  return yield* sendPriorResponse(args, IPEX_AGREE_ROUTE, "offer");
}

/**
 * Send an initial IPEX rejection using the donor's stream-delivery operation.
 * @param args Command values identifying recipient, prior exchange and optional message.
 */
export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<IpexSendResult> {
  const ipexArgs = ipexBaseArgs(args);
  const timeout = nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds");
  const prior = requireString(parseStringOption(args.prior, "prior"), "Prior message");
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const dest = new Organizer(hby.db, hby.signator).resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    if (isLocalGroupHab(hby, hab)) {
      requireIpexPrior(hby, hab.pre, dest, prior, "spurn");
      // TODO(group proposal API): replace with the multisig proposal API from app/multisig/counseling.ts.
      const prepared = exchange(IPEX_SPURN_ROUTE, { m: ipexArgs.message ?? "" }, {
        sender: hab.pre,
        recipient: dest,
        dig: prior,
      });
      return yield* sendGroupConversation(hby, runtime, hab, dest, prepared, timeout);
    }
    return yield* withRuntimeWorkers(
      runtime,
      { hab },
      () => sendIpexSpurn(ipexSendDeps(hby, runtime), hab, { recipient: dest, prior, message: ipexArgs.message }),
    );
  });
}

/**
 * Implement `tufa ipex grant` and optional grant artifact export/delivery.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexGrantCommand(args: Record<string, unknown>): Operation<IpexGrantResult> {
  const ipexArgs: IpexGrantArgs = {
    ...ipexBaseArgs(args),
    said: parseStringOption(args.said, "said"),
    agree: parseStringOption(args.agree, "agree"),
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      120,
      "approval timeout seconds",
    ),
  };
  requireNonEmpty(ipexArgs.said, "Credential SAID");
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const selectedRecipient = requireString(ipexArgs.recipient, "Recipient");
    // Offline export accepts the supplied AID; network delivery resolves contacts/endpoints.
    let recipient: string;
    if (ipexArgs.out) {
      recipient = resolveAid(hby, selectedRecipient);
    } else {
      recipient = new Organizer(hby.db, hby.signator).resolveRecipient(selectedRecipient);
    }
    if (!isLocalGroupHab(hby, hab)) {
      return yield* withRuntimeWorkers(runtime, { hab }, function*() {
        const sent = yield* sendIpexGrant({ ...ipexSendDeps(hby, runtime), reger }, hab, {
          recipient,
          credential: ipexArgs.said!,
          message: ipexArgs.message,
          agree: ipexArgs.agree,
          gvrsn: ipexArgs.gvrsn,
          deliver: !ipexArgs.out,
        });
        if (ipexArgs.out) Deno.writeFileSync(ipexArgs.out, concatBytes(...sent.support, sent.wire));
        return {
          grant: sent.grant,
          credential: ipexArgs.said!,
          support: sent.support.length,
          deliveries: sent.deliveries,
        };
      });
    }
    // TODO(group proposal API): replace the group branch with the multisig proposal API from app/multisig/counseling.ts.
    if (ipexArgs.agree) requireConversationPrior(hby, hab, recipient, ipexArgs.agree, "grant");
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
      sign: false,
    });
    const genus = grant.grant.gvrsn ?? ipexArgs.gvrsn ?? grant.grant.pvrsn;
    const wire = groupIpexPartial(hby, hab, grant.grant, grant.attachments, genus);
    const signer = localGroupMember(hby, hab.pre);
    return yield* withRuntimeWorkers(runtime, { hab: signer, pollMailbox: true }, function*() {
      yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
      yield* runtime.protocol.processEscrowsOnce();
      const publication = yield* publishInitialGroupIpex(hby, runtime.protocol, runtime.postman, hab, wire, genus);
      const complete = yield* waitForGroupIpexApproval(
        hby,
        runtime.protocol,
        grant.grant.said!,
        ipexArgs.approvalTimeoutSeconds,
        reger,
      );
      const deliveries = [...publication.deliveries];
      if (!complete) {
        return {
          grant: grant.grant,
          credential: ipexArgs.said!,
          support: grant.support.length,
          deliveries,
          group: { ...publication, complete: false, lead: null },
        };
      }

      const completedGrant = requireStoredExchange(hby, grant.grant.said!);
      const completedWire = storedExchangeMessage(hby, completedGrant, genus);
      const lead = runtime.exc.lead(hab, completedGrant.said!);
      if (ipexArgs.out) Deno.writeFileSync(ipexArgs.out, concatBytes(...grant.support, completedWire));
      else if (lead) {
        deliveries.push(
          ...yield* sendCredentialStream(
            runtime.postman,
            signer,
            recipient,
            [...grant.support, completedWire],
          ),
        );
      }
      return {
        grant: completedGrant,
        credential: ipexArgs.said!,
        support: grant.support.length,
        deliveries,
        group: { ...publication, complete: true, lead },
      };
    });
  });
}

/**
 * Implement `tufa ipex admit` and holder-side grant artifact processing.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<IpexAdmitResult> {
  const ipexArgs: IpexAdmitArgs = {
    ...ipexBaseArgs(args),
    said: parseStringOption(args.said, "said"),
    grantFile: parseStringOption(args.grantFile, "grantFile"),
    noWait: parseBooleanOption(args.noWait, "noWait"),
    timeout: nonNegativeNumber(args.timeout, 60, "credential timeout seconds"),
    approvalTimeoutSeconds: nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds"),
  };
  if (!ipexArgs.said && !ipexArgs.grantFile) throw new ValidationError("Grant SAID or grant file is required.");
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
    const hab = requireHab(hby, ipexArgs.alias);
    // Validate the entire file before admitting any prefix or starting host work.
    const selected = yield* loadGrant(hby, ipexArgs);
    const group = isLocalGroupHab(hby, hab);
    const signer = group ? localGroupMember(hby, hab.pre) : hab;
    return yield* withRuntimeWorkers(runtime, { hab: signer, pollMailbox: group }, function*() {
      if (selected.wire) yield* runtime.reactor.processBytes(selected.wire);
      const { grant, recipient, credential } = requireAdmittableGrant({ hby, reger }, hab, selected.grant.said!);
      if (
        !ipexArgs.noWait
        && !(yield* settleAndWaitForCredential(
          hby,
          runtime.protocol,
          reger,
          grant,
          hab.pre,
          ipexArgs.gvrsn,
          ipexArgs.timeout,
        ))
      ) {
        return { admit: null, grant, credential, saved: false, deliveries: [] };
      }
      if (!group) {
        const sent = yield* sendIpexAdmit({ ...ipexSendDeps(hby, runtime), reger }, hab, grant.said!, {
          message: ipexArgs.message,
          gvrsn: ipexArgs.gvrsn,
          requireSaved: !ipexArgs.noWait,
          deliver: !ipexArgs.out,
        });
        if (ipexArgs.out) Deno.writeFileSync(ipexArgs.out, sent.wire);
        return { admit: sent.admit, grant, credential, saved: sent.saved, deliveries: sent.deliveries };
      }
      // TODO(group proposal API): replace the group branch with the multisig proposal API from app/multisig/counseling.ts.
      const saved = !!reger.saved.get([credential]);
      const prepared = ipexCredentialAdmit({
        hab,
        reger,
        grant,
        message: ipexArgs.message ?? "",
        options: { requireSaved: !ipexArgs.noWait, gvrsn: ipexArgs.gvrsn },
        sign: false,
      });
      const genus = prepared.admit.gvrsn ?? ipexArgs.gvrsn ?? prepared.admit.pvrsn;
      const wire = groupIpexPartial(hby, hab, prepared.admit, prepared.attachments, genus);
      yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
      yield* runtime.protocol.processEscrowsOnce();
      const deliveries: string[] = [];
      const publication = yield* publishInitialGroupIpex(hby, runtime.protocol, runtime.postman, hab, wire, genus);
      deliveries.push(...publication.deliveries);
      const complete = yield* waitForGroupIpexApproval(
        hby,
        runtime.protocol,
        prepared.admit.said!,
        ipexArgs.approvalTimeoutSeconds,
        reger,
      );
      const lead = complete ? runtime.exc.lead(hab, prepared.admit.said!) : null;
      if (complete) {
        const completedWire = storedExchangeMessage(hby, requireStoredExchange(hby, prepared.admit.said!), genus);
        if (ipexArgs.out) Deno.writeFileSync(ipexArgs.out, completedWire);
        else if (lead) {
          deliveries.push(...yield* sendCredentialStream(runtime.postman, signer, recipient, [completedWire]));
        }
      }
      return { admit: prepared.admit, grant, credential, saved, deliveries, group: { ...publication, complete, lead } };
    });
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

/** Observe settled mailbox input and stored grant replay until new IPEX state or an elapsed deadline. */
export function* ipexPollCommand(args: Record<string, unknown>): Operation<IpexPollResult> {
  const ipexArgs = ipexBaseArgs(args);
  const timeoutMs = nonNegativeNumber(args.timeout, 40, "poll timeout seconds") * 1000;
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
    const hab = ipexArgs.alias ? requireHab(hby, ipexArgs.alias) : undefined;
    const arrivals = { hby, reger };
    const baseline = ipexBaseline(arrivals);
    const tally = new MailboxIntakeTally();

    const signer = hab && isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
    // The CLI has no running runtime: it runs the workers and a mailbox poller around the library wait.
    const result = yield* withRuntimeWorkers(runtime, { hab: signer, pollMailbox: false }, function*() {
      const mailbox = yield* spawn(function*() {
        yield* runtime.mailboxPoller.pollDo((batch) =>
          tally.track(batch, () => settleMailboxPollBatch(runtime, batch))
        );
      });
      try {
        return yield* waitForIpexArrival(
          {
            ...arrivals,
            settle: () => settleStoredGrants({ ...arrivals, hby, protocol: runtime.protocol }, ipexArgs.gvrsn),
          },
          baseline,
          { timeoutMs, tally },
        );
      } finally {
        yield* mailbox.halt();
      }
    });

    return {
      batches: tally.batches,
      messages: tally.messages,
      ipex: result.status.ipex,
      saved: result.status.saved,
    };
  }, { ipexQueries: "refuse" });
}

/**
 * Implement multisig IPEX approval over a pending `/multisig/exn` wrapper.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexJoinCommand(args: Record<string, unknown>): Operation<IpexJoinResult> {
  const ipexArgs: IpexJoinOptions = {
    ...ipexBaseArgs(args),
    said: parseStringOption(args.said, "said"),
    auto: parseBooleanOption(args.auto, "auto"),
    approvalTimeoutSeconds: nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds"),
  };
  return yield* withIpexRuntime(ipexArgs, ({ hby, runtime, reger }) => joinIpexProposal(hby, runtime, reger, ipexArgs));
}

/** Borrow existing protocol owners for one selected proposal; review never signs. */
export function* joinIpexProposal(
  hby: Habery,
  runtime: AgentRuntime,
  reger: Reger | null,
  ipexArgs: IpexJoinOptions,
): Operation<IpexJoinResult> {
  const pollHab = ipexArgs.alias ? requireHab(hby, ipexArgs.alias) : undefined;
  const exn = ipexArgs.said ? hby.db.exns.get([ipexArgs.said]) : yield* nextPendingMultisigIpex(hby, runtime, {
    hab: pollHab,
    timeoutMs: ipexArgs.approvalTimeoutSeconds * 1000,
  });
  if (!exn) {
    throw new ValidationError(
      ipexArgs.said
        ? `IPEX message ${ipexArgs.said} not found.`
        : "No pending multisig IPEX proposal was available to join.",
    );
  }

  if (exn.route?.startsWith("/ipex/")) {
    return { exn };
  }

  if (exn.route !== MULTISIG_EXN_ROUTE) {
    throw new ValidationError(`EXN ${ipexArgs.said} is not an IPEX or multisig IPEX message.`);
  }

  const embedded = storedMultisigIpexBody(hby.db, exn);
  if (!embedded?.route?.startsWith("/ipex/")) {
    throw new ValidationError(`Multisig EXN ${ipexArgs.said} does not wrap an IPEX message.`);
  }
  const group = embedded.pre;
  if (!group || !hby.habs.has(group)) {
    throw new ValidationError(`Multisig IPEX sender ${group ?? "<missing>"} is not a local group AID.`);
  }

  if (!ipexArgs.auto) {
    return { exn, group: { embedded, accepted: null, approved: null, lead: null, messages: [], deliveries: [] } };
  }

  if (embedded.pvrsn.major === 2) {
    // ACDC v2: the runtime's group IPEX owner approves, publishes, collects and lets the lead deliver.
    const ops = runtime.operations?.groupIpex;
    if (!ops) throw new ValidationError("ACDC v2 group IPEX requires the runtime's operation owners.");
    const said = embedded.said!;
    const status = groupIpexStatus(ops, said);
    if (status.state === "active" && status.phase === "awaitingConsent") yield* approveGroupIpex(ops, { said });
    yield* withRuntimeWorkers(
      runtime,
      { hab: localGroupMember(hby, group), pollMailbox: true },
      () => waitForGroupIpex(ops, said, { timeoutMs: ipexArgs.approvalTimeoutSeconds * 1000 }),
    );
    const outcome = ops.outcomes.get(said);
    return {
      exn,
      group: {
        embedded,
        accepted: runtime.exc.complete(said),
        approved: true,
        lead: runtime.exc.lead(hby.habs.get(group)!, said),
        messages: outcome?.messages ?? [],
        deliveries: outcome?.deliveries ?? [],
      },
    };
  }

  const host = yield* spawn(() => runAgentRuntime(runtime, { hab: localGroupMember(hby, group) }));
  let credentialSaved: boolean | undefined;
  try {
    if (embedded.pvrsn.major === 1 && embedded.route === IPEX_ADMIT_ROUTE) {
      if (!reger) throw new ValidationError("VDR runtime did not open Reger.");
      const prior = embedded.ked?.p;
      const grant = typeof prior === "string" && prior.length > 0 ? hby.db.exns.get([prior]) : null;
      credentialSaved = !!grant && (yield* settleAndWaitForCredential(
        hby,
        runtime.protocol,
        reger,
        grant,
        group,
        ipexArgs.gvrsn,
        ipexArgs.approvalTimeoutSeconds,
      ));
      if (!credentialSaved) {
        return {
          exn,
          group: {
            embedded,
            accepted: runtime.exc.complete(embedded.said!),
            approved: false,
            lead: null,
            credentialSaved,
            messages: [],
            deliveries: [],
          },
        };
      }
    }
    // Collect independent stored child proofs before deciding completion or
    // electing delivery, without losing the original approved wrapper identity.
    yield* approveStoredMultisigIpexWrappers(hby, runtime.protocol, embedded.said!, reger);
    const approval = yield* approveMultisigIpex(hby, runtime.protocol, runtime.postman, reger, exn, {
      publish: true,
      gvrsn: ipexArgs.gvrsn,
    });
    return {
      exn,
      group: {
        embedded,
        accepted: approval.accepted,
        approved: approval.approved !== null,
        lead: runtime.exc.lead(hby.habs.get(group)!, embedded.said!),
        credentialSaved,
        messages: approval.messages,
        deliveries: approval.deliveries,
      },
    };
  } finally {
    yield* host.halt();
  }
}

/**
 * Send a prior-correlated IPEX response through the command's single host.
 * Validate the accepted predecessor before signing, then return group/transport
 * facts after joining workers. The outer resource owner closes stores afterward.
 *
 * @param args Parsed IPEX command flags, including recipient and prior-message SAID.
 * @param route Response exchange route to construct.
 * @param priorLabel Argument key naming the required prior message.
 */
function* sendPriorResponse(
  args: Record<string, unknown>,
  route: string,
  priorLabel: string,
): Operation<IpexSendResult> {
  const ipexArgs = ipexBaseArgs(args);
  const timeout = nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds");
  const prior = parseStringOption(args[priorLabel], priorLabel);
  requireNonEmpty(prior, priorLabel);
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
      requireString(ipexArgs.recipient, "Recipient"),
    );
    if (isLocalGroupHab(hby, hab)) {
      requireIpexPrior(hby, hab.pre, recipient, prior!, "agree");
      // TODO(group proposal API): replace with the multisig proposal API from app/multisig/counseling.ts.
      const prepared = exchange(route, { m: ipexArgs.message ?? "" }, { sender: hab.pre, recipient, dig: prior });
      return yield* sendGroupConversation(hby, runtime, hab, recipient, prepared, timeout);
    }
    return yield* withRuntimeWorkers(
      runtime,
      { hab },
      () => sendIpexAgree(ipexSendDeps(hby, runtime), hab, { recipient, offer: prior!, message: ipexArgs.message }),
    );
  });
}

/** Validate an accepted predecessor and its known parties before any local signing. */
function requireConversationPrior(
  hby: Habery,
  hab: Hab,
  recipient: string,
  said: string,
  verb: "offer" | "agree" | "grant" | "admit" | "spurn",
): void {
  requireIpexPrior(hby, hab.pre, recipient, said, verb);
}

/** Collaborators for the library send operations, adapted once from the command runtime. */
function ipexSendDeps(hby: Habery, runtime: AgentRuntime): IpexSendDeps {
  return { hby, reactor: runtime.reactor, protocol: runtime.protocol, postman: runtime.postman };
}

/**
 * Run one group command host through local intake, member approval and concrete delivery.
 * Group publication and business acceptance are separate facts; only an accepted
 * child's elected member sends it externally. The caller's resource scope closes
 * stores after this host joins. Single-signature sends use `sendIpex*`.
 */
function* sendGroupConversation(
  hby: Habery,
  runtime: AgentRuntime,
  hab: Hab,
  recipient: string,
  [exn, attachments]: readonly [SerderKERI, Uint8Array],
  timeout: number,
): Operation<IpexSendResult> {
  const genus = exn.gvrsn ?? exn.pvrsn;
  const wire = groupIpexPartial(hby, hab, exn, attachments, genus);
  const signer = localGroupMember(hby, hab.pre);
  const host = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: true }));
  try {
    yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
    yield* runtime.protocol.processEscrowsOnce();
    const publication = yield* publishInitialGroupIpex(hby, runtime.protocol, runtime.postman, hab, wire, genus);
    const complete = yield* waitForGroupIpexApproval(hby, runtime.protocol, exn.said!, timeout, null);
    const lead = complete ? runtime.exc.lead(hab, exn.said!) : null;
    const deliveries = [...publication.deliveries];
    if (lead) deliveries.push(...yield* sendCompletedGroupIpex(hby, runtime.postman, null, hab, exn, genus));
    return { exn, deliveries, group: { ...publication, complete, lead } };
  } finally {
    yield* host.halt();
  }
}

function ipexBaseArgs(args: Record<string, unknown>): IpexBaseArgs {
  return {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
    alias: parseStringOption(args.alias, "alias"),
    recipient: parseStringOption(args.recipient, "recipient"),
    message: parseStringOption(args.message, "message"),
    out: parseStringOption(args.out, "out"),
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
  runtime?: CommandHaberyOptions["runtime"],
): Operation<TResult> {
  requireNonEmpty(args.name, "Name");
  return yield* withAgentRuntime(
    args,
    {
      compat: args.compat ?? false,
      runtime,
    },
    function*({ hby, runtime }) {
      const rgy = runtime.vdr;
      if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
      const reger = rgy.reger;
      return yield* use({ hby, runtime, reger });
    },
  );
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

function nonNegativeNumber(value: unknown, fallback: number, label: string): number {
  const parsed = parseNumberOption(value, label) ?? fallback;
  if (parsed < 0 || !Number.isFinite(parsed * 1000)) {
    throw new ValidationError(`${label} must be a finite nonnegative number.`);
  }
  return parsed;
}

function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}

function parseJsonArg(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const text = value.startsWith("@") ? Deno.readTextFileSync(value.slice(1)) : value;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("attrs must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
/** Scan a file through valid EOF before choosing a grant, or use its persisted exchange record. */
function* loadGrant(hby: Habery, args: IpexAdmitArgs): Operation<{ grant: SerderKERI; wire?: Uint8Array }> {
  if (args.grantFile) {
    const path = args.grantFile;
    return yield* abortable(async (signal) => {
      let grant: SerderKERI | undefined;
      const wire = await collectBytes(fileBytes(path, { signal }));
      const frames = parse(chunkBytes(wire, { signal }));
      try {
        while (true) {
          signal.throwIfAborted();
          const result = await frames.next();
          signal.throwIfAborted();
          if (result.done) break;
          const frame = result.value;
          if (!grant && frame.body instanceof SerderKERI && frame.body.route === IPEX_GRANT_ROUTE) grant = frame.body;
        }
      } finally {
        await frames.return();
      }
      if (grant) return { grant, wire };
      throw new ValidationError(`Grant file ${path} does not contain an IPEX grant.`);
    });
  }
  requireNonEmpty(args.said, "Grant SAID");
  const grant = hby.db.exns.get([args.said!]);
  if (!grant || grant.route !== IPEX_GRANT_ROUTE) {
    throw new ValidationError(`Grant ${args.said} not found.`);
  }
  return { grant };
}

function grantSender(grant: SerderKERI): string {
  const sender = grant.ked?.i;
  if (typeof sender !== "string" || sender.length === 0) {
    throw new ValidationError("Grant is missing sender AID.");
  }
  return sender;
}

/**
 * Import this grant's authenticated artifacts once, then observe ordinary wallet
 * escrow progress. The caller runs the host and selects the elapsed wait; no
 * admit signature is produced here. Missing evidence remains pending on expiry.
 */
function* settleAndWaitForCredential(
  hby: Habery,
  protocol: ProtocolProcessor,
  reger: Reger,
  grant: SerderKERI,
  recipient: string,
  genus: Versionage | undefined,
  timeout: number,
): Operation<boolean> {
  yield* settleGrantCredential({ hby, reger, protocol }, recipient, grant.said!, { gvrsn: genus });
  const waited = yield* waitForIpexExchange({ hby, reger }, grant.said!, {
    timeoutMs: timeout * 1000,
    until: "credential-saved",
  });
  return waited.outcome === "settled";
}

/**
 * Observe one child's approvals under an elapsed deadline. The command's existing
 * host owns delivery, mailbox input and escrow work throughout this wait; this
 * observer neither starts workers nor changes the original event identity.
 */
function* waitForGroupIpexApproval(
  hby: Habery,
  protocol: ProtocolProcessor,
  embeddedSaid: string,
  timeout: number,
  reger: Reger | null,
): Operation<boolean> {
  const deadline = Date.now() + timeout * 1000;
  while (!protocol.exc.complete(embeddedSaid)) {
    yield* approveStoredMultisigIpexWrappers(hby, protocol, embeddedSaid, reger);
    if (protocol.exc.complete(embeddedSaid)) return true;
    if (Date.now() >= deadline) return false;
    yield* sleep(Math.min(250, deadline - Date.now()));
  }
  return true;
}

/** Observe stored proposals while the host progresses input, then join before approval. */
function* nextPendingMultisigIpex(
  hby: Habery,
  runtime: AgentRuntime,
  { hab, timeoutMs }: { hab?: Hab; timeoutMs: number },
): Operation<SerderKERI | null> {
  const found = findPendingMultisigIpex(hby.db);
  if (found || timeoutMs === 0) return found;
  const signer = hab && isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
  const deadline = Date.now() + timeoutMs;
  const host = yield* spawn(() => runAgentRuntime(runtime, { hab: signer }));
  try {
    while (true) {
      const pending = findPendingMultisigIpex(hby.db);
      if (pending) return pending;
      if (Date.now() >= deadline) return null;
      yield* sleep(Math.min(250, deadline - Date.now()));
    }
  } finally {
    yield* host.halt();
  }
}

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    return () => clearTimeout(timeout);
  });
}
