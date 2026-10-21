import { concatBytes, Counter, parse, SerderKERI, type Versionage } from "cesr-ts";
import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import { parseGvrsn } from "../../core/attachment-countering.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { exchange } from "../../core/protocol-exchanging.ts";
import { Reger } from "../../db/reger.ts";
import { abortable } from "../abortable.ts";
import { type AgentRuntime, runAgentRuntime, settleMailboxPollBatch } from "../agent-runtime.ts";
import { chunkBytes, collectBytes, fileBytes } from "../byte-source.ts";
import { isLocalGroupHab, localGroupMember } from "../group-members.ts";
import { embeddedBusinessExnSAD, MULTISIG_EXN_ROUTE } from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import {
  credentialSaidFromGrant,
  ipexCredentialAdmit,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
  validateAdmitGrant,
} from "../ipex-credentialing.ts";
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
} from "../ipex-grouping.ts";
import {
  IPEX_ADMIT_ROUTE,
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
  ipexRecipient,
  PREVIOUS_IPEX_ROUTES,
} from "../ipexing.ts";
import type { GroupSendResult } from "../multisig-messaging.ts";
import { Organizer } from "../organizing.ts";
import type { ProtocolProcessor } from "../protocol-processing.ts";
import { withAgentRuntime } from "./common/context.ts";
import { parseBooleanOption, parseNumberOption, parseStringOption } from "./common/parsing.ts";

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

interface IpexJoinArgs extends IpexBaseArgs {
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
    const prepared = exchange(IPEX_APPLY_ROUTE, {
      m: ipexArgs.message ?? "",
      s: schema,
      a: attrs,
      i: recipient,
    }, { sender: hab.pre, recipient });
    return yield* sendConversation(hby, runtime, hab, recipient, prepared, timeout);
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
    if (apply) requireConversationPrior(hby, hab, recipient, apply, "offer");
    const prepared = exchange(IPEX_OFFER_ROUTE, { m: ipexArgs.message ?? "" }, {
      sender: hab.pre,
      recipient,
      dig: apply,
      embeds: { acdc: Deno.readFileSync(acdcFile!) },
    });
    return yield* sendConversation(hby, runtime, hab, recipient, prepared, timeout);
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
    requireConversationPrior(hby, hab, dest, prior, "spurn");
    const prepared = exchange(IPEX_SPURN_ROUTE, { m: ipexArgs.message ?? "" }, {
      sender: hab.pre,
      recipient: dest,
      dig: prior,
    });
    return yield* sendConversation(hby, runtime, hab, dest, prepared, timeout);
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
    if (ipexArgs.agree) requireConversationPrior(hby, hab, recipient, ipexArgs.agree, "grant");
    const group = isLocalGroupHab(hby, hab);
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
      sign: !group,
    });
    const genus = grant.grant.gvrsn ?? ipexArgs.gvrsn ?? grant.grant.pvrsn;
    const wire = group ? groupIpexPartial(hby, hab, grant.grant, grant.attachments, genus) : grant.wire;
    const signer = group ? localGroupMember(hby, hab.pre) : hab;
    const host = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: group }));
    try {
      yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
      yield* runtime.protocol.processEscrowsOnce();
      if (!group) {
        if (!runtime.exc.complete(grant.grant.said!)) throw new ValidationError("Local IPEX grant was not accepted.");
        const deliveries: string[] = [];
        if (!ipexArgs.out) {
          deliveries.push(
            ...yield* sendCredentialStream(
              runtime.postman,
              hab,
              recipient,
              [...grant.support, wire],
            ),
          );
        }
        if (ipexArgs.out) Deno.writeFileSync(ipexArgs.out, concatBytes(...grant.support, wire));
        return { grant: grant.grant, credential: ipexArgs.said!, support: grant.support.length, deliveries };
      }

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
    } finally {
      yield* host.halt();
    }
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
    const host = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: group }));
    try {
      if (selected.wire) yield* runtime.reactor.processBytes(selected.wire);
      const grant = requireStoredExchange(hby, selected.grant.said!);
      const recipient = grantSender(grant);
      requireConversationPrior(hby, hab, recipient, grant.said!, "admit");
      const credential = validateAdmitGrant(grant, hab.pre, reger, false);
      if (
        !ipexArgs.noWait
        && !(yield* settleGrantCredential(
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
      const saved = !!reger.saved.get([credential]);
      const prepared = ipexCredentialAdmit({
        hab,
        reger,
        grant,
        message: ipexArgs.message ?? "",
        options: { requireSaved: !ipexArgs.noWait, gvrsn: ipexArgs.gvrsn },
        sign: !group,
      });
      const genus = prepared.admit.gvrsn ?? ipexArgs.gvrsn ?? prepared.admit.pvrsn;
      const wire = group ? groupIpexPartial(hby, hab, prepared.admit, prepared.attachments, genus) : prepared.wire;
      yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
      yield* runtime.protocol.processEscrowsOnce();
      const deliveries: string[] = [];
      if (!group) {
        if (!runtime.exc.complete(prepared.admit.said!)) {
          throw new ValidationError("Local IPEX admit was not accepted.");
        }
        if (ipexArgs.out) Deno.writeFileSync(ipexArgs.out, wire);
        else deliveries.push(...yield* sendCredentialStream(runtime.postman, signer, recipient, [wire]));
        return { admit: prepared.admit, grant, credential, saved, deliveries };
      }
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
    } finally {
      yield* host.halt();
    }
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
    const beforeExns = new Set(
      [...hby.db.exns.getTopItemIter()]
        .map(([, exn]) => exn.said)
        .filter((said): said is string => typeof said === "string"),
    );
    const beforeSaved = savedCredentials(reger);
    let batchesSeen = 0;
    let messagesSeen = 0;

    const signer = hab && isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
    const deadline = Date.now() + timeoutMs;
    let receiving = 0;
    const host = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: false }));
    try {
      const mailbox = yield* spawn(function*() {
        yield* runtime.mailboxPoller.pollDo(function*(batch) {
          receiving++;
          try {
            yield* settleMailboxPollBatch(runtime, batch);
            batchesSeen++;
            messagesSeen += batch.messages.length;
          } finally {
            receiving--;
          }
        });
      });
      try {
        while (true) {
          yield* processStoredCredentialGrants(hby, runtime, reger, ipexArgs.gvrsn);
          // State may become visible before the rest of a delivered batch settles.
          if (
            receiving === 0
            && (newIpexMessages(hby, beforeExns).length > 0 || newSavedCredentials(reger, beforeSaved).length > 0)
          ) {
            break;
          }
          if (Date.now() >= deadline) break;
          yield* sleep(Math.min(250, deadline - Date.now()));
        }
      } finally {
        yield* mailbox.halt();
      }
    } finally {
      yield* host.halt();
    }

    return {
      batches: batchesSeen,
      messages: messagesSeen,
      ipex: newIpexMessages(hby, beforeExns),
      saved: newSavedCredentials(reger, beforeSaved),
    };
  });
}

/**
 * Implement multisig IPEX approval over a pending `/multisig/exn` wrapper.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexJoinCommand(args: Record<string, unknown>): Operation<IpexJoinResult> {
  const ipexArgs: IpexJoinArgs = {
    ...ipexBaseArgs(args),
    said: parseStringOption(args.said, "said"),
    auto: parseBooleanOption(args.auto, "auto"),
    approvalTimeoutSeconds: nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds"),
  };
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
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
      return { exn, group: { embedded, accepted: null, lead: null, messages: [], deliveries: [] } };
    }

    const host = yield* spawn(() => runAgentRuntime(runtime, { hab: localGroupMember(hby, group) }));
    let credentialSaved: boolean | undefined;
    try {
      if (embedded.route === IPEX_ADMIT_ROUTE) {
        const prior = embedded.ked?.p;
        const grant = typeof prior === "string" && prior.length > 0 ? hby.db.exns.get([prior]) : null;
        credentialSaved = !!grant && (yield* settleGrantCredential(
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
          lead: runtime.exc.lead(hby.habs.get(group)!, embedded.said!),
          credentialSaved,
          messages: approval.messages,
          deliveries: approval.deliveries,
        },
      };
    } finally {
      yield* host.halt();
    }
  });
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
    requireConversationPrior(hby, hab, recipient, prior!, "agree");
    const prepared = exchange(route, { m: ipexArgs.message ?? "" }, { sender: hab.pre, recipient, dig: prior });
    return yield* sendConversation(hby, runtime, hab, recipient, prepared, timeout);
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
  const prior = hby.db.exns.get([said]);
  if (!prior || !PREVIOUS_IPEX_ROUTES.get(verb)!.some(route => prior.route === `/ipex/${route}`)) {
    throw new ValidationError("Prior IPEX exchange is missing or has the wrong route.");
  }
  const intended = ipexRecipient(prior);
  if (prior.pre !== recipient || (typeof intended === "string" && intended.length > 0 && intended !== hab.pre)) {
    throw new ValidationError("IPEX response parties do not match the accepted prior exchange.");
  }
  if (hby.db.erpy.get([said])) {
    throw new ValidationError("Prior IPEX exchange already has an accepted response; resume the existing exchange.");
  }
}

/**
 * Run one command host through local intake, member approval and concrete delivery.
 * Local conversation state survives transport failure. Group publication and business
 * acceptance are separate facts; only an accepted child's elected member sends it
 * externally. The caller's resource scope closes stores after this host joins.
 */
function* sendConversation(
  hby: Habery,
  runtime: AgentRuntime,
  hab: Hab,
  recipient: string,
  [exn, attachments]: readonly [SerderKERI, Uint8Array],
  timeout: number,
): Operation<IpexSendResult> {
  const group = isLocalGroupHab(hby, hab);
  const genus = exn.gvrsn ?? exn.pvrsn;
  const wire = group
    ? groupIpexPartial(hby, hab, exn, attachments, genus)
    : concatBytes(hab.endorse(exn, { pipelined: false, gvrsn: genus }), attachments);
  const signer = group ? localGroupMember(hby, hab.pre) : hab;
  const host = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: group }));
  try {
    yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
    yield* runtime.protocol.processEscrowsOnce();
    if (!group) {
      if (!runtime.exc.complete(exn.said!)) throw new ValidationError("Local IPEX exchange was not accepted.");
      let deliveries: string[];
      if (exn.route === IPEX_SPURN_ROUTE) {
        deliveries = yield* sendCredentialStream(runtime.postman, hab, recipient, [wire]);
      } else {
        const evt = runtime.postman.send(
          { src: hab.pre, dest: recipient, topic: CREDENTIAL_MAILBOX_TOPIC, msg: wire },
          { notify: true },
        );
        const outcome = yield* runtime.postman.wait(evt);
        if (outcome.kin === "failed") throw outcome.error;
        deliveries = outcome.deliveries;
      }
      return { exn, deliveries };
    }
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
): Operation<TResult> {
  requireNonEmpty(args.name, "Name");
  return yield* withAgentRuntime(
    args,
    {
      compat: args.compat ?? false,
      skipConfig: true,
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

function newIpexMessages(
  hby: Habery,
  before: Set<string>,
): SerderKERI[] {
  const messages: SerderKERI[] = [];
  for (const [, exn] of hby.db.exns.getTopItemIter()) {
    const said = exn.said;
    const route = exn.route ?? "";
    if (!said || before.has(said) || !route.startsWith("/ipex/")) {
      continue;
    }
    messages.push(exn);
  }
  return messages;
}

function savedCredentials(reger: Reger): Set<string> {
  return new Set([...reger.saved.getTopItemIter()].map(([keys]) => keys[0]).filter((key): key is string => !!key));
}

function newSavedCredentials(reger: Reger, before: Set<string>): string[] {
  return [...savedCredentials(reger)].filter((said) => !before.has(said));
}

/** Settle accepted grant artifacts before the poll command reports newly saved credentials. */
function* processStoredCredentialGrants(
  hby: Habery,
  runtime: AgentRuntime,
  reger: Reger,
  gvrsn?: Versionage,
): Operation<void> {
  for (const [, grant] of hby.db.exns.getTopItemIter()) {
    if (grant.route !== IPEX_GRANT_ROUTE) {
      continue;
    }
    const credentialSaid = credentialSaidFromGrant(grant);
    if (!credentialSaid || reger.saved.get([credentialSaid])) {
      continue;
    }
    yield* processCredentialPresentationArtifacts(
      runtime.protocol,
      storedGrantArtifacts(hby, grant, gvrsn),
    );
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
function* settleGrantCredential(
  hby: Habery,
  protocol: ProtocolProcessor,
  reger: Reger,
  grant: SerderKERI,
  recipient: string,
  genus: Versionage | undefined,
  timeout: number,
): Operation<boolean> {
  const said = validateAdmitGrant(grant, recipient, reger, false);
  if (reger.saved.get([said])) return true;
  const deadline = Date.now() + timeout * 1000;
  yield* processCredentialPresentationArtifacts(protocol, storedGrantArtifacts(hby, grant, genus));
  while (!reger.saved.get([said])) {
    if (Date.now() >= deadline) return false;
    yield* sleep(Math.min(250, deadline - Date.now()));
  }
  return true;
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
