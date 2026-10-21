import { concatBytes, Counter, parse, SerderKERI, type Versionage } from "cesr-ts";
import { action, call, type Operation, spawn } from "npm:effection@^3.6.0";
import { parseGvrsn } from "../../core/attachment-countering.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { Reger } from "../../db/reger.ts";
import { abortable } from "../abortable.ts";
import { type AgentRuntime, runAgentRuntime, settleMailboxPollBatch } from "../agent-runtime.ts";
import { fileBytes } from "../byte-source.ts";
import { createExchangeMessage } from "../exchange-messaging.ts";
import { isLocalGroupHab, localGroupMember } from "../group-members.ts";
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
  approveStoredMultisigIpexWrappers,
  findPendingMultisigIpex,
  groupIpexPartial,
  groupIpexProposals,
  requireStoredExchange,
  sendCredentialStream,
  storedExchangeMessage,
} from "../ipex-grouping.ts";
import {
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
} from "../ipexing.ts";
import { Organizer } from "../organizing.ts";
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
}

/** Grant facts survive command cleanup. Group completion is distinct from completed member delivery. */
export interface IpexGrantResult {
  grant: SerderKERI;
  credential: string;
  support: number;
  group?: { complete: boolean; lead: boolean | null; deliveries: string[] };
}

/** Authored admit and the actual accepted grant it answers. */
export interface IpexAdmitResult {
  admit: SerderKERI;
  grant: SerderKERI;
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
  group?: {
    embedded: SerderKERI;
    accepted: boolean | null;
    lead: boolean | null;
    deliveries: string[];
  };
}

/**
 * Implement `tufa ipex apply` by sending a schema/attribute request EXN.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexApplyCommand(args: Record<string, unknown>): Operation<IpexSendResult> {
  const ipexArgs = ipexBaseArgs(args);
  const schema = parseStringOption(args.schema, "schema");
  requireNonEmpty(schema, "Schema");
  const attrs = parseJsonArg(parseStringOption(args.attrs, "attrs")) ?? {};
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
      requireString(ipexArgs.recipient, "Recipient"),
    );
    const { serder, msg } = createExchangeMessage(hab, {
      dest: recipient,
      route: IPEX_APPLY_ROUTE,
      payload: {
        m: ipexArgs.message ?? "",
        s: schema,
        a: attrs,
        i: recipient,
      },
    });
    const postman = runtime.postman;
    const worker = yield* spawn(() => postman.deliverDo());
    try {
      const evt = postman.send({
        src: hab.pre,
        dest: recipient,
        msg,
        topic: CREDENTIAL_MAILBOX_TOPIC,
      }, { notify: true });
      const result = yield* postman.wait(evt);
      if (result.kin === "failed") throw result.error;
      return { exn: serder, deliveries: result.deliveries };
    } finally {
      yield* worker.halt();
    }
  });
}

/**
 * Implement `tufa ipex offer` with one embedded ACDC stream reference.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* ipexOfferCommand(args: Record<string, unknown>): Operation<IpexSendResult> {
  const ipexArgs = ipexBaseArgs(args);
  const acdcFile = parseStringOption(args.acdc, "acdc");
  requireNonEmpty(acdcFile, "ACDC file");
  const apply = parseStringOption(args.apply, "apply");
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
      requireString(ipexArgs.recipient, "Recipient"),
    );
    const { serder, msg } = createExchangeMessage(hab, {
      dest: recipient,
      route: IPEX_OFFER_ROUTE,
      payload: { m: ipexArgs.message ?? "" },
      dig: apply,
      embeds: { acdc: Deno.readFileSync(acdcFile!) },
    });
    const postman = runtime.postman;
    const worker = yield* spawn(() => postman.deliverDo());
    try {
      const evt = postman.send({
        src: hab.pre,
        dest: recipient,
        msg,
        topic: CREDENTIAL_MAILBOX_TOPIC,
      }, { notify: true });
      const result = yield* postman.wait(evt);
      if (result.kin === "failed") throw result.error;
      return { exn: serder, deliveries: result.deliveries };
    } finally {
      yield* worker.halt();
    }
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
  const prior = requireString(parseStringOption(args.prior, "prior"), "Prior message");
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const dest = new Organizer(hby.db, hby.signator).resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const { serder, msg } = createExchangeMessage(hab, {
      dest,
      route: IPEX_SPURN_ROUTE,
      payload: { m: ipexArgs.message ?? "" },
      dig: prior,
    });
    const worker = yield* spawn(() => runtime.postman.deliverDo());
    try {
      const deliveries = yield* sendCredentialStream(runtime.postman, hab, dest, [msg]);
      return { exn: serder, deliveries };
    } finally {
      yield* worker.halt();
    }
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
      const genus = grant.grant.gvrsn ?? ipexArgs.gvrsn ?? grant.grant.pvrsn;
      const partialGrant = groupIpexPartial(hby, hab, grant.grant, grant.attachments, genus);
      yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(genus), partialGrant), { local: true });
      yield* runtime.protocol.processEscrowsOnce();

      const deliveries = yield* call(function*() {
        const postman = runtime.postman;
        const worker = yield* spawn(() => postman.deliverDo());
        try {
          const deliveries: string[] = [];
          for (const { msg, ...evt } of groupIpexProposals(hby, hab, partialGrant, genus)) {
            const admitted = postman.sendStream({ ...evt, msgs: [msg] }, { notify: true });
            const outcome = yield* postman.wait(admitted);
            if (outcome.kin === "failed") throw outcome.error;
            deliveries.push(...outcome.deliveries);
          }
          return deliveries;
        } finally {
          yield* worker.halt();
        }
      });
      const complete = ipexArgs.approvalTimeoutSeconds > 0
        ? yield* waitForMultisigIpexCompletion(hby, runtime, hab, grant.grant.said!, ipexArgs.approvalTimeoutSeconds)
        : runtime.exc.complete(grant.grant.said!);

      if (!complete) {
        return {
          grant: grant.grant,
          credential: ipexArgs.said!,
          support: grant.support.length,
          group: { complete: false, lead: null, deliveries },
        };
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
      } else if (runtime.exc.lead(hab, completedGrant.said!)) {
        const postman = runtime.postman;
        const worker = yield* spawn(() => postman.deliverDo());
        try {
          yield* sendCredentialStream(postman, localGroupMember(hby, hab.pre), recipient, [
            ...grant.support,
            completedGrantWire,
          ]);
        } finally {
          yield* worker.halt();
        }
      }
      return {
        grant: completedGrant,
        credential: ipexArgs.said!,
        support: grant.support.length,
        group: { complete: true, lead: runtime.exc.lead(hab, completedGrant.said!), deliveries },
      };
    }

    const stream = concatBytes(...grant.support, grant.wire);
    if (ipexArgs.out) {
      Deno.writeFileSync(ipexArgs.out, stream);
    } else {
      const postman = runtime.postman;
      const worker = yield* spawn(() => postman.deliverDo());
      try {
        yield* sendCredentialStream(postman, hab, recipient, [...grant.support, grant.wire]);
      } finally {
        yield* worker.halt();
      }
    }
    return { grant: grant.grant, credential: ipexArgs.said!, support: grant.support.length };
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
  };
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime, reger }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const grant = yield* loadGrant(hby, ipexArgs);
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
      const postman = runtime.postman;
      const worker = yield* spawn(() => postman.deliverDo());
      try {
        yield* sendCredentialStream(postman, hab, recipient, [admit.wire]);
      } finally {
        yield* worker.halt();
      }
    }
    return { admit: admit.admit, grant };
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
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
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
      return { exn, group: { embedded, accepted: null, lead: null, deliveries: [] } };
    }

    const approval = yield* call(function*() {
      const postman = runtime.postman;
      const worker = yield* spawn(() => postman.deliverDo());
      try {
        return yield* approveMultisigIpex(hby, runtime.protocol, postman, runtime.vdr?.reger ?? null, exn, {
          publish: true,
          gvrsn: ipexArgs.gvrsn,
        });
      } finally {
        yield* worker.halt();
      }
    });
    return {
      exn,
      group: {
        embedded,
        accepted: approval.accepted,
        lead: runtime.exc.lead(hby.habs.get(group)!, embedded.said!),
        deliveries: approval.deliveries,
      },
    };
  });
}

/**
 * Send a prior-correlated IPEX response with an explicit Poster worker.
 * Await this admission's outcome and return its EXN and delivered URLs after
 * joining the worker. The outer resource owner closes stores before returning.
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
  const prior = parseStringOption(args[priorLabel], priorLabel);
  requireNonEmpty(prior, priorLabel);
  return yield* withIpexRuntime(ipexArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
      requireString(ipexArgs.recipient, "Recipient"),
    );
    const { serder, msg } = createExchangeMessage(hab, {
      dest: recipient,
      route,
      payload: { m: ipexArgs.message ?? "" },
      dig: prior,
    });
    const postman = runtime.postman;
    const worker = yield* spawn(() => postman.deliverDo());
    try {
      const evt = postman.send({
        src: hab.pre,
        dest: recipient,
        msg,
        topic: CREDENTIAL_MAILBOX_TOPIC,
      }, { notify: true });
      const result = yield* postman.wait(evt);
      if (result.kin === "failed") throw result.error;
      return { exn: serder, deliveries: result.deliveries };
    } finally {
      yield* worker.halt();
    }
  });
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
function* loadGrant(hby: Habery, args: IpexAdmitArgs): Operation<SerderKERI> {
  if (args.grantFile) {
    const path = args.grantFile;
    return yield* abortable(async (signal) => {
      let grant: SerderKERI | undefined;
      const frames = parse(fileBytes(path, { signal }));
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
      if (grant) return grant;
      throw new ValidationError(`Grant file ${path} does not contain an IPEX grant.`);
    });
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

/**
 * Await group approval while the ordinary host owns mailbox, query and escrow progress.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param groupHab Local group waiting for member approval.
 * @param embeddedSaid Exact IPEX child SAID whose completion is observed.
 * @param approvalTimeoutSeconds Shared approval wait duration in seconds.
 */
function* waitForMultisigIpexCompletion(
  hby: Habery,
  runtime: AgentRuntime,
  groupHab: Hab,
  embeddedSaid: string,
  approvalTimeoutSeconds: number,
): Operation<boolean> {
  const member = localGroupMember(hby, groupHab.pre);
  const deadline = Date.now() + approvalTimeoutSeconds * 1000;
  const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member }));
  try {
    while (true) {
      yield* approveStoredMultisigIpexWrappers(hby, runtime.protocol, embeddedSaid);
      if (runtime.exc.complete(embeddedSaid)) return true;
      if (Date.now() >= deadline) return false;
      yield* sleep(Math.min(250, deadline - Date.now()));
    }
  } finally {
    yield* host.halt();
  }
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
