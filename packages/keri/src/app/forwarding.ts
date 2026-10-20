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
import type { HttpStreamResponse } from "./http-client.ts";

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
import { action, call, type Operation, resource, scoped, spawn, type Task } from "npm:effection@^3.6.0";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { Kever } from "../core/kever.ts";
import { CREDENTIAL_MAILBOX_TOPIC, DELEGATE_MAILBOX_TOPIC, OOBI_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { Roles } from "../core/roles.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import { abortable } from "./abortable.ts";
import { buildCesrRequest, type CesrBodyMode } from "./cesr-http.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { HTTPMessenger } from "./http-messenger.ts";
import { requestWithHeaderTimeout } from "./httping.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { consumeMailboxSse, type MailboxSseMessage } from "./mailbox-sse.ts";
import {
  directDeliveryEndpoints,
  firstSortedEndpoint,
  mailboxDeliveryEndpoints,
  mailboxPollEndpoints,
  mailboxTopicKey,
} from "./mailboxing.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { TCPMessenger } from "./tcp-messenger.ts";
import { TransportError } from "./transport-error.ts";

/** Delivery preference accepted by CLI and runtime exchange send helpers. */
export type ExchangeDeliveryPreference = "auto" | "direct" | "indirect";

/** One admitted source message; identity distinguishes repeated sends of the same signed bytes. */
export interface PosterEvent {
  /**
   * Local sender AID used to resolve the signing habitat on each attempt.
   */
  readonly src: string;
  /**
   * Final recipient AID; this is not necessarily the intermediary endpoint.
   */
  readonly dest: string;
  /**
   * Mailbox routing topic; required when using indirect delivery.
   */
  readonly topic: string;
  /**
   * Original signed message copied at admission; caller mutation cannot change queued work.
   */
  readonly msg: Uint8Array;
  /**
   * Existing route preference; omission uses mailbox-first auto selection.
   */
  readonly delivery?: ExchangeDeliveryPreference;
  /**
   * Request same-socket TCP reply processing; requires a protocol processor.
   */
  readonly replies?: boolean;
}

/** Optional terminal observation of one concrete delivery attempt, not remote acceptance. */
export type PosterOutcome =
  | {
    /** Terminal local attempt result; neither variant proves remote protocol acceptance. */
    kin: "sent";
    /** Exact admitted event identity matched by wait(evt), including repeated same-SAID sends. */
    evt: PosterEvent;
    /** Successful endpoint URLs from this attempt, including partial success before failure. */
    deliveries: string[];
  }
  | {
    /** Terminal local attempt result; neither variant proves remote protocol acceptance. */
    kin: "failed";
    /** Exact admitted event identity matched by wait(evt), including repeated same-SAID sends. */
    evt: PosterEvent;
    /** Successful endpoint URLs from this attempt, including partial success before failure. */
    deliveries: string[];
    /** Observed failure with original status/cause, including any aggregated target failures. */
    error: unknown;
  };

/** Recipient policy captured synchronously from current accepted routing state for one attempt. */
interface RawCesrRoute {
  /**
   * Local sender AID whose habitat prepared this route.
   */
  readonly sender: string;
  /**
   * Final recipient AID after alias resolution.
   */
  readonly recipient: string;
  /**
   * Mailbox topic used for indirect delivery.
   */
  readonly topic: string;
  /**
   * Selected local, direct, mailbox or witness route policy.
   */
  readonly kind: "mailbox" | "local" | "direct" | "witness";
  /**
   * Ordered selected endpoint AIDs and URLs; execution is sequential.
   */
  readonly targets: readonly { eid: string; url: string }[];
  /**
   * HTTP framing policy captured for this attempt.
   */
  readonly bodyMode: CesrBodyMode;
}

/** Prepared wire borrows its bytes until the transport operation and cleanup finish. */
type PreparedCesrTarget =
  | {
    /** Stored means the local mailbox transaction completed; tcp/http still require network execution. */
    readonly kind: "stored";
  }
  | {
    /** Stored means the local mailbox transaction completed; tcp/http still require network execution. */
    readonly kind: "tcp";
    /** Selected transport endpoint URL for this attempt. */
    readonly url: string;
    /** Endpoint AID, which may be a mailbox intermediary rather than the final recipient. */
    readonly destination: string;
    /** Prepared introduction/forwarding wire borrowed until this transport operation joins cleanup. */
    readonly message: Uint8Array;
  }
  | {
    /** Stored means the local mailbox transaction completed; tcp/http still require network execution. */
    readonly kind: "http";
    /** Selected transport endpoint URL for this attempt. */
    readonly url: string;
    /** Endpoint AID, which may be a mailbox intermediary rather than the final recipient. */
    readonly destination: string;
    /** Prepared introduction/forwarding wire borrowed until this transport operation joins cleanup. */
    readonly message: Uint8Array;
    /** HTTP attachment placement for this attempt; TCP has no corresponding mode. */
    readonly bodyMode: CesrBodyMode;
  };

/**
 * Preserve selected endpoint and signed bytes; TCP has no HTTP body framing mode.
 *
 * @param endpoint Selected endpoint AID and concrete URL.
 * @param message Prepared bytes borrowed until transport cleanup completes.
 * @param bodyMode HTTP attachment placement; irrelevant for TCP.
 * @returns A TCP or HTTP target according to the endpoint URL scheme.
 */
function remoteCesrTarget(
  endpoint: { eid: string; url: string },
  message: Uint8Array,
  bodyMode: CesrBodyMode,
): PreparedCesrTarget {
  const base = { url: endpoint.url, destination: endpoint.eid, message };
  return new URL(endpoint.url).protocol === "tcp:" ? { ...base, kind: "tcp" } : { ...base, kind: "http", bodyMode };
}

/**
 * Scalar polling policy overrides; dependencies are constructor arguments.
 */
interface MailboxPollerOptions {
  /**
   * Optional millisecond header and poll-window overrides.
   */
  timeouts?: Partial<MailboxPollingTimeoutPolicy>;
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
  /** Borrowed HTTP client selected explicitly by composition. */
  readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  readonly clock: RuntimeClock;
  /** Runnable signed messages in admission order; the delivery worker is the sole consumer. */
  readonly evts = new Deck<PosterEvent>();
  /** Terminal failed attempts retained until close, pending the unobserved-failure reporting change. */
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

  /**
   * Bind actual collaborators; Poster owns queue/I/O lifetimes and borrows their stores.
   *
   * @param hby Borrowed local habitat collection and accepted-state database.
   * @param mbx Borrowed provider mailbox store, or null when local storage is unavailable.
   * @param protocol Borrowed same-database processor for TCP replies; null permits send-only work.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock for transport deadlines; times are milliseconds.
   * @throws RangeError if protocol state belongs to a different database.
   */
  constructor(
    hby: Habery,
    mbx: Mailboxer | null,
    protocol: ProtocolProcessor | null,
    http: HttpClient,
    clock: RuntimeClock,
  ) {
    if (protocol && protocol.kvy.db !== hby.db) throw new RangeError("Poster protocol must use the same database");
    this.hby = hby;
    this.mbx = mbx;
    this.http = http;
    this.clock = clock;
    this.protocol = protocol;
  }

  /**
   * Admit signed source bytes; callers must observe an outcome before reporting transmission.
   *
   * @param evt Concrete source-message record; completion/failure lookup uses object identity, not message SAID.
   * @param options Set notify to retain one terminal outcome for this admission; default false.
   * @returns A fresh admitted record with copied msg bytes; admission is not transmission.
   * @throws Closed owner or unsupported reply capability rejects before queue publication.
   */
  send(evt: PosterEvent, { notify = false }: { notify?: boolean } = {}): PosterEvent {
    this.ensureOpen();
    if (evt.replies && !this.protocol) throw new Error("TCP reply delivery requires a protocol processor");
    // Admission owns the source bytes; later producer mutation cannot change queued work.
    const admitted = { ...evt, msg: evt.msg.slice() };
    if (notify) this.notifications.add(admitted);
    this.evts.push(admitted);
    return admitted;
  }

  /**
   * Construct all source records before atomically publishing a complete cue or reply pair.
   *
   * @param evts Finite iterable for one cue/pair; every record is checked and copied before atomic queue publication.
   * @throws Any construction/capability failure leaves the runnable queue unchanged.
   */
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

  /**
   * Wait for one admission without owning its delivery.
   * The delivery worker must run independently. Cancellation removes the observer and
   * its notification; it does not withdraw queued work or abort the attempt.
   *
   * @param evt Exact record returned by send with notify enabled.
   * @returns This admission's sent or failed outcome, consuming its notification.
   * @throws Missing notification, duplicate waiter or closure before an outcome is available.
   */
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

  /**
   * Consume only this event's outcome while preserving other observers' queue order.
   *
   * @param evt Concrete source-message record; completion/failure lookup uses object identity, not message SAID.
   * @returns Matching outcome, or undefined; other outcome order is preserved.
   */
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

  /**
   * Remove runnable work before publishing its optional terminal observation.
   *
   * @param outcome Terminal result for the runnable head, including successful target URLs and any failure.
   */
  private finish(outcome: PosterOutcome): void {
    this.evts.pull();
    if (outcome.kin === "failed") this.failures.push(outcome);
    if (this.notifications.delete(outcome.evt)) this.cues.push(outcome);
  }

  /**
   * Resolve and execute one event using sequential current endpoints.
   * Observed HTTP refusal and TransportError permit remaining targets to run.
   * Unexpected construction/parser/storage/cleanup errors propagate so process can
   * retain and publish the failed event before exposing the error.
   *
   * @param evt Concrete source-message record; completion/failure lookup uses object identity, not message SAID.
   * @param deliveries Mutable accumulator of successfully delivered target URLs, retained even if a later target throws.
   * @param signal Active Poster pass cancellation; forwarded into each messenger attempt.
   * @returns Sent if every target completes; otherwise a failure with partial successes.
   */
  private *deliverEvent(evt: PosterEvent, deliveries: string[], signal: AbortSignal): Operation<PosterOutcome> {
    const hab = this.hby.habs.get(evt.src);
    if (!hab) throw new Error(`Unknown local sender ${evt.src}`);
    const route = this.findBytesRoute(hab, {
      recipient: evt.dest,
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
            const outcome = yield* new HTTPMessenger(this.protocol, this.http, this.clock).send(
              target.url,
              target.message,
              {
                bodyMode: target.bodyMode,
                destination: target.destination,
                signal,
              },
            );
            if (outcome.kind === "refuse") {
              failed.push(outcome.error);
              continue;
            }
          } else if (target.kind === "tcp") {
            // The messenger owns the attempt; Poster keeps source and event-level progress.
            yield* new TCPMessenger(this.protocol, this.clock).send(target.url, target.message, {
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

  /**
   * A request-owned HTTP response may omit optional outbound delivery when no endpoint exists.
   *
   * @param evt Concrete source-message record; completion/failure lookup uses object identity, not message SAID.
   * @returns Whether current routing finds a target; this is not a connectivity probe.
   */
  canDeliver(evt: PosterEvent): boolean {
    const hab = this.hby.habs.get(evt.src);
    if (!hab) throw new Error(`Unknown local sender ${evt.src}`);
    return this.findBytesRoute(hab, {
      recipient: evt.dest,
      topic: evt.topic,
      delivery: evt.delivery,
    }) !== null;
  }

  /**
   * Resolve the prepared destination AID; absence is explicit and other failures propagate.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param args Resolved recipient AID, optional mailbox topic and delivery preference.
   * @returns Current route snapshot, or null when no target is known.
   * @throws Invalid recipient/topic policy or storage lookup failures propagate.
   */
  private findBytesRoute(
    hab: Hab,
    args: { recipient: string; topic?: string; delivery?: ExchangeDeliveryPreference },
  ): RawCesrRoute | null {
    const recipient = args.recipient;
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

  /**
   * Prepare a target using the supplied wire and selected endpoint.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param route Recipient/transport policy selected for this attempt; sender must match hab.
   * @param endpoint One selected endpoint AID and URL from the route.
   * @param message Original signed CESR bytes; outer forwarding/introduction material may be rebuilt.
   * @returns A prepared remote target, or stored after authorized local mailbox publication.
   */
  private *prepareBytesTarget(
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

  /**
   * Prepare complete signed wire and its introduction before opening transport.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param recipient Final recipient AID, distinct from the intermediary endpoint.
   * @param topic Recipient mailbox topic used by the forwarding envelope.
   * @param message Original signed CESR bytes; outer forwarding/introduction material may be rebuilt.
   * @param endpoint Mailbox/witness endpoint selected for this attempt.
   * @returns Stored for a local endpoint, or signed forwarding wire with its introduction.
   */
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

  /**
   * Require provider mailbox storage for local mailbox-target delivery.
   *
   * @returns Borrowed provider mailbox store.
   * @throws ValidationError when this host has no mailbox storage.
   */
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
  /** Registered exchange route for store-forward messages. */
  static readonly resource = "/fwd";
  /** Instance route identity used by exchange dispatch. */
  readonly resource = ForwardHandler.resource;
  /** This route binds a single v2 child body; recipient processors authenticate its evidence. */
  readonly acceptsNests = true;
  /** Borrowed provider publication/correlation owner. */
  readonly mailboxDirector: MailboxDirector;

  /**
   * Bind mailbox publication without acquiring a store.
   *
   * @param mailboxDirector Borrowed provider owner that publishes accepted forwarded payloads.
   */
  constructor(mailboxDirector: MailboxDirector) {
    this.mailboxDirector = mailboxDirector;
  }

  /**
   * Verify that the embedded exchange has the mailbox modifiers and one
   * extractable forwarded payload.
   *
   * @param args Signed forwarding exchange, attachment evidence and optional nested frames; children retain their own authentication requirements.
   * @returns Whether required modifiers and one bound forwarded payload are structurally valid.
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
   *
   * @param args Accepted exchange with borrowed attachments/children and receiving mailboxAid provenance.
   * @returns An operation for v2 child serialization, or synchronous completion/no-op for legacy or unauthorized input.
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

/**
 * Check recipient-specific store-forward authority without treating a controller endpoint as a mailbox.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param recipient Final recipient AID.
 * @param recipientKever Accepted recipient state supplying its current witness cohort.
 * @param hostAid Receiving endpoint AID whose witness/mailbox/agent authority is checked.
 * @returns True when current accepted witness or endpoint-role state authorizes a local store-forward host.
 */
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

/**
 * Check recipient-specific store-forward authority without treating a controller endpoint as a mailbox.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param recipient Final recipient AID.
 * @param recipientKever Accepted recipient state supplying its current witness cohort.
 * @returns True when current accepted witness or endpoint-role state authorizes a local store-forward host.
 */
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
 * Retrieve recipient messages from remote mailbox or witness endpoints over HTTP/SSE.
 *
 * Each endpoint has an independent worker and durable progress in the director.
 * Retrieved records are lent to the awaited consumer; protocol intake stays outside.
 * A provider store in the same runtime is never scanned for local recipient input.
 */
export class MailboxPoller {
  /**
   * Default header acquisition (5 seconds) and absolute poll window (30 seconds).
   */
  static readonly DefaultTimeoutPolicy: Readonly<MailboxPollingTimeoutPolicy> = Object.freeze({
    requestOpenTimeoutMs: 5_000,
    maxPollDurationMs: 30_000,
  });
  /**
   * Idle read window after the first complete event, in milliseconds.
   */
  static readonly ReadIdleTimeoutMs = 500;

  /** Borrowed habitat collection used to select mailbox signers. */
  readonly hby: Habery;
  /** Shared provider topics and persisted remote cursors. */
  readonly mailboxDirector: MailboxDirector;
  /** Existing request-open and SSE-window settings, normalized once. */
  readonly timeoutPolicy: Readonly<MailboxPollingTimeoutPolicy>;
  /** Borrowed HTTP client passed to each polling attempt. */
  readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  readonly clock: RuntimeClock;

  /**
   * Bind polling inputs and dependencies without starting workers or acquiring stores.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param mailboxDirector Borrowed provider/topic/cursor owner.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   * @param options Optional timeout overrides; finite positive values are floored with a 1 ms minimum. Missing/nonpositive/nonfinite values use 5-second headers and 30-second poll windows.
   */
  constructor(
    hby: Habery,
    mailboxDirector: MailboxDirector,
    http: HttpClient,
    clock: RuntimeClock,
    options: MailboxPollerOptions = {},
  ) {
    const { timeouts } = options;
    this.hby = hby;
    this.mailboxDirector = mailboxDirector;
    this.timeoutPolicy = normalizeMailboxPollingTimeoutPolicy(timeouts);
    this.http = http;
    this.clock = clock;
  }

  /**
   * Register one mailbox topic that this poller should retrieve.
   *
   * @param topic Protocol mailbox topic; leading slash is normalized where required.
   */
  registerTopic(topic: string): void {
    this.mailboxDirector.registerTopic(topic);
  }

  /**
   * Poll forever, streaming typed batches into one sink.
   *
   * Each remote endpoint progresses independently, and awaits the consumer before
   * reading the next event or advancing its persisted cursor.
   *
   * @param onBatch Awaited endpoint-batch consumer; the durable event cursor advances only after it succeeds. Failure or cancellation leaves that event available for later retrieval.
   * @throws Consumer/transport failures propagate; endpoint workers are joined on scope exit.
   */
  *pollDo(
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<never> {
    const remoteWorkers = new Map<string, Task<void>>();

    try {
      while (true) {
        const topics = this.mailboxDirector.registeredTopics();
        yield* this.syncRemoteWorkers(remoteWorkers, onBatch, topics);

        yield* runtimeTurn();
      }
    } finally {
      for (const task of [...remoteWorkers.values()].reverse()) {
        yield* task.halt();
      }
    }
  }

  /**
   * Stream one remote response through its consumer before recording cursor progress.
   *
   * @param target Mailbox subject habitat plus the actual local signer (a member for groups).
   * @param endpoint Selected remote endpoint AID and HTTP(S) URL.
   * @param onBatch Awaited consumer; successful completion precedes durable cursor advancement.
   */
  private *pollRemoteEndpointOnce(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<void> {
    const cursor = this.mailboxDirector.remoteQueryCursor(target.targetPre, endpoint.eid);
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    // The concrete HTTP/SSE operation owns and joins this whole poll attempt.
    yield* call(() =>
      fetchMailboxMessages(
        target.signerHab,
        target.targetPre,
        endpoint.eid,
        endpoint.url,
        cursor,
        this.hby.cesrBodyMode,
        mailboxFetchTimeoutPolicy(this.timeoutPolicy),
        this.http,
        this.clock,
        function*(message) {
          yield* call(() => onBatch({ pre: target.targetPre, eid: endpoint.eid, messages: [message.msg] }));
          self.mailboxDirector.updateRemoteCursor(target.targetPre, endpoint.eid, message.topic, message.idx);
        },
      )
    );
  }

  /**
   * Keep one long-lived worker running for each currently configured remote endpoint.
   *
   * @param remoteWorkers Owned worker map, mutated to match current endpoint selection.
   * @param onBatch Shared awaited consumer used independently by each endpoint worker.
   * @param topics Current registered topics; no topics means no remote workers.
   */
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
   *
   * @param target Mailbox subject habitat plus the actual local signer (a member for groups).
   * @param endpoint Selected remote endpoint AID and HTTP(S) URL.
   * @param onBatch Awaited consumer; successful completion precedes durable cursor advancement.
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

  /**
   * Select locally pollable subjects without substituting the group for its member signer.
   *
   * @returns Local subject/signing pairs; groups without an available local member are omitted.
   */
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

  /**
   * Choose the actual local signer for a subject's mailbox query.
   *
   * @param hab Local subject habitat, possibly a group.
   * @returns The habitat itself, or its available local group member; null when unresolved.
   */
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

/**
 * Mailbox subject and signer selection; a group subject uses its local member for signing.
 */
interface MailboxPollTarget {
  /**
   * Subject habitat whose endpoint roles choose remote mailbox targets.
   */
  hab: Hab;
  /**
   * Subject AID requested in the mailbox query.
   */
  targetPre: string;
  /**
   * Local signing habitat; may differ from the group subject.
   */
  signerHab: Hab;
}

/**
 * Build a signed legacy embed or v2 nested `/fwd` envelope for one complete message.
 *
 * The caller is responsible for any surrounding introduction or end-role
 * material that should travel with the forwarded request.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param args Final recipient, mailbox topic and exactly one complete signed source message.
 * @returns Signed /fwd wire; v2 binds one nested child body, legacy uses pathed embeds.
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
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param recipient Final mailbox recipient AID.
 * @param topic Protocol mailbox topic; leading slash is normalized where required.
 * @param message Original complete signed payload.
 * @returns Provider-stored wire selected by the existing reply/replay topic policy.
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
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param remote Remote endpoint AID whose receipt history determines whether introduction is needed.
 * @returns Reopenable introduction iterable.
 */
export function introductionMessages(
  hab: Hab,
  remote: string,
): Iterable<Uint8Array> {
  const endpoints = hab.replyEndRoleMessages(hab.pre);
  return {
    /**
     * Reopen introduction messages when a caller consumes them.
     *
     * @returns A fresh local replay iterator over the captured introduction selection.
     */
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

/**
 * Collect the introduction required by the existing finite query/forwarding path.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param remote Remote endpoint AID whose receipt history determines whether introduction is needed.
 * @returns Collected introduction bytes, possibly empty.
 */
export function introduce(hab: Hab, remote: string): Uint8Array {
  return concatBytes(...introductionMessages(hab, remote));
}

/**
 * Check known receipts before adding a redundant introduction.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param remote Remote attester AID to seek in receipt evidence.
 * @param said Latest event SAID used for the receipt lookup.
 * @returns Whether stored receipt evidence names the remote attester.
 */
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

/**
 * Derive the default mailbox topic from the first non-empty route segment.
 *
 * @param route Exchange route whose first nonempty segment chooses the mailbox topic.
 * @returns Derived topic under the existing route mapping.
 */
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

/**
 * KERIpy pollers query protocol mailbox topics with a leading slash.
 *
 * @param topic Protocol mailbox topic; leading slash is normalized where required.
 * @returns Slash-prefixed query topic.
 */
function pollMailboxTopic(topic: string): string {
  if (topic.length === 0 || topic.startsWith("/")) {
    return topic;
  }
  return `/${topic}`;
}

/**
 * KERIpy `/fwd` modifiers use the bare topic name, e.g. `multisig`.
 *
 * @param topic Protocol mailbox topic; leading slash is normalized where required.
 * @returns Bare /fwd modifier topic.
 */
function transportMailboxTopic(topic: string): string {
  return topic.replace(/^\/+/, "");
}

/**
 * Public helper for deriving mailbox topic defaults from one EXN route.
 *
 * This stays exported because CLI and runtime call sites both need one shared
 * answer for "which mailbox topic should this route land in by default?"
 *
 * @param route Exchange route whose first nonempty segment chooses the mailbox topic.
 * @returns Derived topic under the existing route mapping.
 */
export function mailboxTopicForRoute(route: string): string {
  return pollMailboxTopic(defaultTopicForRoute(route));
}

/**
 * Reconstruct legacy forwarded wire without assigning outer attachments to the child.
 *
 * @param serder Legacy forwarding exchange containing an e.evt body.
 * @param attachments Pathed attachments; only /e/evt material belongs to the embedded message.
 * @returns Reconstructed child wire, or null without an embedded event.
 */
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

/**
 * Serialize one legacy embedded body according to its declared protocol.
 *
 * @param sad Embedded self-addressing data; version prefix selects ACDC versus KERI serialization.
 * @returns Serialized embedded body bytes; caller owns attachment reconstruction.
 */
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
 *
 * @param raw One qualified pathed attachment group in text-domain bytes.
 * @param path Exact embedded SAD path to match.
 * @returns Attachment bytes after the matching pather, or null for a different/empty group.
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

/** Mailbox polling windows in milliseconds; the poller floors positive overrides with a 1 ms minimum. */
export interface MailboxPollingTimeoutPolicy {
  /** Abort the HTTP request when no response headers arrive before this deadline. */
  requestOpenTimeoutMs: number;
  /** Stop reading one mailbox SSE response after this long-poll window. */
  maxPollDurationMs: number;
}

/** One remote mailbox batch, consumed before its provider cursor advances. */
export interface MailboxPollBatch {
  /**
   * Mailbox subject AID, possibly distinct from the signing member.
   */
  pre: string;
  /**
   * Mailbox provider AID that supplied this batch; distinct from the subject and query signer.
   */
  eid: string;
  /**
   * Complete wire messages passed to the awaited batch consumer in order.
   */
  messages: Uint8Array[];
}

/**
 * Per-attempt header and SSE window settings in milliseconds.
 */
export interface MailboxFetchTimeoutPolicy {
  /**
   * Header acquisition deadline in milliseconds.
   */
  requestOpenTimeoutMs: number;
  /**
   * Absolute SSE read window in milliseconds.
   */
  maxReadDurationMs: number;
  /**
   * Idle read deadline after a complete event, in milliseconds.
   */
  readIdleTimeoutMs: number;
}

/**
 * Query one endpoint and consume complete SSE events within one request scope.
 * Header timeout or non-success status ends this attempt without events. Successful
 * body processing and its cleanup finish before the endpoint worker begins another poll.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param targetPre Mailbox subject AID; may be a group distinct from hab.
 * @param src Remote mailbox attester AID.
 * @param url Selected HTTP(S) polling endpoint.
 * @param topics Next-wanted ordinals by topic.
 * @param bodyMode CESR attachment placement for the signed query.
 * @param timeouts Header, absolute read and idle windows in milliseconds.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param consume Awaited complete-event consumer; false stops the poll and errors propagate before remote cursor advancement.
 */
function* fetchMailboxMessages(
  hab: Hab,
  targetPre: string,
  src: string,
  url: string,
  topics: Record<string, number>,
  bodyMode: "header" | "body",
  timeouts: MailboxFetchTimeoutPolicy,
  http: HttpClient,
  clock: RuntimeClock,
  consume: (message: MailboxSseMessage) => Operation<boolean | void>,
): Operation<void> {
  // One poll window owns its headers, optional body consumption and final cleanup.
  yield* scoped(function*() {
    const query = hab.query(targetPre, src, { route: "mbx", q: { topics } });
    const handle = yield* fetchMailboxQueryResponse(
      url,
      query,
      bodyMode,
      src,
      timeouts.requestOpenTimeoutMs,
      http,
      clock,
    );
    if (!handle) {
      return;
    }
    const { response, controller } = handle;

    if (!response.ok) {
      return;
    }

    yield* consumeMailboxSse(response, controller, consume, clock, {
      idleTimeoutMs: timeouts.readIdleTimeoutMs,
      maxDurationMs: timeouts.maxReadDurationMs,
    });
  });
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
 *
 * @param url HTTP(S) mailbox endpoint.
 * @param query Complete signed mbx query bytes.
 * @param bodyMode CESR attachment placement.
 * @param destination Remote mailbox endpoint AID carried in framing.
 * @param timeoutMs Response-header acquisition window in milliseconds.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @returns Borrowed scoped response and its cancellation controller, or null on owned header timeout.
 */
function* fetchMailboxQueryResponse(
  url: string,
  query: Uint8Array,
  bodyMode: "header" | "body",
  destination: string,
  timeoutMs: number,
  http: HttpClient,
  clock: RuntimeClock,
): Operation<
  {
    response: HttpStreamResponse;
    controller: AbortController;
  } | null
> {
  const request = buildCesrRequest(query, {
    bodyMode,
    destination,
  });
  const controller = new AbortController();
  const response = yield* requestWithHeaderTimeout(http, clock, url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: controller.signal,
  }, timeoutMs);
  return response ? { response, controller } : null;
}

/**
 * Normalize the caller's polling policy against the existing defaults.
 *
 * @param overrides Optional timeout values; missing/nonpositive/nonfinite values use defaults.
 * @returns Frozen header/poll settings with finite positive inputs floored and clamped to at least 1 ms.
 */
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

/**
 * Translate poller windows into the concrete request/SSE settings.
 *
 * @param timeouts Normalized poller policy.
 * @returns Per-attempt windows with the fixed 500 ms read-idle interval.
 */
function mailboxFetchTimeoutPolicy(
  timeouts: Readonly<MailboxPollingTimeoutPolicy>,
): MailboxFetchTimeoutPolicy {
  return {
    requestOpenTimeoutMs: timeouts.requestOpenTimeoutMs,
    maxReadDurationMs: timeouts.maxPollDurationMs,
    readIdleTimeoutMs: MailboxPoller.ReadIdleTimeoutMs,
  };
}

/**
 * Normalize a polling duration without turning a positive override into a zero-length window.
 *
 * @param value Optional proposed duration in milliseconds.
 * @param fallback Default used for missing, nonfinite or nonpositive input.
 * @returns Finite positive input floored with a 1 ms minimum; otherwise fallback.
 */
function positiveTimeoutMs(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}
