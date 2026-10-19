/**
 * Mailbox-first forwarding and polling support.
 *
 * KERIpy correspondence:
 * - ports the conceptual roles of `Poster`, `StreamPoster`, `ForwardHandler`,
 *   and mailbox polling/query handling from `keri.app.forwarding` and
 *   `keri.app.indirecting`
 *
 * Current `keri-ts` difference:
 * - delivery and polling use scoped Effection workers instead of HIO doers
 * - HTTP posting honors both KERIpy header mode and the Tufa-only body mode
 */
import {
  attachmentPayload,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  MtrDex,
  nestedPayload,
  parseBytes,
  parsePather,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, resource, spawn, type Task } from "npm:effection@^3.6.0";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { Kever } from "../core/kever.ts";
import { CREDENTIAL_MAILBOX_TOPIC, DELEGATE_MAILBOX_TOPIC, OOBI_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { Roles } from "../core/roles.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import { abortable } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { attemptPostCesr, postCesr } from "./cesr-egress.ts";
import { buildCesrRequest, type CesrBodyMode } from "./cesr-http.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandleOrNull } from "./httping.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { consumeMailboxSse, type MailboxSseMessage } from "./mailbox-sse.ts";
import {
  directDeliveryEndpoints,
  firstSortedEndpoint,
  mailboxDeliveryEndpoints,
  mailboxPollEndpoints,
  mailboxTopicKey,
} from "./mailboxing.ts";
import { Organizer } from "./organizing.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { TCPMessenger } from "./tcp-messenger.ts";
import { TransportError } from "./transport-error.ts";

/** Delivery preference accepted by CLI and runtime exchange send helpers. */
export type ExchangeDeliveryPreference = "auto" | "direct" | "indirect";

/** One admitted source message; identity distinguishes repeated sends of the same signed bytes. */
export interface PosterEvent {
  readonly src: string;
  readonly dest: string;
  readonly topic: string;
  readonly msg: Uint8Array;
  readonly delivery?: ExchangeDeliveryPreference;
  readonly replies?: boolean;
}

/** Optional terminal observation of one concrete delivery attempt, not remote acceptance. */
export type PosterOutcome =
  | { kin: "sent"; evt: PosterEvent; deliveries: string[] }
  | { kin: "failed"; evt: PosterEvent; deliveries: string[]; error: unknown };

/** Recipient policy captured during a short guarded preparation turn. */
export interface RawCesrRoute {
  readonly sender: string;
  readonly recipient: string;
  readonly topic: string;
  readonly kind: "mailbox" | "local" | "direct" | "witness";
  readonly targets: readonly { eid: string; url: string }[];
  readonly bodyMode: CesrBodyMode;
}

/** Prepared wire borrows its bytes until the transport operation and cleanup finish. */
export type PreparedCesrTarget =
  | { readonly kind: "stored" }
  | {
    readonly kind: "tcp";
    readonly url: string;
    readonly destination: string;
    readonly message: Uint8Array;
  }
  | {
    readonly kind: "http";
    readonly url: string;
    readonly destination: string;
    readonly message: Uint8Array;
    readonly bodyMode: CesrBodyMode;
  };

/** Preserve selected endpoint and signed bytes; TCP has no HTTP body framing mode. */
function remoteCesrTarget(
  endpoint: { eid: string; url: string },
  message: Uint8Array,
  bodyMode: CesrBodyMode,
): PreparedCesrTarget {
  const base = { url: endpoint.url, destination: endpoint.eid, message };
  return new URL(endpoint.url).protocol === "tcp:" ? { ...base, kind: "tcp" } : { ...base, kind: "http", bodyMode };
}

interface MailboxPollerOptions {
  timeouts?: Partial<MailboxPollingTimeoutPolicy>;
  services?: RuntimeServices;
  pollTransport?: MailboxPollTransport;
}

/**
 * Mailbox-first postman for queued signed CESR messages.
 *
 * Responsibilities:
 * - resolve recipient aliases against organizer/contact state
 * - route to all currently authorized recipient mailbox endpoints when present
 * - fall back to direct controller/agent endpoints, then one witness endpoint,
 *   when no mailbox exists
 */
export class Poster {
  /** Borrowed habitat collection and backing accepted protocol state. */
  readonly hby: Habery;
  /** Borrowed mailbox store (mbx); null means this host provides no local mailbox. */
  readonly mbx: Mailboxer | null;
  /** Contact reader used only to resolve user-provided recipient aliases. */
  readonly organizer: Organizer;
  /** Borrowed HTTP client and clock; selected explicitly by composition. */
  readonly services: RuntimeServices;
  /** Runnable signed messages in admission order; the delivery worker is the sole consumer. */
  readonly evts = new Deck<PosterEvent>();
  /** Whole failed attempts retained until explicit retry, discard or close. */
  readonly failures: Extract<PosterOutcome, { kin: "failed" }>[] = [];
  /** Opt-in terminal outcomes, matched by concrete admitted event identity. */
  readonly cues = new Deck<PosterOutcome>();
  /** Events whose callers requested one terminal observation. */
  private readonly notifications = new Set<PosterEvent>();
  /** Enforce one active completion observer per event. */
  private readonly waiters = new Set<PosterEvent>();
  /** Prevent overlapping drains of the runnable queue. */
  private processing = false;
  /** Terminal admission state; closing a Poster cannot be reversed. */
  private closed = false;
  /** Cancels the current delivery pass before store teardown. */
  private active?: AbortController;
  /** Resolves after active delivery and its owned cleanup have joined. */
  private joined?: Promise<void>;
  /** Borrowed same-socket protocol receiver; null explicitly selects send-only capability. */
  private readonly protocol: ProtocolProcessor | null;

  /** Bind actual collaborators; Poster owns queue/I/O lifetimes and borrows their stores. */
  constructor(hby: Habery, mbx: Mailboxer | null, protocol: ProtocolProcessor | null, services: RuntimeServices) {
    this.hby = hby;
    this.mbx = mbx;
    this.organizer = new Organizer(hby.db, hby.signator);
    this.services = services;
    this.protocol = protocol;
  }

  /** Admit signed source bytes; callers must observe an outcome before reporting transmission. */
  send(evt: PosterEvent, { notify = false }: { notify?: boolean } = {}): PosterEvent {
    this.ensureOpen();
    if (evt.replies && !this.protocol) throw new Error("TCP reply delivery requires a protocol processor");
    // Admission owns the source bytes; later producer mutation cannot change queued work.
    const admitted = { ...evt, msg: evt.msg.slice() };
    if (notify) this.notifications.add(admitted);
    this.evts.push(admitted);
    return admitted;
  }

  /** Construct all source records before atomically publishing a complete cue or reply pair. */
  sendAll(evts: Iterable<PosterEvent>): void {
    this.ensureOpen();
    const pending: PosterEvent[] = [];
    for (const evt of evts) {
      if (evt.replies && !this.protocol) throw new Error("TCP reply delivery requires a protocol processor");
      pending.push({ ...evt, msg: evt.msg.slice() });
    }
    // Publish only after every event has passed capability checks and byte copying.
    this.evts.extend(pending);
  }

  /** Retry retained source bytes as a fresh attempt; successful destinations may receive duplicates. */
  retry(evt: PosterEvent, options: { notify?: boolean } = {}): PosterEvent {
    const index = this.failures.findIndex((failure) => failure.evt === evt);
    if (index < 0) throw new Error("Event is not retained as a failure");
    const admitted = this.send(evt, options);
    this.failures.splice(index, 1);
    return admitted;
  }

  /** Discard failed work without sending it again. */
  discard(evt: PosterEvent): boolean {
    const index = this.failures.findIndex((failure) => failure.evt === evt);
    if (index < 0) return false;
    this.failures.splice(index, 1);
    return true;
  }

  /** Wait only for this admission; cancellation releases its completion observation. */
  *wait(evt: PosterEvent): Operation<PosterOutcome> {
    if (!this.notifications.has(evt) && ![...this.cues].some((cue) => cue.evt === evt)) {
      throw new Error("Event was not admitted with completion notification");
    }
    if (this.waiters.has(evt)) throw new Error("Event already has a completion waiter");
    this.waiters.add(evt);
    try {
      while (true) {
        const outcome = this.takeOutcome(evt);
        if (outcome) return outcome;
        this.ensureOpen();
        yield* runtimeTurn();
      }
    } finally {
      this.notifications.delete(evt);
      this.waiters.delete(evt);
      this.takeOutcome(evt);
    }
  }

  /** Consume only this event's outcome while preserving other observers' queue order. */
  private takeOutcome(evt: PosterEvent): PosterOutcome | undefined {
    let found: PosterOutcome | undefined;
    const count = this.cues.length;
    for (let index = 0; index < count; index++) {
      const cue = this.cues.pull()!;
      if (cue.evt === evt) found = cue;
      else this.cues.push(cue);
    }
    return found;
  }

  /** Run queued delivery independently of query response intake and producer lifetimes. */
  *deliverDo(): Operation<void> {
    while (!this.closed) {
      yield* this.process();
      yield* runtimeTurn();
    }
  }

  /** Runnable and active work determine convergence; retained failures and observations do not. */
  get hasPending(): boolean {
    return this.processing || !this.evts.empty;
  }

  /** Reject new production before a closed output owner can consume its source. */
  ensureOpen(): void {
    if (this.closed) throw new Error("Poster is closed");
  }

  /** Abort and join actual I/O before releasing process-local queued and failed work. */
  *close(): Operation<void> {
    // Stop admission first, then abort/join before forgetting process-local work.
    this.closed = true;
    this.active?.abort();
    if (this.joined) yield* call(() => this.joined!);
    this.evts.clear();
    this.failures.length = 0;
    this.cues.clear();
    this.notifications.clear();
  }

  /** Deliver the current FIFO contents; recognized refusals retain the whole event and allow later work. */
  process(): Operation<void> {
    // deno-lint-ignore no-this-alias -- The operation owns this finite output pass.
    const self = this;
    return call(function*() {
      if (self.processing || self.closed) return;
      self.processing = true;
      const active = self.active = new AbortController();
      let complete!: () => void;
      self.joined = new Promise<void>((resolve) => complete = resolve);
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          self.processing = false;
          self.active = undefined;
          self.joined = undefined;
          complete();
        }
      });
      // Snapshot a finite pass; producers may append work for the next worker turn.
      const count = self.evts.length;
      for (let remaining = count; remaining > 0 && !self.closed; remaining--) {
        const evt = self.evts.peekHead();
        if (!evt) break;
        active.signal.throwIfAborted();
        const deliveries: string[] = [];
        let outcome: PosterOutcome;
        try {
          outcome = yield* self.deliverEvent(evt, deliveries, active.signal);
        } catch (error) {
          // Preserve the source and partial progress before exposing an unexpected failure.
          self.finish({ kin: "failed", evt, deliveries, error });
          throw error;
        }
        self.finish(outcome);
      }
    });
  }

  /** Remove runnable work before publishing its optional terminal observation. */
  private finish(outcome: PosterOutcome): void {
    this.evts.pull();
    if (outcome.kin === "failed") this.failures.push(outcome);
    if (this.notifications.delete(outcome.evt)) this.cues.push(outcome);
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

  /** Execute one admitted source message using the existing mailbox-first target policy. */
  private *deliverEvent(evt: PosterEvent, deliveries: string[], signal: AbortSignal): Operation<PosterOutcome> {
    const hab = this.hby.habs.get(evt.src);
    if (!hab) throw new Error(`Unknown local sender ${evt.src}`);
    const route = this.findBytesRoute(hab, {
      recipient: evt.dest,
      recipientIsPrefix: true,
      topic: evt.topic,
      delivery: evt.delivery,
    });
    if (!route) {
      return {
        kin: "failed",
        evt,
        deliveries,
        error: new ValidationError(`No end roles for ${evt.dest} to send raw CESR payload.`),
      };
    }
    // A refused target does not prevent later targets from receiving this event.
    const failed: Error[] = [];
    try {
      for (const endpoint of route.targets) {
        const target = yield* this.prepareBytesTarget(hab, route, endpoint, evt.msg);
        try {
          if (target.kind === "http") {
            const outcome = yield* attemptPostCesr(target.url, (signal) => chunkBytes(target.message, { signal }), {
              bodyMode: target.bodyMode,
              destination: target.destination,
              services: this.services,
              signal,
            });
            if (outcome.kind === "refuse") {
              failed.push(outcome.error);
              continue;
            }
          } else if (target.kind === "tcp") {
            // The messenger owns the attempt; Poster keeps source and event-level progress.
            yield* new TCPMessenger(this.protocol, this.services.clock).send(target.url, target.message, {
              signal,
              replies: evt.replies,
            });
          }
        } catch (error) {
          if (!(error instanceof TransportError)) throw error;
          failed.push(error);
          continue;
        }
        deliveries.push(endpoint.url);
      }
    } catch (error) {
      if (failed.length) {
        throw new AggregateError([...failed, error], `CESR delivery interrupted for ${evt.dest}`, { cause: error });
      }
      throw error;
    }
    if (failed.length) {
      const error = failed.length === 1
        ? failed[0]
        : new AggregateError(failed, `CESR delivery failed for ${evt.dest}`);
      return { kin: "failed", evt, deliveries, error };
    }
    return { kin: "sent", evt, deliveries };
  }

  /** A request-owned HTTP response may omit optional outbound delivery when no endpoint exists. */
  canDeliver(evt: PosterEvent): boolean {
    const hab = this.hby.habs.get(evt.src);
    if (!hab) throw new Error(`Unknown local sender ${evt.src}`);
    return this.findBytesRoute(hab, {
      recipient: evt.dest,
      recipientIsPrefix: true,
      topic: evt.topic,
      delivery: evt.delivery,
    }) !== null;
  }

  /** Snapshot mailbox/direct/witness policy without opening transport or reading message bytes. */
  resolveBytesRoute(
    hab: Hab,
    args: { recipient: string; topic?: string; delivery?: ExchangeDeliveryPreference },
  ): RawCesrRoute {
    const recipient = this.resolveRecipient(args.recipient);
    const route = this.findBytesRoute(hab, { ...args, recipient, recipientIsPrefix: true });
    if (!route) throw new ValidationError(`No end roles for ${recipient} to send raw CESR payload.`);
    return route;
  }

  /** Same policy; parsed-prefix lookup bypasses aliases, absence is explicit, other failures propagate. */
  findBytesRoute(
    hab: Hab,
    args: { recipient: string; topic?: string; delivery?: ExchangeDeliveryPreference; recipientIsPrefix?: boolean },
  ): RawCesrRoute | null {
    const recipient = args.recipientIsPrefix ? args.recipient : this.resolveRecipient(args.recipient);
    const topic = args.topic ?? "";
    const delivery = args.delivery ?? "auto";
    const base = { sender: hab.pre, recipient, topic, bodyMode: this.hby.cesrBodyMode };
    const mailboxes = delivery === "direct" ? [] : mailboxDeliveryEndpoints(hab, recipient);
    if (mailboxes.length > 0) {
      if (!topic) throw new ValidationError(`Mailbox delivery requires an explicit topic for ${recipient}.`);
      return { ...base, kind: "mailbox", targets: mailboxes };
    }
    if (
      delivery !== "direct" && topic && this.mbx && this.hby.db.prefixes.has(hab.pre)
      && this.hby.db.ends.get([recipient, Roles.mailbox, hab.pre])?.allowed
    ) {
      return { ...base, kind: "local", targets: [{ eid: hab.pre, url: `local-mailbox:${hab.pre}` }] };
    }
    const direct = directDeliveryEndpoints(hab, recipient);
    if (direct.length > 0) return { ...base, kind: "direct", targets: direct };
    if (delivery !== "direct") {
      if (!topic) {
        throw new ValidationError(`Witness fallback delivery requires an explicit topic for ${recipient}.`);
      }
      const witness = firstSortedEndpoint(hab.endsFor(recipient)[Roles.witness]);
      if (witness) return { ...base, kind: "witness", targets: [witness] };
    }
    return null;
  }

  /** Prepare a target using the supplied wire and selected endpoint. */
  *prepareBytesTarget(
    hab: Hab,
    route: RawCesrRoute,
    endpoint: { eid: string; url: string },
    message: Uint8Array,
  ): Operation<PreparedCesrTarget> {
    if (hab.pre !== route.sender) throw new Error("CESR route belongs to another sender");
    if (route.kind !== "direct") {
      const forwarded = yield* this.prepareForwardedTarget(hab, route.recipient, route.topic, message, endpoint);
      return forwarded.kind === "http" ? { ...forwarded, bodyMode: route.bodyMode } : forwarded;
    }
    return remoteCesrTarget(endpoint, message, route.bodyMode);
  }

  /** Prepare complete signed wire and its introduction before opening transport. */
  private *prepareForwardedTarget(
    hab: Hab,
    recipient: string,
    topic: string,
    message: Uint8Array,
    endpoint: { eid: string; url: string },
  ): Operation<PreparedCesrTarget> {
    if (this.hby.db.prefixes.has(endpoint.eid)) {
      const stored = this.requireMbx().storeMsg(
        mailboxTopicKey(recipient, topic),
        mailboxReplyPayload(hab, recipient, topic, message),
      );
      if (!stored) throw new Error("Mailbox publication did not complete");
      return { kind: "stored" };
    }
    const forwarded = yield* buildForwardedDelivery(hab, { recipient, topic, message });
    const intro = introduce(hab, endpoint.eid);
    return remoteCesrTarget(endpoint, concatBytes(intro, forwarded), this.hby.cesrBodyMode);
  }

  /** Require provider mailbox storage for local mailbox-target delivery. */
  private requireMbx(): Mailboxer {
    if (!this.mbx) {
      throw new ValidationError(
        "Local mailbox delivery requires provider mailbox storage.",
      );
    }
    return this.mbx;
  }
}

/**
 * Accepted `/fwd` route handler that stores embedded payloads in mailbox topics.
 *
 * This is the `keri-ts` mailbox-storage analogue to KERIpy's `ForwardHandler`.
 *
 * Authorization rule:
 * - the request-scoped mailbox AID passed with this message must currently be
 *   authorized for the addressed recipient
 */
export class ForwardHandler implements ExchangeRouteHandler {
  static readonly resource = "/fwd";
  readonly resource = ForwardHandler.resource;
  /** This route binds a single v2 child body; recipient processors authenticate its evidence. */
  readonly acceptsNests = true;
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
    nests?: readonly CesrFrame[];
  }): boolean {
    const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
    if (typeof modifiers?.pre !== "string" || typeof modifiers?.topic !== "string") return false;
    if (args.serder.pvrsn.major < 2) {
      return !args.nests?.length && extractForwardedMessage(args.serder, args.attachments) !== null;
    }
    if (args.nests?.length !== 1) return false;
    const signed = (args.serder.a as Record<string, unknown>)?.evt;
    const child = args.nests[0].body;
    if (typeof signed !== "string" || !(child instanceof SerderKERI || child instanceof SerderACDC)) return false;
    try {
      return child.verify() && new Diger({ qb64: signed }).verify(child.raw);
    } catch {
      return false;
    }
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
    /** Borrowed child wire remains live for this awaited handler operation. */
    nests?: readonly CesrFrame[];
    /** Receiving hosted endpoint whose authority must cover the addressed recipient. */
    mailboxAid?: string | null;
  }): void | Operation<void> {
    const modifiers = args.serder.ked?.q as Record<string, unknown> | undefined;
    const recipient = typeof modifiers?.pre === "string" ? modifiers.pre : null;
    const topic = typeof modifiers?.topic === "string" ? modifiers.topic : null;
    const child = args.serder.pvrsn.major >= 2 ? args.nests?.[0] : undefined;
    const forwarded = child ? null : extractForwardedMessage(args.serder, args.attachments);
    const mailboxAid = args.mailboxAid;
    if (!recipient || !topic || (!child && !forwarded)) {
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
    if (child) {
      // Mailbox LMDB accepts a finite row; collect one child, never the whole exchange stream.
      return abortable(async (signal) => {
        const wire = await collectPayload(nestedPayload(child, Vrsn_2_0), signal);
        signal.throwIfAborted();
        this.mailboxDirector.publish(recipient, topic, wire);
      });
    }
    this.mailboxDirector.publish(recipient, topic, forwarded!);
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
 * - replays locally stored mailbox topics for local habitat prefixes
 * - polls configured remote mailbox or witness endpoints with `mbx` queries
 * - lends retrieved records to the composed consumer; protocol intake stays outside
 */
export class MailboxPoller {
  static readonly DefaultTimeoutPolicy: Readonly<MailboxPollingTimeoutPolicy> = Object.freeze({
    requestOpenTimeoutMs: 5_000,
    maxPollDurationMs: 30_000,
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

  /** Register one mailbox topic that this poller should retrieve. */
  registerTopic(topic: string): void {
    this.mailboxDirector.registerTopic(topic);
  }

  /**
   * Poll forever, streaming typed batches into one sink.
   *
   * Each remote endpoint progresses independently, and awaits the consumer before
   * reading the next event or advancing its persisted cursor.
   */
  *pollDo(
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
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
              yield* call(() => onBatch({ source: "local", pre, messages: local }));
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

  /** Stream one remote response through its consumer before recording cursor progress. */
  private *pollRemoteEndpointOnce(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<void> {
    const cursor = this.mailboxDirector.remoteQueryCursor(target.targetPre, endpoint.eid);
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    yield* this.pollTransport.poll({
      hab: target.signerHab,
      targetPre: target.targetPre,
      endpoint,
      topics: cursor,
      bodyMode: this.hby.cesrBodyMode,
      timeouts: mailboxFetchTimeoutPolicy(this.timeoutPolicy),
      services: this.services,
    }, function*(message) {
      yield* call(() =>
        onBatch({ source: "remote", pre: target.targetPre, eid: endpoint.eid, messages: [message.msg] })
      );
      self.mailboxDirector.updateRemoteCursor(target.targetPre, endpoint.eid, message.topic, message.idx);
    });
  }

  /** Keep one long-lived worker running for each currently configured remote endpoint. */
  private *syncRemoteWorkers(
    remoteWorkers: Map<string, Task<void>>,
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
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
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<never> {
    while (true) {
      yield* this.pollRemoteEndpointOnce(target, endpoint, onBatch);
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
 * Build a signed legacy embed or v2 nested `/fwd` envelope for one complete message.
 *
 * The caller is responsible for any surrounding introduction or end-role
 * material that should travel with the forwarded request.
 */
function* buildForwardedDelivery(
  hab: Hab,
  args: {
    recipient: string;
    topic: string;
    message: Uint8Array;
  },
): Operation<Uint8Array> {
  const frames = parseBytes(args.message);
  if (frames.length !== 1) throw new ValidationError("Forwarding requires one complete CESR message.");
  const child = frames[0];
  if (child.body.pvrsn.major >= 2 || (child.gvrsn?.major ?? 1) >= 2) {
    const [serder] = exchange("/fwd", {
      evt: new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(child.body.raw, MtrDex.Blake3_256) }).qb64,
    }, {
      sender: hab.pre,
      modifiers: { pre: args.recipient, topic: transportMailboxTopic(args.topic) },
      pvrsn: Vrsn_2_0,
    });
    // Capture the signer before the codec reader yields; child proofs remain independent.
    const [outer] = parseBytes(hab.endorse(serder, { pipelined: false, gvrsn: Vrsn_2_0, genusify: true }));
    return yield* abortable((signal) => collectPayload(framePayload({ ...outer, nests: [child] }), signal));
  }
  const message = concatBytes(
    child.body.raw,
    yield* abortable((signal) => collectPayload(attachmentPayload(child), signal)),
  );
  const [serder, attachments] = exchange(
    "/fwd",
    {},
    {
      sender: hab.pre,
      modifiers: { pre: args.recipient, topic: transportMailboxTopic(args.topic) },
      embeds: { evt: message },
    },
  );
  const endorsed = hab.endorse(serder, { pipelined: false });
  return concatBytes(endorsed, attachments);
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
 * Borrow a Hab/store for lazy introduction output, preserving target KEL, oldest
 * delegator first, then endpoint/location replies. Capture begins on iteration.
 * No source is opened when a witness/receipt already makes introduction unnecessary.
 * Native proof/key copies and the large-history transport caller remain separately qualified.
 */
export function introductionMessages(
  hab: Hab,
  remote: string,
): Iterable<Uint8Array> {
  const endpoints = hab.replyEndRoleMessages(hab.pre);
  return {
    *[Symbol.iterator]() {
      const kever = hab.kever;
      if (!kever || kever.wits.includes(remote)) return;
      const latestSaid = kever.serder.said;
      if (!latestSaid || remoteAlreadyReceiptedLatestEvent(hab, remote, latestSaid)) return;
      const captured = hab.db.replay(hab.pre);
      if (captured) yield* captured;
      yield* endpoints;
    },
  };
}

/** Collect the introduction required by the existing finite query/forwarding path. */
export function introduce(hab: Hab, remote: string): Uint8Array {
  return concatBytes(...introductionMessages(hab, remote));
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
  /** Await each complete event consumer; false ends the poll without reading ahead. */
  poll(
    args: MailboxPollTransportRequest,
    consume: (message: MailboxSseMessage) => Operation<boolean | void>,
  ): Operation<void>;
}

const defaultMailboxPollTransport: MailboxPollTransport = {
  *poll(args, consume): Operation<void> {
    // A completed long poll releases its HTTP resource before the next poll begins.
    return yield* call(() =>
      fetchMailboxMessages(
        args.hab,
        args.targetPre,
        args.endpoint.eid,
        args.endpoint.url,
        args.topics,
        args.bodyMode,
        args.timeouts,
        args.services,
        consume,
      )
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
  services: RuntimeServices,
  consume: (message: MailboxSseMessage) => Operation<boolean | void>,
): Operation<void> {
  const query = hab.query(targetPre, src, { route: "mbx", q: { topics } });
  const handle = yield* fetchMailboxQueryResponse(
    url,
    query,
    bodyMode,
    src,
    timeouts.requestOpenTimeoutMs,
    services,
  );
  if (!handle) {
    return;
  }
  const { response, controller } = handle;

  if (!response.ok) {
    yield* closeResponseBody(response);
    return;
  }

  yield* consumeMailboxSse(
    response,
    controller,
    consume,
    {
      idleTimeoutMs: timeouts.readIdleTimeoutMs,
      maxDurationMs: timeouts.maxReadDurationMs,
      services,
    },
  );
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
  });
}

function mailboxFetchTimeoutPolicy(
  timeouts: Readonly<MailboxPollingTimeoutPolicy>,
): MailboxFetchTimeoutPolicy {
  return {
    requestOpenTimeoutMs: timeouts.requestOpenTimeoutMs,
    maxReadDurationMs: timeouts.maxPollDurationMs,
    readIdleTimeoutMs: MailboxPoller.ReadIdleTimeoutMs,
  };
}

function positiveTimeoutMs(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Post finite mailbox/EXN caller bytes through the shared progressive, scope-owned sender. */
export function* postCesrMessage(
  url: string,
  body: Uint8Array,
  bodyMode: "header" | "body",
  destination?: string,
  services: RuntimeServices = defaultRuntimeServices,
  signal?: AbortSignal,
): Operation<void> {
  yield* postCesr(url, (signal) => chunkBytes(body, { signal }), {
    bodyMode,
    destination,
    services,
    signal,
  });
}
