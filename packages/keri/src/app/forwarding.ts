/**
 * Mailbox-first forwarding and polling support.
 *
 * KERIpy correspondence:
 * - ports the conceptual roles of `Poster`, `StreamPoster`, `ForwardHandler`,
 *   and mailbox polling/query handling from `keri.app.forwarding` and
 *   `keri.app.indirecting`
 *
 * Current `keri-ts` difference:
 * - delivery and polling are synchronous Effection operations instead of HIO
 *   doers
 * - sender retry durability is optional via `Outboxer`
 * - HTTP posting honors both KERIpy header mode and the Tufa-only body mode
 */
import { action, type Operation, spawn, type Task } from "npm:effection@^3.6.0";
import { concatBytes, Counter, parsePather, SerderACDC, SerderKERI } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import type { Kever } from "../core/kever.ts";
import { CREDENTIAL_MAILBOX_TOPIC, DELEGATE_MAILBOX_TOPIC, OOBI_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { Roles } from "../core/roles.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import type { OutboxerLike } from "../db/outboxing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { buildCesrRequest, CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE, splitCesrStream } from "./cesr-http.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandle, fetchResponseHandleOrNull } from "./httping.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { type MailboxSseMessage, parseMailboxSse, readMailboxSseBody } from "./mailbox-sse.ts";
import {
  directDeliveryEndpoints,
  firstSortedEndpoint,
  getOutboxer,
  mailboxDeliveryEndpoints,
  mailboxPollEndpoints,
  mailboxTopicKey,
} from "./mailboxing.ts";
import { Organizer } from "./organizing.ts";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** Delivery preference accepted by CLI and runtime exchange send helpers. */
export type ExchangeDeliveryPreference = "auto" | "direct" | "indirect";

/** Result summary for one EXN send attempt across all resolved destinations. */
export interface ExchangeSendResult {
  serder: SerderKERI;
  deliveries: string[];
  queued: string[];
}

/** Result summary for one raw CESR delivery attempt. */
export interface RawCesrSendResult {
  deliveries: string[];
  queued: string[];
}

interface PosterOptions {
  mailboxer?: Mailboxer | null;
  outboxer?: OutboxerLike;
  services?: RuntimeServices;
}

interface MailboxPollerOptions {
  timeouts?: Partial<MailboxPollingTimeoutPolicy>;
  services?: RuntimeServices;
  pollTransport?: MailboxPollTransport;
}

/**
 * Mailbox-first postman for outbound EXN transport.
 *
 * Responsibilities:
 * - resolve recipient aliases against organizer/contact state
 * - route to all currently authorized recipient mailbox endpoints when present
 * - fall back to direct controller/agent endpoints, then one witness endpoint,
 *   when no mailbox exists
 * - persist sender-side mailbox retry state per mailbox endpoint
 */
export class Poster {
  readonly hby: Habery;
  readonly mailboxer: Mailboxer | null;
  readonly outboxer: OutboxerLike;
  readonly organizer: Organizer;
  readonly services: RuntimeServices;

  constructor(hby: Habery, options: PosterOptions = {}) {
    const { mailboxer, outboxer, services = defaultRuntimeServices } = options;
    this.hby = hby;
    this.mailboxer = mailboxer ?? null;
    this.outboxer = outboxer ?? getOutboxer(hby);
    this.organizer = new Organizer(hby);
    this.services = services;
  }

  /**
   * Resolve one CLI or user recipient input into the actual destination prefix.
   *
   * Resolution order matches the mailbox CLI mental model:
   * - exact known prefix wins
   * - otherwise exact organizer alias lookup is required
   */
  resolveRecipient(recipient: string): string {
    if (this.hby.db.getKever(recipient)) {
      return recipient;
    }

    const matches = this.organizer.findExact("alias", recipient);
    if (matches.length === 0) {
      throw new ValidationError(`no contact found with alias '${recipient}'`);
    }
    if (matches.length > 1) {
      throw new ValidationError(
        `multiple contacts match alias '${recipient}', use prefix instead`,
      );
    }

    return matches[0]!.id;
  }

  /**
   * Send one EXN through the mailbox-first delivery policy.
   *
   * Default policy:
   * - if recipient mailboxes exist, broadcast to all mailbox endpoints
   * - if no mailbox exists, send directly to controller/agent endpoints
   * - if no direct endpoints exist, fall back to one witness endpoint
   * - failed mailbox deliveries are queued durably for retry
   *
   * Current `keri-ts` difference:
   * - KERIpy `Poster` is queue/doer based
   * - here the caller drives one explicit operation and gets a structured
   *   result back immediately
   */
  *sendExchange(
    hab: Hab,
    args: {
      recipient: string;
      route: string;
      payload: Record<string, unknown>;
      topic?: string;
      exchangeRecipient?: string | null;
      modifiers?: Record<string, unknown>;
      date?: string;
      dig?: string;
      embeds?: Record<string, Uint8Array>;
      delivery?: ExchangeDeliveryPreference;
    },
  ): Operation<ExchangeSendResult> {
    const recipient = this.resolveRecipient(args.recipient);
    const topic = args.topic ?? defaultTopicForRoute(args.route);
    if (topic.length === 0) {
      throw new ValidationError(
        `Unable to derive mailbox topic from route ${args.route}.`,
      );
    }

    const embedded = args.embeds ?? {};
    const exchangeRecipient = args.exchangeRecipient === null ? undefined : args.exchangeRecipient ?? recipient;
    const [serder, attachments] = exchange(args.route, args.payload, {
      sender: hab.pre,
      recipient: exchangeRecipient,
      modifiers: args.modifiers,
      stamp: args.date,
      dig: args.dig,
      embeds: Object.keys(embedded).length > 0 ? embedded : undefined,
    });
    const message = concatBytes(
      hab.endorse(serder, { pipelined: false }),
      attachments,
    );
    const deliveries: string[] = [];
    const queued: string[] = [];
    const delivery = args.delivery ?? "auto";
    const mailboxEndpoints = delivery === "direct" ? [] : mailboxDeliveryEndpoints(hab, recipient);

    if (mailboxEndpoints.length > 0) {
      const failed = new Map<string, string>();
      for (const endpoint of mailboxEndpoints) {
        try {
          yield* this.deliverMailboxTarget(
            hab,
            recipient,
            topic,
            message,
            endpoint,
          );
          deliveries.push(endpoint.url);
        } catch (error) {
          failed.set(
            endpoint.eid,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      if (failed.size > 0) {
        if (this.outboxer.enabled) {
          const said = serder.said;
          if (!said) {
            throw new ValidationError("Exchange message is missing a SAID.");
          }
          this.outboxer.queueMessage(
            said,
            message,
            {
              sender: hab.pre,
              recipient,
              topic,
              createdAt: makeNowIso8601(),
            },
            failed.keys(),
          );
          const attemptedAt = makeNowIso8601();
          for (const [eid, error] of failed.entries()) {
            this.outboxer.markFailed(said, eid, attemptedAt, error);
            queued.push(`outbox:${eid}`);
          }
        } else if (deliveries.length === 0) {
          throw new ValidationError(
            `Exchange delivery failed for ${recipient}: ${[...failed.values()].join("; ")}`,
          );
        }
      }

      return { serder, deliveries, queued };
    }

    const directEndpoints = directDeliveryEndpoints(hab, recipient);
    if (directEndpoints.length > 0) {
      for (const endpoint of directEndpoints) {
        yield* postCesrMessage(
          endpoint.url,
          message,
          this.hby.cesrBodyMode,
          endpoint.eid,
          this.services,
        );
        deliveries.push(endpoint.url);
      }
      return { serder, deliveries, queued };
    }

    if (delivery !== "direct") {
      const witnessEndpoint = firstSortedEndpoint(
        hab.endsFor(recipient)[Roles.witness],
      );
      if (witnessEndpoint) {
        yield* this.deliverWitnessTarget(
          hab,
          recipient,
          topic,
          message,
          witnessEndpoint,
        );
        deliveries.push(witnessEndpoint.url);
        return { serder, deliveries, queued };
      }
    }

    throw new ValidationError(
      `No end roles for ${recipient} to send evt=${serder.said ?? "<unknown>"}`,
    );
  }

  /**
   * Send one raw CESR message through the same mailbox-first transport policy.
   *
   * This is used by delegation workflows where correctness depends on the
   * actual KEL bytes reaching the delegator or delegate, not on an EXN wrapper.
   */
  *sendBytes(
    hab: Hab,
    args: {
      recipient: string;
      message: Uint8Array;
      topic?: string;
      delivery?: ExchangeDeliveryPreference;
      split?: boolean;
    },
  ): Operation<RawCesrSendResult> {
    const recipient = this.resolveRecipient(args.recipient);
    const topic = args.topic ?? "";
    const deliveries: string[] = [];
    const queued: string[] = [];
    const delivery = args.delivery ?? "auto";
    const mailboxEndpoints = delivery === "direct" ? [] : mailboxDeliveryEndpoints(hab, recipient);

    if (mailboxEndpoints.length > 0) {
      if (topic.length === 0) {
        throw new ValidationError(
          `Mailbox delivery requires an explicit topic for ${recipient}.`,
        );
      }

      const failed = new Map<string, string>();
      for (const endpoint of mailboxEndpoints) {
        try {
          yield* this.deliverMailboxTarget(
            hab,
            recipient,
            topic,
            args.message,
            endpoint,
          );
          deliveries.push(endpoint.url);
        } catch (error) {
          failed.set(
            endpoint.eid,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      if (failed.size > 0) {
        if (this.outboxer.enabled) {
          const said = crypto.randomUUID();
          this.outboxer.queueMessage(
            said,
            args.message,
            {
              sender: hab.pre,
              recipient,
              topic,
              createdAt: makeNowIso8601(),
            },
            failed.keys(),
          );
          const attemptedAt = makeNowIso8601();
          for (const [eid, error] of failed.entries()) {
            this.outboxer.markFailed(said, eid, attemptedAt, error);
            queued.push(`outbox:${eid}`);
          }
        } else if (deliveries.length === 0) {
          throw new ValidationError(
            `CESR delivery failed for ${recipient}: ${[...failed.values()].join("; ")}`,
          );
        }
      }

      return { deliveries, queued };
    }

    if (
      delivery !== "direct"
      && topic.length > 0
      && this.mailboxer
      && this.hby.db.prefixes.has(hab.pre)
      && this.hby.db.ends.get([recipient, Roles.mailbox, hab.pre])?.allowed
    ) {
      this.mailboxer.storeMsg(
        mailboxTopicKey(recipient, topic),
        mailboxReplyPayload(hab, recipient, topic, args.message),
      );
      deliveries.push(`local-mailbox:${hab.pre}`);
      return { deliveries, queued };
    }

    const directEndpoints = directDeliveryEndpoints(hab, recipient);
    if (directEndpoints.length > 0) {
      for (const endpoint of directEndpoints) {
        yield* postCesrMessage(
          endpoint.url,
          args.message,
          this.hby.cesrBodyMode,
          endpoint.eid,
          this.services,
          { split: args.split },
        );
        deliveries.push(endpoint.url);
      }
      return { deliveries, queued };
    }

    if (delivery !== "direct") {
      if (topic.length === 0) {
        throw new ValidationError(
          `Witness fallback delivery requires an explicit topic for ${recipient}.`,
        );
      }
      const witnessEndpoint = firstSortedEndpoint(
        hab.endsFor(recipient)[Roles.witness],
      );
      if (witnessEndpoint) {
        yield* this.deliverWitnessTarget(
          hab,
          recipient,
          topic,
          args.message,
          witnessEndpoint,
        );
        deliveries.push(witnessEndpoint.url);
        return { deliveries, queued };
      }
    }

    throw new ValidationError(
      `No end roles for ${recipient} to send raw CESR payload.`,
    );
  }

  /**
   * Retry any pending mailbox-target deliveries using current recipient state.
   *
   * Retry behavior is per mailbox endpoint, not per logical message. A removed
   * mailbox cancels only that endpoint's target row.
   */
  *processPending(): Operation<void> {
    for (const pending of this.outboxer.iterPending()) {
      const hab = this.hby.habs.get(pending.message.sender);
      if (!hab) {
        this.outboxer.cancelTarget(
          pending.said,
          pending.target.eid,
          makeNowIso8601(),
          "sender habitat is unavailable",
        );
        continue;
      }

      const endpoint = mailboxDeliveryEndpoints(hab, pending.message.recipient)
        .find((current) => current.eid === pending.target.eid);
      if (!endpoint) {
        this.outboxer.cancelTarget(
          pending.said,
          pending.target.eid,
          makeNowIso8601(),
          "mailbox removed",
        );
        continue;
      }

      try {
        yield* this.deliverMailboxTarget(
          hab,
          pending.message.recipient,
          pending.message.topic,
          pending.raw,
          endpoint,
        );
        this.outboxer.markDelivered(
          pending.said,
          pending.target.eid,
          makeNowIso8601(),
        );
      } catch (error) {
        this.outboxer.markFailed(
          pending.said,
          pending.target.eid,
          makeNowIso8601(),
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /** Return whether any sender retry work still remains. */
  hasPendingWork(): boolean {
    return this.outboxer.pendingCount() > 0;
  }

  /** Cancel all pending retry targets for one mailbox AID. */
  cancelMailbox(eid: string): void {
    this.outboxer.cancelMailbox(eid, makeNowIso8601());
  }

  /**
   * Deliver one message to one mailbox endpoint.
   *
   * Delivery modes:
   * - if the mailbox AID is local to this habery, store directly in
   *   `Mailboxer`
   * - otherwise wrap in `/fwd` and post to the remote mailbox URL
   */
  private *deliverMailboxTarget(
    hab: Hab,
    recipient: string,
    topic: string,
    message: Uint8Array,
    endpoint: { eid: string; url: string },
  ): Operation<void> {
    yield* this.deliverForwardedTarget(
      hab,
      recipient,
      topic,
      message,
      endpoint,
    );
  }

  /**
   * Deliver one message using the recipient's witness as a store-and-forward
   * fallback when no mailbox or direct endpoint exists.
   */
  private *deliverWitnessTarget(
    hab: Hab,
    recipient: string,
    topic: string,
    message: Uint8Array,
    endpoint: { eid: string; url: string },
  ): Operation<void> {
    yield* this.deliverForwardedTarget(
      hab,
      recipient,
      topic,
      message,
      endpoint,
    );
  }

  /**
   * Deliver one `/fwd`-wrapped payload to a mailbox or witness endpoint.
   *
   * Local hosted targets store directly in `Mailboxer`; remote targets receive
   * KERIpy-style introduction material ahead of the forwarded payload.
   */
  private *deliverForwardedTarget(
    hab: Hab,
    recipient: string,
    topic: string,
    message: Uint8Array,
    endpoint: { eid: string; url: string },
  ): Operation<void> {
    if (this.hby.db.prefixes.has(endpoint.eid)) {
      this.requireMailboxer().storeMsg(
        mailboxTopicKey(recipient, topic),
        mailboxReplyPayload(hab, recipient, topic, message),
      );
      return;
    }

    const forwarded = buildForwardedDelivery(hab, {
      recipient,
      topic,
      message,
    });
    yield* postCesrMessage(
      endpoint.url,
      concatBytes(introduce(hab, endpoint.eid), forwarded),
      this.hby.cesrBodyMode,
      endpoint.eid,
      this.services,
    );
  }

  /** Require provider mailbox storage for local mailbox-target delivery. */
  private requireMailboxer(): Mailboxer {
    if (!this.mailboxer) {
      throw new ValidationError(
        "Local mailbox delivery requires provider mailbox storage.",
      );
    }
    return this.mailboxer;
  }
}

/**
 * Accepted `/fwd` route handler that stores embedded payloads in mailbox topics.
 *
 * This is the `keri-ts` mailbox-storage analogue to KERIpy's `ForwardHandler`.
 *
 * Authorization rule:
 * - the request-scoped mailbox AID set by `MailboxDirector` must currently be
 *   authorized for the addressed recipient
 */
export class ForwardHandler implements ExchangeRouteHandler {
  static readonly resource = "/fwd";
  readonly resource = ForwardHandler.resource;
  readonly mailboxDirector: MailboxDirector;

  constructor(mailboxDirector: MailboxDirector) {
    this.mailboxDirector = mailboxDirector;
  }

  /**
   * Verify that the embedded exchange has the mailbox modifiers and one
   * extractable forwarded payload.
   */
  verify(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
  }): boolean {
    const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
    return typeof modifiers?.pre === "string"
      && typeof modifiers?.topic === "string"
      && extractForwardedMessage(args.serder, args.attachments) !== null;
  }

  /**
   * Store one forwarded payload when the receiving host is allowed to act as
   * the recipient's async correspondence store.
   *
   * Accepted host shapes:
   * - explicit mailbox provider authorized in `ends.`
   * - recipient witness host from the accepted KEL witness set
   * - recipient agent host authorized in `ends.`
   *
   * Controller endpoints stay excluded here because they are direct
   * correspondence destinations, not store-and-forward hosts.
   */
  handle(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
  }): void {
    const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
    const recipient = typeof modifiers?.pre === "string" ? modifiers.pre : null;
    const topic = typeof modifiers?.topic === "string" ? modifiers.topic : null;
    const forwarded = extractForwardedMessage(args.serder, args.attachments);
    const mailboxAid = this.mailboxDirector.currentMailboxAid();
    if (!recipient || !topic || !forwarded) {
      return;
    }

    const hby = this.mailboxDirector.hby;
    const recipientKever = hby.db.getKever(recipient);
    if (!recipientKever) {
      return;
    }

    if (mailboxAid) {
      if (
        !hostCanStoreForwardRecipient(
          hby,
          recipient,
          recipientKever,
          mailboxAid,
        )
      ) {
        return;
      }
    } else if (!hasLocalStoreForwardHost(hby, recipient, recipientKever)) {
      return;
    }
    this.mailboxDirector.publish(recipient, topic, forwarded);
  }
}

function hostCanStoreForwardRecipient(
  hby: Habery,
  recipient: string,
  recipientKever: Kever,
  hostAid: string,
): boolean {
  // A local host may store forwarded traffic only when it is an authorized
  // witness/mailbox/agent for the recipient. This keeps mailbox storage from
  // becoming a generic unauthenticated relay.
  if (recipientKever.wits.includes(hostAid)) {
    return true;
  }

  for (const role of [Roles.mailbox, Roles.agent]) {
    const end = hby.db.ends.get([recipient, role, hostAid]);
    if (end?.allowed || end?.enabled) {
      return true;
    }
  }

  return false;
}

function hasLocalStoreForwardHost(
  hby: Habery,
  recipient: string,
  recipientKever: Kever,
): boolean {
  // Check all local prefixes because a multi-role runtime can host a mailbox
  // AID that is distinct from the controller currently processing the EXN.
  for (const hostAid of hby.db.prefixes) {
    if (hostCanStoreForwardRecipient(hby, recipient, recipientKever, hostAid)) {
      return true;
    }
  }
  return false;
}

/**
 * Local/remote mailbox consumer for forwarded EXN topics.
 *
 * Current scope:
 * - replays locally stored mailbox topics for the active habitat prefix
 * - polls configured remote mailbox or witness endpoints with `mbx` queries
 * - ingests retrieved payloads back through the shared `Reactor`
 */
export class MailboxPoller {
  static readonly DefaultTimeoutPolicy: Readonly<MailboxPollingTimeoutPolicy> = Object.freeze({
    requestOpenTimeoutMs: 5_000,
    maxPollDurationMs: 30_000,
    commandLocalBudgetMs: 5_000,
  });
  static readonly ReadIdleTimeoutMs = 500;

  readonly hby: Habery;
  readonly mailboxDirector: MailboxDirector;
  readonly timeoutPolicy: Readonly<MailboxPollingTimeoutPolicy>;
  readonly services: RuntimeServices;
  readonly pollTransport: MailboxPollTransport;
  private readonly localCursors = new Map<string, Record<string, number>>();

  constructor(
    hby: Habery,
    mailboxDirector: MailboxDirector,
    options: MailboxPollerOptions = {},
  ) {
    const {
      timeouts,
      services = defaultRuntimeServices,
      pollTransport = defaultMailboxPollTransport,
    } = options;
    this.hby = hby;
    this.mailboxDirector = mailboxDirector;
    this.timeoutPolicy = normalizeMailboxPollingTimeoutPolicy(timeouts);
    this.services = services;
    this.pollTransport = pollTransport;
  }

  /** Configure mailbox polling state for future expansion; currently a no-op. */
  configure(_args: { hab?: Hab } = {}): void {
    return;
  }

  /** Register one mailbox topic that this poller should retrieve. */
  registerTopic(topic: string): void {
    this.mailboxDirector.registerTopic(topic);
  }

  /**
   * Drain one polling turn:
   * - replay locally hosted mailbox traffic first
   * - then query remote mailbox or witness endpoints using `mbx`
   *
   * The returned batches preserve per-source boundaries so callers can ingest
   * one local or remote result set and run follow-on escrow/cue work before
   * moving to the next source.
   */
  *processOnce(
    {
      budgetMs,
    }: {
      budgetMs?: number;
    } = {},
  ): Operation<MailboxPollBatch[]> {
    const topics = this.mailboxDirector.registeredTopics();
    if (topics.length === 0) {
      return [];
    }
    const batches: MailboxPollBatch[] = [];
    const deadline = this.services.clock.now() + positiveTimeoutMs(
      budgetMs,
      this.timeoutPolicy.commandLocalBudgetMs,
    );

    for (const pre of this.hby.prefixes) {
      const local = this.readLocalMailbox(pre, topics);
      if (local.length > 0) {
        batches.push({ source: "local", pre, messages: local });
      }
    }

    for (const target of this.remotePollTargets()) {
      const remoteEndpoints = mailboxPollEndpoints(this.hby, target.hab);
      for (const endpoint of remoteEndpoints) {
        const remainingBudgetMs = deadline - this.services.clock.now();
        if (remainingBudgetMs <= 0) {
          return batches;
        }
        const batch = yield* this.pollRemoteEndpointOnce(
          target,
          endpoint,
          remainingBudgetMs,
        );
        if (batch) {
          batches.push(batch);
        }
      }
    }

    return batches;
  }

  /**
   * Poll forever, streaming typed batches into one sink.
   *
   * Long-lived runtime polling stays callback-based because concurrent remote
   * workers do not have a natural finite return value.
   */
  *pollDo(
    onBatch: (batch: MailboxPollBatch) => void,
  ): Operation<never> {
    const remoteWorkers = new Map<string, Task<void>>();

    try {
      while (true) {
        const topics = this.mailboxDirector.registeredTopics();
        yield* this.syncRemoteWorkers(remoteWorkers, onBatch, topics);

        if (topics.length > 0) {
          for (const pre of this.hby.prefixes) {
            const local = this.readLocalMailbox(pre, topics);
            if (local.length > 0) {
              onBatch({ source: "local", pre, messages: local });
            }
          }
        }

        yield* runtimeTurn();
      }
    } finally {
      for (const task of [...remoteWorkers.values()].reverse()) {
        yield* task.halt();
      }
    }
  }

  /**
   * Read locally stored mailbox traffic from the shared `Mailboxer`.
   *
   * Local cursors are in-memory only because they are scoped to the current
   * runtime process, unlike remote mailbox progress tracked in `tops.`.
   */
  private readLocalMailbox(
    pre: string,
    topics: readonly string[],
  ): Uint8Array[] {
    if (!this.mailboxDirector.hasMailboxStore()) {
      return [];
    }
    const cursor = this.localCursor(pre);
    const messages: Uint8Array[] = [];

    for (const topic of topics) {
      for (
        const item of this.mailboxDirector.topicIter(
          pre,
          topic,
          cursor[topic] ?? 0,
        )
      ) {
        cursor[topic] = item.idx + 1;
        messages.push(item.msg);
      }
    }

    return messages;
  }

  /** Return the in-memory local mailbox cursor map for one local prefix. */
  private localCursor(pre: string): Record<string, number> {
    const current = this.localCursors.get(pre);
    if (current) {
      return current;
    }
    const created: Record<string, number> = {};
    this.localCursors.set(pre, created);
    return created;
  }

  /**
   * Poll one remote mailbox or witness endpoint once and return one batch.
   *
   * Timeout ownership:
   * - bounded callers pass their remaining command-local budget
   * - long-lived workers pass the normal mailbox long-poll duration
   */
  private *pollRemoteEndpointOnce(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    budgetMs: number,
  ): Operation<MailboxPollBatch | null> {
    const cursor = this.mailboxDirector.remoteQueryCursor(
      target.targetPre,
      endpoint.eid,
    );
    const messages = yield* this.pollTransport.poll({
      hab: target.signerHab,
      targetPre: target.targetPre,
      endpoint,
      topics: cursor,
      bodyMode: this.hby.cesrBodyMode,
      timeouts: mailboxFetchTimeoutPolicy(this.timeoutPolicy, budgetMs),
      services: this.services,
    });
    if (messages.length === 0) {
      return null;
    }
    for (const message of messages) {
      this.mailboxDirector.updateRemoteCursor(
        target.targetPre,
        endpoint.eid,
        message.topic,
        message.idx,
      );
    }
    return {
      source: "remote",
      pre: target.targetPre,
      eid: endpoint.eid,
      messages: messages.map((message) => message.msg),
    };
  }

  /** Keep one long-lived worker running for each currently configured remote endpoint. */
  private *syncRemoteWorkers(
    remoteWorkers: Map<string, Task<void>>,
    onBatch: (batch: MailboxPollBatch) => void,
    topics: readonly string[],
  ): Operation<void> {
    const active = new Set<string>();
    if (topics.length > 0) {
      for (const target of this.remotePollTargets()) {
        for (const endpoint of mailboxPollEndpoints(this.hby, target.hab)) {
          const workerKey = `${target.targetPre}:${endpoint.key}`;
          active.add(workerKey);
          if (remoteWorkers.has(workerKey)) {
            continue;
          }

          const task = yield* spawn(() => this.remoteEndpointWorker(target, endpoint, onBatch));
          remoteWorkers.set(workerKey, task);
        }
      }
    }

    for (const [workerKey, task] of [...remoteWorkers.entries()]) {
      if (active.has(workerKey)) {
        continue;
      }
      yield* task.halt();
      remoteWorkers.delete(workerKey);
    }
  }

  /**
   * Poll one remote endpoint continuously in the long-lived runtime shape.
   *
   * This keeps KERIpy's "one poller per endpoint" behavior while preserving
   * `keri-ts`'s split between mailbox transport and runtime parser ownership.
   */
  private *remoteEndpointWorker(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void,
  ): Operation<never> {
    while (true) {
      const batch = yield* this.pollRemoteEndpointOnce(
        target,
        endpoint,
        this.timeoutPolicy.maxPollDurationMs,
      );
      if (batch) {
        onBatch(batch);
      }
      yield* runtimeTurn();
    }
  }

  private remotePollTargets(): MailboxPollTarget[] {
    const targets: MailboxPollTarget[] = [];
    for (const hab of this.hby.habs.values()) {
      const signerHab = this.pollSignerHab(hab);
      if (!signerHab) {
        continue;
      }
      targets.push({ hab, targetPre: hab.pre, signerHab });
    }
    return targets;
  }

  private pollSignerHab(hab: Hab): Hab | null {
    if (!this.hby.db.groups.has(hab.pre)) {
      return hab;
    }
    const mid = this.hby.db.getHab(hab.pre)?.mid;
    if (!mid) {
      return null;
    }
    return this.hby.habs.get(mid) ?? null;
  }
}

interface MailboxPollTarget {
  hab: Hab;
  targetPre: string;
  signerHab: Hab;
}

/**
 * Build one signed `/fwd` exchange containing the embedded mailbox payload.
 *
 * The caller is responsible for any surrounding introduction or end-role
 * material that should travel with the forwarded request.
 */
function buildForwardedDelivery(
  hab: Hab,
  args: {
    recipient: string;
    topic: string;
    message: Uint8Array;
  },
): Uint8Array {
  const [serder, attachments] = exchange(
    "/fwd",
    {},
    {
      sender: hab.pre,
      modifiers: { pre: args.recipient, topic: transportMailboxTopic(args.topic) },
      embeds: { evt: args.message },
    },
  );
  return concatBytes(hab.endorse(serder, { pipelined: false }), attachments);
}

/**
 * Include the sender's latest KEL before locally stored `/reply` payloads.
 *
 * KERIpy's `Revery` escrows transferable replies whose signer establishment
 * event is unknown. Python KLI does not route that escrow's follow-up query cue
 * during the bounded `kli query` command, so a local mailbox host must provide
 * the verification context with the reply itself for rotated `/ksn` replies.
 */
function mailboxReplyPayload(
  hab: Hab,
  recipient: string,
  topic: string,
  message: Uint8Array,
): Uint8Array {
  if (topic !== "/reply" && topic !== "reply") {
    return message;
  }
  const introduction = introduce(hab, recipient);
  return introduction.length === 0 ? message : concatBytes(introduction, message);
}

/**
 * Return the KERIpy-style introduction stream for one remote endpoint.
 *
 * This bootstrap material is intentionally broader than a bare endpoint reply:
 * - sender KEL replay
 * - delegation chain when present
 * - endpoint/location replies for later correspondence
 *
 * It is only sent when local DB state does not already show a receipt from the
 * remote endpoint for the sender's latest event.
 */
export function introduce(
  hab: Hab,
  remote: string,
): Uint8Array {
  const kever = hab.kever;
  if (!kever) {
    return new Uint8Array();
  }
  if (kever.wits.includes(remote)) {
    return new Uint8Array();
  }

  const latestSaid = kever.serder.said;
  if (
    !latestSaid || remoteAlreadyReceiptedLatestEvent(hab, remote, latestSaid)
  ) {
    return new Uint8Array();
  }

  const messages: Uint8Array[] = [];
  for (const msg of hab.db.clonePreIter(hab.pre)) {
    messages.push(msg);
  }
  for (const msg of hab.db.cloneDelegation(kever)) {
    messages.push(msg);
  }
  const endpoints = hab.replyEndRole(hab.pre);
  if (endpoints.length > 0) {
    messages.push(endpoints);
  }
  return concatBytes(...messages);
}

function remoteAlreadyReceiptedLatestEvent(
  hab: Hab,
  remote: string,
  said: string,
): boolean {
  const keys = [
    dgKey(hab.pre, said),
    dgKey(remote, said),
  ];
  for (const key of keys) {
    if (hab.db.vrcs.get(key).some(([prefixer]) => prefixer.qb64 === remote)) {
      return true;
    }
    if (
      hab.db.rcts.get(key).some(([prefixer]) => prefixer.qb64.startsWith(remote))
    ) {
      return true;
    }
  }
  return false;
}

/** Derive the default mailbox topic from the first non-empty route segment. */
function defaultTopicForRoute(route: string): string {
  if (route.startsWith("/delegate")) {
    return DELEGATE_MAILBOX_TOPIC;
  }
  if (route === "/oobis") {
    return OOBI_MAILBOX_TOPIC;
  }
  if (route.startsWith("/ipex/")) {
    return CREDENTIAL_MAILBOX_TOPIC;
  }
  const trimmed = route.replace(/^\/+/, "");
  return trimmed.split("/")[0] ?? "";
}

/** KERIpy pollers query protocol mailbox topics with a leading slash. */
function pollMailboxTopic(topic: string): string {
  if (topic.length === 0 || topic.startsWith("/")) {
    return topic;
  }
  return `/${topic}`;
}

/** KERIpy `/fwd` modifiers use the bare topic name, e.g. `multisig`. */
function transportMailboxTopic(topic: string): string {
  return topic.replace(/^\/+/, "");
}

/**
 * Public helper for deriving mailbox topic defaults from one EXN route.
 *
 * This stays exported because CLI and runtime call sites both need one shared
 * answer for "which mailbox topic should this route land in by default?"
 */
export function mailboxTopicForRoute(route: string): string {
  return pollMailboxTopic(defaultTopicForRoute(route));
}

function extractForwardedMessage(
  serder: SerderKERI,
  attachments: readonly ExchangeAttachment[],
): Uint8Array | null {
  const embeds = serder.ked?.e as Record<string, unknown> | undefined;
  const evt = embeds?.evt;
  if (!evt || typeof evt !== "object" || Array.isArray(evt)) {
    return null;
  }

  // Rebuild the embedded event from SAD plus only the attachment material
  // pathed to `/e/evt`; other pathed groups belong to the outer `/fwd` message.
  const embedded = embeddedSerderRaw(evt as Record<string, unknown>);
  const messageParts: Uint8Array[] = [embedded];

  for (const attachment of attachments) {
    const atc = forwardedAttachmentForPath(attachment.raw, "/e/evt");
    if (atc) {
      messageParts.push(atc);
    }
  }

  return concatBytes(...messageParts);
}

function embeddedSerderRaw(sad: Record<string, unknown>): Uint8Array {
  const version = typeof sad.v === "string" ? sad.v : "";
  if (version.startsWith("ACDC")) {
    return new SerderACDC({ sad, verify: false }).raw;
  }
  return new SerderKERI({ sad }).raw;
}

/**
 * Extract the forwarded attachment bytes for the embedded `/e/evt` path.
 *
 * Forwarded attachment groups can carry multiple pathed attachments, so the
 * path filter keeps mailbox reconstruction focused on the embedded event.
 */
function forwardedAttachmentForPath(
  raw: Uint8Array,
  path: string,
): Uint8Array | null {
  if (raw.length === 0) {
    return null;
  }

  const counter = new Counter({ qb64b: raw });
  const offset = counter.fullSize;
  const pather = parsePather(raw.slice(offset), "txt");
  if (pather.path !== path) {
    return null;
  }
  return raw.slice(offset + pather.fullSize);
}

/** Explicit mailbox polling timeout policy for one runtime poller. */
export interface MailboxPollingTimeoutPolicy {
  /** Abort the HTTP request when no response headers arrive before this deadline. */
  requestOpenTimeoutMs: number;
  /** Stop reading one mailbox SSE response after this long-poll window. */
  maxPollDurationMs: number;
  /** Bound one command-local polling turn across sequential remote endpoints. */
  commandLocalBudgetMs: number;
}

/** One mailbox retrieval batch whose message boundaries should stay together. */
export interface MailboxPollBatch {
  source: "local" | "remote";
  pre: string;
  eid?: string;
  messages: Uint8Array[];
}

export interface MailboxFetchTimeoutPolicy {
  requestOpenTimeoutMs: number;
  maxReadDurationMs: number;
  readIdleTimeoutMs: number;
}

export interface MailboxPollTransportRequest {
  hab: Hab;
  targetPre: string;
  endpoint: { eid: string; url: string };
  topics: Record<string, number>;
  bodyMode: "header" | "body";
  timeouts: MailboxFetchTimeoutPolicy;
  services: RuntimeServices;
}

export interface MailboxPollTransport {
  poll(args: MailboxPollTransportRequest): Operation<MailboxSseMessage[]>;
}

const defaultMailboxPollTransport: MailboxPollTransport = {
  *poll(args): Operation<MailboxSseMessage[]> {
    return yield* fetchMailboxMessages(
      args.hab,
      args.targetPre,
      args.endpoint.eid,
      args.endpoint.url,
      args.topics,
      args.bodyMode,
      args.timeouts,
      args.services,
    );
  },
};

/**
 * Query one remote mailbox endpoint and parse any returned mailbox SSE events.
 *
 * The query cursor values are "next wanted" ordinals, matching `mbx`
 * semantics.
 */
function* fetchMailboxMessages(
  hab: Hab,
  targetPre: string,
  src: string,
  url: string,
  topics: Record<string, number>,
  bodyMode: "header" | "body",
  timeouts: MailboxFetchTimeoutPolicy,
  services: RuntimeServices = defaultRuntimeServices,
): Operation<MailboxSseMessage[]> {
  const query = hab.query(targetPre, src, { topics }, "mbx");
  const handle = yield* fetchMailboxQueryResponse(
    url,
    query,
    bodyMode,
    src,
    timeouts.requestOpenTimeoutMs,
    services,
  );
  if (!handle) {
    return [];
  }
  const { response, controller } = handle;

  if (!response.ok) {
    yield* closeResponseBody(response);
    return [];
  }

  const text = yield* readMailboxSseBody(
    response,
    controller,
    {
      idleTimeoutMs: timeouts.readIdleTimeoutMs,
      maxDurationMs: timeouts.maxReadDurationMs,
      services,
    },
  );
  return parseMailboxSse(text);
}

/**
 * Issue one mailbox `mbx` poll request and return the live response handle.
 *
 * The helper owns only the request lifecycle:
 * - build one CESR-over-HTTP mailbox query request
 * - apply the pre-response timeout policy
 * - return `null` when that timeout expires before any response arrives
 *
 * Message parsing and SSE body policy remain with `fetchMailboxMessages(...)`.
 */
function* fetchMailboxQueryResponse(
  url: string,
  query: Uint8Array,
  bodyMode: "header" | "body",
  destination: string,
  timeoutMs: number,
  services: RuntimeServices = defaultRuntimeServices,
): Operation<
  {
    response: Response;
    controller: AbortController;
  } | null
> {
  const request = buildCesrRequest(query, {
    bodyMode,
    destination,
  });
  return yield* fetchResponseHandleOrNull(url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  }, { timeoutMs, services });
}

function normalizeMailboxPollingTimeoutPolicy(
  overrides: Partial<MailboxPollingTimeoutPolicy> | undefined,
): Readonly<MailboxPollingTimeoutPolicy> {
  const defaults = MailboxPoller.DefaultTimeoutPolicy;
  return Object.freeze({
    requestOpenTimeoutMs: positiveTimeoutMs(
      overrides?.requestOpenTimeoutMs,
      defaults.requestOpenTimeoutMs,
    ),
    maxPollDurationMs: positiveTimeoutMs(
      overrides?.maxPollDurationMs,
      defaults.maxPollDurationMs,
    ),
    commandLocalBudgetMs: positiveTimeoutMs(
      overrides?.commandLocalBudgetMs,
      defaults.commandLocalBudgetMs,
    ),
  });
}

function mailboxFetchTimeoutPolicy(
  timeouts: Readonly<MailboxPollingTimeoutPolicy>,
  budgetMs: number,
): MailboxFetchTimeoutPolicy {
  const boundedBudgetMs = Math.max(1, budgetMs);
  return {
    requestOpenTimeoutMs: Math.min(
      timeouts.requestOpenTimeoutMs,
      boundedBudgetMs,
    ),
    maxReadDurationMs: Math.min(
      timeouts.maxPollDurationMs,
      boundedBudgetMs,
    ),
    readIdleTimeoutMs: MailboxPoller.ReadIdleTimeoutMs,
  };
}

function positiveTimeoutMs(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Post mailbox or exchange CESR traffic to one endpoint.
 *
 * Header-mode policy:
 * - split a combined CESR stream into one request per message
 * - send the message body in the HTTP body
 * - send that message's attachments in `CESR-ATTACHMENT`
 *
 * Body-mode policy:
 * - send the whole provided payload in the request body
 */
export function* postCesrMessage(
  url: string,
  body: Uint8Array,
  bodyMode: "header" | "body",
  destination?: string,
  services: RuntimeServices = defaultRuntimeServices,
  options: { split?: boolean } = {},
): Operation<void> {
  const requests = bodyMode === "header" && (options.split ?? true) ? splitCesrStream(body) : [body];
  for (const [index, currentBody] of requests.entries()) {
    const contentTypes = bodyMode === "header"
      ? [CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE]
      : [CESR_CONTENT_TYPE];
    let delivered = false;
    let lastStatus = 0;
    let lastText = "";
    for (const contentType of contentTypes) {
      const request = buildCesrRequest(currentBody, {
        bodyMode,
        contentType,
        destination,
      });
      const { response } = yield* fetchResponseHandle(url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      }, {
        services,
      });

      if (response.ok) {
        yield* closeResponseBody(response);
        delivered = true;
        break;
      }
      const responseText = yield* readResponseText(response);
      lastStatus = response.status;
      lastText = responseText;
      if (
        response.status === 406
        && contentType === CESR_CONTENT_TYPE
        && responseText.toLowerCase().includes("content type")
      ) {
        continue;
      }
      throw new ValidationError(
        `Exchange delivery to ${url} failed with HTTP ${response.status} on message ${index + 1}/${requests.length} (${
          describeCesrMessage(currentBody)
        }): ${responseText}`,
      );
    }
    if (!delivered) {
      throw new ValidationError(
        `Exchange delivery to ${url} failed with HTTP ${lastStatus} on message ${index + 1}/${requests.length} (${
          describeCesrMessage(currentBody)
        }): ${lastText}`,
      );
    }
  }
}

function describeCesrMessage(bytes: Uint8Array): string {
  try {
    const serder = new SerderKERI({ raw: bytes });
    return [
      serder.ilk ?? "unknown",
      serder.route ? `route=${serder.route}` : null,
      serder.said ? `said=${serder.said}` : null,
    ].filter((part): part is string => !!part).join(" ");
  } catch {
    return `unparsed length=${bytes.length}`;
  }
}

function* readResponseText(response: Response): Operation<string> {
  return yield* action<string>((resolve, reject) => {
    response.text().then(resolve, reject);
    return () => {};
  });
}

/** Shared EXN send helper used by CLI commands that want KERIpy-style behavior. */
export function* sendExchangeMessage(
  hby: Habery,
  hab: Hab,
  args: {
    recipient: string;
    route: string;
    payload: Record<string, unknown>;
    topic?: string;
    modifiers?: Record<string, unknown>;
    date?: string;
    dig?: string;
    embeds?: Record<string, Uint8Array>;
    delivery?: ExchangeDeliveryPreference;
  },
): Operation<ExchangeSendResult> {
  const poster = new Poster(hby);
  return yield* poster.sendExchange(hab, args);
}
