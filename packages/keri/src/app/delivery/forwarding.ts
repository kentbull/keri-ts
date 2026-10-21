/** Queued signed-message publication. Poster owns transport attempts and their concrete outcomes. */
import {
  attachmentPayload,
  collectPayload,
  concatBytes,
  Diger,
  framePayload,
  MtrDex,
  parseBytes,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { Deck } from "../../core/deck.ts";
import { ValidationError } from "../../core/errors.ts";
import { exchange } from "../../core/exchange/protocol-exchanging.ts";
import { Roles } from "../../core/roles.ts";
import type { Mailboxer } from "../../db/mailbox/mailboxing.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { mailboxTopicKey, preferredUrl } from "../mailbox/mailboxing.ts";
import { transportMailboxTopic } from "../mailbox/topic-routing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { abortable } from "../runtime/abortable.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { runtimeTurn } from "../runtime/runtime-turn.ts";
import { CesrHttpRefusal } from "../transport/cesr-egress.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { messengerFrom, type MessengerUrls, streamMessengerFrom } from "../transport/messengering.ts";
import { TCPMessenger } from "../transport/tcp-messenger.ts";
import { TransportError } from "../transport/transport-error.ts";
import { introduce } from "./introducing.ts";

/** Prepared signed source; Poster copies its bytes before publishing an ordinary admission. */
export interface PosterMsg {
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
   * Request same-socket TCP reply processing; requires a protocol processor.
   */
  readonly replies?: boolean;
}

/** One finite stream whose endpoint selection is shared by every constituent message. */
export interface PosterStream extends Omit<PosterMsg, "msg"> {
  /** Complete signed source messages, copied into one finite stream before publication. */
  readonly msgs: readonly Uint8Array[];
}

/** Concrete queued operation identity, shared by execution and its optional completion waiter. */
export interface PosterEvent extends PosterMsg {
  /** Ordinary traversal or first-present-role stream delivery, selected by the producer operation. */
  readonly kin: "msg" | "stream";
}

/** Optional terminal observation of one concrete delivery attempt, not remote acceptance. */
export type PosterOutcome =
  | {
    /** Terminal local attempt result; neither variant proves remote protocol acceptance. */
    kin: "sent";
    /** Exact admitted event identity matched by wait(evt), including repeated same-SAID sends. */
    evt: PosterEvent;
    /** Successful network URLs or local-mailbox:<eid> publications, including partial success. */
    deliveries: string[];
  }
  | {
    /** Terminal local attempt result; neither variant proves remote protocol acceptance. */
    kin: "failed";
    /** Exact admitted event identity matched by wait(evt), including repeated same-SAID sends. */
    evt: PosterEvent;
    /** Successful network URLs or local-mailbox:<eid> publications, including partial success. */
    deliveries: string[];
    /** Observed failure with original status/cause, including any aggregated target failures. */
    error: unknown;
  };

/** Recipient policy captured synchronously from current accepted routing state for one attempt. */
interface RawCesrRoute {
  /**
   * Direct source transmission or forwarding through a provider.
   */
  readonly kind: "forward" | "direct";
  /**
   * Ordered endpoint AIDs and URLs; null preserves a missing/unsupported location for execution failure.
   */
  readonly targets: readonly { eid: string; url: string | null; urls: MessengerUrls }[];
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
    /** Resolved transport map retains advertised schemes for concrete construction. */
    readonly urls: MessengerUrls;
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
    /** Resolved transport map retains advertised schemes for concrete construction. */
    readonly urls: MessengerUrls;
    /** Endpoint AID, which may be a mailbox intermediary rather than the final recipient. */
    readonly destination: string;
    /** Prepared introduction/forwarding wire borrowed until this transport operation joins cleanup. */
    readonly message: Uint8Array;
  };

/**
 * Preserve resolved endpoint schemes and signed bytes for concrete transport construction.
 *
 * @param endpoint Selected endpoint AID and concrete URL.
 * @param message Prepared bytes borrowed until transport cleanup completes.
 * @returns A TCP or HTTP target according to the endpoint URL scheme.
 */
function remoteCesrTarget(
  endpoint: { eid: string; url: string; urls: MessengerUrls },
  message: Uint8Array,
): PreparedCesrTarget {
  const base = { url: endpoint.url, urls: endpoint.urls, destination: endpoint.eid, message };
  return new URL(endpoint.url).protocol === "tcp:" ? { ...base, kind: "tcp" } : { ...base, kind: "http" };
}

/**
 * Deliver queued signed messages using KERIpy's ordinary Poster role traversal.
 *
 * Send to every controller and agent endpoint, then one mailbox (or provider-local
 * storage). Only recipients without those roles use one witness. Transport
 * completion and opt-in outcomes do not prove remote protocol acceptance. Finite
 * stream admissions use the first present role through the same execution owner.
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
  send(evt: PosterMsg, { notify = false }: { notify?: boolean } = {}): PosterEvent {
    return this.admit(evt, "msg", notify);
  }

  /**
   * Admit a complete finite stream using KERIpy StreamPoster's first-present-role selection.
   * All messages share one selected direct-endpoint set or one relay for the attempt.
   *
   * @param stream Signed source messages in production order; no iterator survives admission.
   * @param options Set notify to request the same concrete-event completion contract as send.
   * @returns Copied queued stream identity; admission does not establish delivery.
   */
  sendStream({ msgs, ...evt }: PosterStream, { notify = false }: { notify?: boolean } = {}): PosterEvent {
    return this.admit({ ...evt, msg: concatBytes(...msgs) }, "stream", notify);
  }

  /**
   * Copy one source and atomically publish its concrete operation.
   * @param evt Resolved producer record; source bytes remain caller-owned until copied.
   * @param kin Real ordinary or finite-stream operation, not a user routing preference.
   * @param notify Whether this admission needs one terminal observation.
   * @returns New identity owned by the runnable queue.
   */
  private admit(evt: PosterMsg, kin: PosterEvent["kin"], notify: boolean): PosterEvent {
    this.ensureOpen();
    if (evt.replies && !this.protocol) throw new Error("TCP reply delivery requires a protocol processor");
    const admitted = { ...evt, kin, msg: evt.msg.slice() };
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
  sendAll(evts: Iterable<PosterMsg>): void {
    this.ensureOpen();
    const pending: PosterEvent[] = [];
    for (const evt of evts) {
      if (evt.replies && !this.protocol) throw new Error("TCP reply delivery requires a protocol processor");
      pending.push({ ...evt, kin: "msg", msg: evt.msg.slice() });
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
      const abandoned = this.takeOutcome(evt);
      if (abandoned) this.publishOutcome(abandoned);
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

  /** Runnable and active work determine convergence; consumable observations do not. */
  get hasPending(): boolean {
    return this.processing || !this.evts.empty;
  }

  /** Reject new production before a closed output owner can consume its source. */
  ensureOpen(): void {
    if (this.closed) throw new Error("Poster is closed");
  }

  /** Abort/join active I/O, report unconsumed failures, then release process-local work. */
  *close(): Operation<void> {
    // Stop admission first, then abort/join before forgetting process-local work.
    this.closed = true;
    this.active?.abort();
    if (this.joined) yield* call(() => this.joined!);
    this.evts.clear();
    this.notifications.clear();
    while (!this.cues.empty) this.publishOutcome(this.cues.pull()!);
  }

  /** Deliver the current FIFO contents; recognized refusals publish failure and allow later work. */
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
          // Remove runnable work and expose its outcome before propagating an unexpected fault.
          self.evts.pull();
          self.publishOutcome({ kin: "failed", evt, deliveries, error });
          throw error;
        }
        self.evts.pull();
        self.publishOutcome(outcome);
      }
    });
  }

  /**
   * Publish an opted-in terminal outcome or report an unobserved failure once.
   * This owner retains no recovery history. Cancellation and close return abandoned
   * observations here after removing their notification, so failed work stays visible.
   *
   * @param outcome Completed attempt, including source identity, original cause and partial delivery.
   */
  private publishOutcome(outcome: PosterOutcome): void {
    if (this.notifications.delete(outcome.evt)) {
      this.cues.push(outcome);
    } else if (outcome.kin === "failed") {
      // Report routing context and the original error, never the signed source bytes.
      const { src, dest, topic } = outcome.evt;
      console.error("CESR delivery failed", { src, dest, topic, deliveries: outcome.deliveries }, outcome.error);
    }
  }

  /**
   * Resolve and execute one event using sequential current endpoints.
   * Observed HTTP refusal and TransportError permit remaining targets to run.
   * Unexpected construction/parser/storage/cleanup errors propagate so process can
   * publish or report the failed outcome before exposing the error.
   *
   * @param evt Concrete source-message record; completion/failure lookup uses object identity, not message SAID.
   * @param deliveries Mutable accumulator of successfully delivered target URLs, retained even if a later target throws.
   * @param signal Active Poster pass cancellation; forwarded into each messenger attempt.
   * @returns Sent if every target completes; otherwise a failure with partial successes.
   */
  private *deliverEvent(evt: PosterEvent, deliveries: string[], signal: AbortSignal): Operation<PosterOutcome> {
    const hab = this.hby.habs.get(evt.src);
    if (!hab) throw new Error(`Unknown local sender ${evt.src}`);
    const routes = this.findBytesRoutes(hab, evt.dest, evt.topic, evt.kin);
    if (!routes.length) {
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
      for (const route of routes) {
        for (const endpoint of route.targets) {
          if (!endpoint.url) {
            failed.push(new ValidationError(`No supported endpoint URL for ${endpoint.eid}.`));
            continue;
          }
          const target = yield* this.prepareBytesTarget(hab, route, {
            eid: endpoint.eid,
            url: endpoint.url,
            urls: endpoint.urls,
          }, evt);
          try {
            if (target.kind !== "stored") {
              const refusal = yield* this.sendPreparedTarget(target, evt, signal);
              if (refusal) {
                failed.push(refusal);
                continue;
              }
            }
          } catch (error) {
            if (!(error instanceof TransportError)) throw error;
            failed.push(error);
            continue;
          }
          deliveries.push(endpoint.url);
        }
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

  /** Execute one prepared target, adapting completed HTTP refusal to this owner's fanout outcome. */
  private *sendPreparedTarget(
    target: Exclude<PreparedCesrTarget, { kind: "stored" }>,
    evt: PosterEvent,
    signal: AbortSignal,
  ): Operation<CesrHttpRefusal | undefined> {
    if (target.kind === "tcp" && evt.replies) {
      // Explicit duplex work retains its receive owner; send-only factories need none.
      yield* new TCPMessenger(target.url, this.clock, this.protocol).send(target.message, {
        signal,
        replies: true,
      });
      return;
    }
    if (evt.kin === "stream") {
      const response = yield* streamMessengerFrom(
        target.destination,
        target.urls,
        target.message,
        this.http,
        this.clock,
      ).send({ signal });
      if (response && !response.ok) {
        return new CesrHttpRefusal(
          `CESR delivery to ${target.url} failed with HTTP ${response.status}: ${
            new TextDecoder().decode(response.body)
          }`,
          response.status,
        );
      }
      return;
    }
    const outcome = yield* messengerFrom(
      target.destination,
      target.urls,
      this.http,
      this.clock,
    ).send(target.message, { signal });
    if (outcome && outcome.kind === "refuse") return outcome.error;
  }

  /**
   * Snapshot ordinary Poster's current role traversal without network execution.
   *
   * Controller and agent roles each retain all endpoints. An indirect role picks
   * one random provider, unless an explicitly composed store owns an eligible local
   * AID. Empty location maps retain role selection and become execution failures.
   *
   * @param hab Local signing habitat borrowing accepted role/location state.
   * @param recipient Resolved final recipient AID.
   * @param topic Recipient mailbox topic; indirect routes require a nonempty topic.
   * @param kin Ordinary messages traverse all primary roles; streams retain the first present role.
   * @returns Ordered role groups; no eligible role returns an empty array.
   */
  private findBytesRoutes(hab: Hab, recipient: string, topic: string, kin: PosterEvent["kin"] = "msg"): RawCesrRoute[] {
    const ends = hab.endsFor(recipient);
    const roles: string[] = [Roles.controller, Roles.agent, Roles.mailbox].filter((role) =>
      Object.keys(ends[role] ?? {}).length
    );
    if (!roles.length && Object.keys(ends[Roles.witness] ?? {}).length) roles.push(Roles.witness);
    if (kin === "stream") roles.splice(1);
    return roles.map((role) => {
      const candidates = Object.entries(ends[role]);
      if (role === Roles.controller || role === Roles.agent) {
        return {
          kind: "direct",
          targets: candidates.map(([eid, urls]) => ({ eid, url: preferredUrl(urls), urls })),
        };
      }
      if (!topic) throw new ValidationError(`Forwarded delivery requires an explicit topic for ${recipient}.`);
      // A provider store may belong to another local AID, not just the sender.
      const local = this.mbx && candidates.find(([eid]) => this.hby.db.prefixes.has(eid));
      if (local) return { kind: "forward", targets: [{ eid: local[0], url: `local-mailbox:${local[0]}`, urls: {} }] };
      const [eid, urls] = candidates[Math.floor(Math.random() * candidates.length)];
      return {
        kind: "forward",
        targets: [{ eid, url: preferredUrl(urls), urls }],
      };
    });
  }

  /**
   * Prepare a target using the supplied wire and selected endpoint.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param route Selected direct or forwarded endpoint group.
   * @param endpoint One selected endpoint AID and URL from the route.
   * @param evt Original signed source and concrete ordinary/stream operation.
   * @returns A prepared remote target, or stored after authorized local mailbox publication.
   */
  private *prepareBytesTarget(
    hab: Hab,
    route: RawCesrRoute,
    endpoint: { eid: string; url: string; urls: MessengerUrls },
    evt: PosterEvent,
  ): Operation<PreparedCesrTarget> {
    if (route.kind !== "direct") {
      return yield* this.prepareForwardedTarget(hab, evt.dest, evt.topic, evt, endpoint);
    }
    return remoteCesrTarget(endpoint, evt.msg);
  }

  /**
   * Prepare complete signed wire and its introduction before opening transport.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param recipient Final recipient AID, distinct from the intermediary endpoint.
   * @param topic Recipient mailbox topic used by the forwarding envelope.
   * @param evt Original signed source and operation; outer envelopes may be rebuilt.
   * @param endpoint Mailbox/witness endpoint selected for this attempt.
   * @returns Stored for a local endpoint, or signed forwarding wire with its introduction.
   */
  private *prepareForwardedTarget(
    hab: Hab,
    recipient: string,
    topic: string,
    evt: PosterEvent,
    endpoint: { eid: string; url: string; urls: MessengerUrls },
  ): Operation<PreparedCesrTarget> {
    if (this.mbx && this.hby.db.prefixes.has(endpoint.eid)) {
      const stored = this.mbx.storeMsg(
        mailboxTopicKey(recipient, topic),
        mailboxReplyPayload(hab, recipient, topic, evt.msg),
      );
      if (!stored) throw new Error("Mailbox publication did not complete");
      return { kind: "stored" };
    }
    const msgs: Uint8Array[] = [];
    if (evt.kin === "stream") {
      // Prepare every frame before opening the one selected relay attempt.
      for (const frame of parseBytes(evt.msg)) {
        msgs.push(yield* abortable((signal) => collectPayload(framePayload(frame), signal)));
      }
    } else {
      msgs.push(evt.msg);
    }
    const forwarded: Uint8Array[] = [];
    for (const message of msgs) forwarded.push(yield* buildForwardedDelivery(hab, { recipient, topic, message }));
    const intro = introduce(hab, endpoint.eid);
    let message = concatBytes(intro, ...forwarded);
    if (evt.kin === "stream") {
      const frames = parseBytes(message);
      if (frames.some(frame => (frame.gvrsn?.major ?? 1) >= 2)) {
        // A v2 peer's default cannot interpret unqualified v1 introduction counters.
        // Declare each prepared frame's actual genus without changing signed bodies.
        // Entirely legacy streams retain their v1-peer-compatible unqualified wire.
        const qualified: Uint8Array[] = [];
        for (const frame of frames) {
          qualified.push(yield* abortable(signal => collectPayload(framePayload(frame), signal)));
        }
        message = concatBytes(...qualified);
      }
    }
    return remoteCesrTarget(endpoint, message);
  }
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
