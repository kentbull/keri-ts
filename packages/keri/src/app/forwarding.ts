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
import { concatBytes, Counter, parsePather, SerderKERI } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { makeEmbeddedExchangeMessage, makeExchangeSerder } from "../core/messages.ts";
import { Roles } from "../core/roles.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import type { OutboxerLike } from "../db/outboxing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { buildCesrRequest, splitCesrStream } from "./cesr-http.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandle, fetchResponseHandleOrNull } from "./httping.ts";
import { MailboxDirector } from "./mailbox-director.ts";
import {
  directDeliveryEndpoints,
  firstSortedEndpoint,
  flattenRoleUrls,
  getOutboxer,
  mailboxDeliveryEndpoints,
  mailboxPollEndpoints,
  mailboxTopicKey,
  preferredUrl,
} from "./mailboxing.ts";
import { Organizer } from "./organizing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** Shared encoder for mailbox SSE parsing. */
const textEncoder = new TextEncoder();

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

/**
 * Mailbox-first postman for outbound EXN transport.
 *
 * Responsibilities:
 * - resolve recipient aliases against organizer/contact state
 * - route to all currently authorized recipient mailbox endpoints when present
 * - fall back to direct controller/agent endpoints only when no mailbox exists
 * - persist sender-side mailbox retry state per mailbox endpoint
 */
export class Poster {
  readonly hby: Habery;
  readonly mailboxer: Mailboxer | null;
  readonly outboxer: OutboxerLike;
  readonly organizer: Organizer;

  constructor(
    hby: Habery,
    {
      mailboxer,
      outboxer,
    }: {
      mailboxer?: Mailboxer | null;
      outboxer?: OutboxerLike;
    } = {},
  ) {
    this.hby = hby;
    this.mailboxer = mailboxer ?? null;
    this.outboxer = outboxer ?? getOutboxer(hby);
    this.organizer = new Organizer(hby);
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
      modifiers?: Record<string, unknown>;
      date?: string;
      dig?: string;
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

    const serder = makeExchangeSerder(args.route, args.payload, {
      sender: hab.pre,
      recipient,
      modifiers: args.modifiers,
      stamp: args.date,
      dig: args.dig,
    });
    const message = hab.endorse(serder, { pipelined: false });
    const deliveries: string[] = [];
    const queued: string[] = [];
    const delivery = args.delivery ?? "auto";
    const mailboxEndpoints = delivery === "direct"
      ? []
      : mailboxDeliveryEndpoints(hab, recipient);

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

    if (delivery === "indirect") {
      throw new ValidationError(
        `No authorized mailbox endpoints are configured for ${recipient}.`,
      );
    }

    const directEndpoints = directDeliveryEndpoints(hab, recipient);
    if (directEndpoints.length === 0) {
      throw new ValidationError(
        `No end roles for ${recipient} to send evt=${serder.said ?? "<unknown>"}`,
      );
    }

    for (const endpoint of directEndpoints) {
      yield* postCesrMessage(
        endpoint.url,
        message,
        this.hby.cesrBodyMode,
        endpoint.eid,
      );
      deliveries.push(endpoint.url);
    }

    return { serder, deliveries, queued };
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
    },
  ): Operation<RawCesrSendResult> {
    const recipient = this.resolveRecipient(args.recipient);
    const topic = args.topic ?? "";
    const deliveries: string[] = [];
    const queued: string[] = [];
    const delivery = args.delivery ?? "auto";
    const mailboxEndpoints = delivery === "direct"
      ? []
      : mailboxDeliveryEndpoints(hab, recipient);

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

    if (delivery === "indirect") {
      throw new ValidationError(
        `No authorized mailbox endpoints are configured for ${recipient}.`,
      );
    }

    const directEndpoints = directDeliveryEndpoints(hab, recipient);
    if (directEndpoints.length === 0) {
      throw new ValidationError(
        `No end roles for ${recipient} to send raw CESR payload.`,
      );
    }

    for (const endpoint of directEndpoints) {
      yield* postCesrMessage(
        endpoint.url,
        args.message,
        this.hby.cesrBodyMode,
        endpoint.eid,
      );
      deliveries.push(endpoint.url);
    }

    return { deliveries, queued };
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
    if (this.hby.db.prefixes.has(endpoint.eid)) {
      this.requireMailboxer().storeMsg(
        mailboxTopicKey(recipient, topic),
        message,
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
      concatBytes(hab.replyEndRole(hab.pre), forwarded),
      this.hby.cesrBodyMode,
      endpoint.eid,
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
   * Store one forwarded mailbox payload when the addressed mailbox is
   * authorized for the recipient.
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
    if (!recipient || !topic || !forwarded || !mailboxAid) {
      return;
    }

    const end = this.mailboxDirector.hby.db.ends.get([
      recipient,
      Roles.mailbox,
      mailboxAid,
    ]);
    if (!(end?.allowed || end?.enabled)) {
      return;
    }
    this.mailboxDirector.publish(recipient, topic, forwarded);
  }
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
  private readonly localCursors = new Map<string, Record<string, number>>();

  constructor(
    hby: Habery,
    mailboxDirector: MailboxDirector,
    {
      timeouts,
    }: {
      timeouts?: Partial<MailboxPollingTimeoutPolicy>;
    } = {},
  ) {
    this.hby = hby;
    this.mailboxDirector = mailboxDirector;
    this.timeoutPolicy = normalizeMailboxPollingTimeoutPolicy(timeouts);
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
    const deadline = Date.now() + positiveTimeoutMs(
      budgetMs,
      this.timeoutPolicy.commandLocalBudgetMs,
    );

    for (const pre of this.hby.prefixes) {
      const local = this.readLocalMailbox(pre, topics);
      if (local.length > 0) {
        batches.push({ source: "local", pre, messages: local });
      }
    }

    for (const hab of this.hby.habs.values()) {
      const remoteEndpoints = mailboxPollEndpoints(this.hby, hab);
      for (const endpoint of remoteEndpoints) {
        const remainingBudgetMs = deadline - Date.now();
        if (remainingBudgetMs <= 0) {
          return batches;
        }
        const batch = yield* this.pollRemoteEndpointOnce(
          hab,
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
    hab: Hab,
    endpoint: { eid: string; url: string },
    budgetMs: number,
  ): Operation<MailboxPollBatch | null> {
    const cursor = this.mailboxDirector.remoteQueryCursor(
      hab.pre,
      endpoint.eid,
    );
    const messages = yield* fetchMailboxMessages(
      hab,
      endpoint.eid,
      endpoint.url,
      cursor,
      this.hby.cesrBodyMode,
      mailboxFetchTimeoutPolicy(this.timeoutPolicy, budgetMs),
    );
    if (messages.length === 0) {
      return null;
    }
    for (const message of messages) {
      this.mailboxDirector.updateRemoteCursor(
        hab.pre,
        endpoint.eid,
        message.topic,
        message.idx,
      );
    }
    return {
      source: "remote",
      pre: hab.pre,
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
      for (const hab of this.hby.habs.values()) {
        for (const endpoint of mailboxPollEndpoints(this.hby, hab)) {
          const workerKey = `${hab.pre}:${endpoint.key}`;
          active.add(workerKey);
          if (remoteWorkers.has(workerKey)) {
            continue;
          }

          const task = yield* spawn(() => this.remoteEndpointWorker(hab, endpoint, onBatch));
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
    hab: Hab,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void,
  ): Operation<never> {
    while (true) {
      const batch = yield* this.pollRemoteEndpointOnce(
        hab,
        endpoint,
        this.timeoutPolicy.maxPollDurationMs,
      );
      if (batch) {
        onBatch(batch);
      }
      yield* runtimeTurn();
    }
  }
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
  const { serder, attachments } = makeEmbeddedExchangeMessage(
    "/fwd",
    {},
    {
      sender: hab.pre,
      modifiers: { pre: args.recipient, topic: args.topic },
      embeds: { evt: args.message },
    },
  );
  return concatBytes(hab.endorse(serder, { pipelined: false }), attachments);
}

/** Derive the default mailbox topic from the first non-empty route segment. */
function defaultTopicForRoute(route: string): string {
  const trimmed = route.replace(/^\/+/, "");
  return trimmed.split("/")[0] ?? "";
}

/**
 * Public helper for deriving mailbox topic defaults from one EXN route.
 *
 * This stays exported because CLI and runtime call sites both need one shared
 * answer for "which mailbox topic should this route land in by default?"
 */
export function mailboxTopicForRoute(route: string): string {
  return defaultTopicForRoute(route);
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

  const embedded = new SerderKERI({ sad: evt as Record<string, unknown> });
  const messageParts: Uint8Array[] = [embedded.raw];

  for (const attachment of attachments) {
    const atc = forwardedAttachmentForPath(attachment.raw, "/e/evt");
    if (atc) {
      messageParts.push(atc);
    }
  }

  return concatBytes(...messageParts);
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

interface MailboxMessage {
  idx: number;
  msg: Uint8Array;
  topic: string;
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

interface MailboxFetchTimeoutPolicy {
  requestOpenTimeoutMs: number;
  maxReadDurationMs: number;
  readIdleTimeoutMs: number;
}

/**
 * Query one remote mailbox endpoint and parse any returned mailbox SSE events.
 *
 * The query cursor values are "next wanted" ordinals, matching `mbx`
 * semantics.
 */
function* fetchMailboxMessages(
  hab: Hab,
  src: string,
  url: string,
  topics: Record<string, number>,
  bodyMode: "header" | "body",
  timeouts: MailboxFetchTimeoutPolicy,
): Operation<MailboxMessage[]> {
  const query = hab.query(hab.pre, src, { topics }, "mbx");
  const handle = yield* fetchMailboxQueryResponse(
    url,
    query,
    bodyMode,
    src,
    timeouts.requestOpenTimeoutMs,
  );
  if (!handle) {
    return [];
  }
  const { response, controller } = handle;

  if (!response.ok) {
    yield* closeResponseBody(response);
    return [];
  }

  const text = yield* readSseBody(
    response,
    controller,
    {
      idleTimeoutMs: timeouts.readIdleTimeoutMs,
      maxDurationMs: timeouts.maxReadDurationMs,
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
  }, { timeoutMs });
}

/**
 * Read one mailbox SSE response without waiting for the server to close it.
 *
 * KERIpy mailbox queries keep the stream open for long-poll behavior, so
 * `keri-ts` callers stop on an explicit read budget and idle detection instead
 * of waiting for remote EOF with `response.text()`.
 */
function* readSseBody(
  response: Response,
  controller: AbortController,
  {
    idleTimeoutMs = MailboxPoller.ReadIdleTimeoutMs,
    maxDurationMs = MailboxPoller.DefaultTimeoutPolicy.maxPollDurationMs,
  }: {
    idleTimeoutMs?: number;
    maxDurationMs?: number;
  } = {},
): Operation<string> {
  const body = response.body;
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + maxDurationMs;
  const timedOut = Symbol("timedOut");

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(
        1,
        Math.min(idleTimeoutMs, deadline - Date.now()),
      );
      const next = yield* action<
        ReadableStreamReadResult<Uint8Array> | typeof timedOut
      >((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          settled = true;
          resolve(timedOut);
        }, remaining);

        reader.read().then((result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        }).catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        });

        return () => {
          clearTimeout(timeoutId);
        };
      });

      if (next === timedOut) {
        if (
          parseMailboxSse(text).length > 0
          || Date.now() + idleTimeoutMs >= deadline
        ) {
          controller.abort();
          break;
        }
        continue;
      }

      const { value, done } = next as ReadableStreamReadResult<Uint8Array>;
      if (done) {
        break;
      }
      if (value && value.length > 0) {
        text += decoder.decode(value, { stream: true });
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
  } finally {
    yield* action<void>((resolve) => {
      void reader.cancel().catch(() => {
        // Ignore cleanup failures from already-aborted SSE streams.
      }).finally(() => resolve(undefined));
      return () => {};
    });
  }

  text += decoder.decode();
  return text;
}

/** Parse mailbox SSE text into `(topic, idx, payload)` tuples. */
function parseMailboxSse(text: string): MailboxMessage[] {
  const messages: MailboxMessage[] = [];

  for (const block of text.split("\n\n")) {
    if (block.trim().length === 0) {
      continue;
    }
    let idx = -1;
    let topic = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) {
        idx = Number(line.slice(3).trim());
      } else if (line.startsWith("event:")) {
        topic = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (idx < 0 || topic.length === 0 || dataLines.length === 0) {
      continue;
    }
    messages.push({
      idx,
      topic,
      msg: textEncoder.encode(dataLines.join("\n")),
    });
  }

  return messages;
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
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
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
): Operation<void> {
  const requests = bodyMode === "header" ? splitCesrStream(body) : [body];
  for (const currentBody of requests) {
    const request = buildCesrRequest(currentBody, {
      bodyMode,
      destination,
    });
    const { response } = yield* fetchResponseHandle(url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });

    yield* closeResponseBody(response);
    if (!response.ok) {
      throw new ValidationError(
        `Exchange delivery to ${url} failed with HTTP ${response.status}.`,
      );
    }
  }
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
    delivery?: ExchangeDeliveryPreference;
  },
): Operation<ExchangeSendResult> {
  const poster = new Poster(hby);
  return yield* poster.sendExchange(hab, args);
}
