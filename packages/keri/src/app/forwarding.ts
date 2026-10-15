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
import {
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  nestedPayload,
  parsePather,
  ResourceAdmissionError,
  ResourceLimitError,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, resource, spawn, type Task } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import type { Kever } from "../core/kever.ts";
import { CREDENTIAL_MAILBOX_TOPIC, DELEGATE_MAILBOX_TOPIC, OOBI_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { Roles } from "../core/roles.ts";
import { dgKey } from "../db/core/keys.ts";
import { MAX_NESTED_WIRE_BYTES } from "../db/exchange-nests.ts";
import {
  DEFAULT_MAILBOX_INBOX_LIMITS,
  MailboxAdmissionError,
  type MailboxDelivery,
  type MailboxInboxLimits,
} from "../db/mailbox-inbox.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import type { OutboxerLike, PendingOutboxEntry } from "../db/outboxing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { abortable } from "./abortable.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { chunkBytes } from "./byte-source.ts";
import { attemptPostCesr, CesrHttpRefusal, postCesr } from "./cesr-egress.ts";
import { buildCesrRequest, type CesrBodyMode } from "./cesr-http.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandleOrNull } from "./httping.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { consumeMailboxSse, type MailboxSseMessage } from "./mailbox-sse.ts";
import {
  directDeliveryEndpoints,
  firstSortedEndpoint,
  getOutboxer,
  mailboxDeliveryEndpoints,
  mailboxPollEndpoints,
  mailboxTopicKey,
} from "./mailboxing.ts";
import type { OobiReplyLimits } from "./oobi-replies.ts";
import { Organizer } from "./organizing.ts";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { attemptSendCesrTcp, sendCesrTcp } from "./tcp-egress.ts";

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

/** Deliver prepared wire; explicit runtime lends same-socket intake, otherwise TCP drains output only. */
export function* sendPreparedCesrTarget(
  target: PreparedCesrTarget,
  services: RuntimeServices,
  signal?: AbortSignal,
  runtime?: AgentRuntime,
): Operation<void> {
  if (target.kind === "tcp") {
    if (runtime) {
      yield* sendCesrTcp(target.url, target.message, {
        services,
        signal,
        replies: { runtime, local: true },
      });
    } else yield* sendCesrTcp(target.url, target.message, { services, signal });
  } else if (target.kind === "http") {
    yield* postCesrMessage(
      target.url,
      target.message,
      target.bodyMode,
      target.destination,
      services,
      signal,
    );
  }
}

/** Preserve selected endpoint and signed bytes; TCP has no HTTP body framing mode. */
function remoteCesrTarget(
  endpoint: { eid: string; url: string },
  message: Uint8Array,
  bodyMode: CesrBodyMode,
): PreparedCesrTarget {
  const base = { url: endpoint.url, destination: endpoint.eid, message };
  return new URL(endpoint.url).protocol === "tcp:" ? { ...base, kind: "tcp" } : { ...base, kind: "http", bodyMode };
}

/** Join a prepared target attempt; local completion/refusal/busy never implies protocol acceptance. */
export function* attemptPreparedCesrTarget(
  target: PreparedCesrTarget,
  services: RuntimeServices,
  signal?: AbortSignal,
  runtime?: AgentRuntime,
): Operation<"complete" | "refused" | "busy"> {
  if (target.kind === "http") {
    const result = yield* attemptPostCesr(target.url, (signal) => chunkBytes(target.message, { signal }), {
      bodyMode: target.bodyMode,
      destination: target.destination,
      services,
      signal,
    });
    signal?.throwIfAborted();
    if (result.kind === "complete") return "complete";
    if (result.error instanceof CesrHttpRefusal) return "refused";
    if (result.error.reason === "busy") return "busy";
    throw result.error;
  }
  if (target.kind === "stored") {
    signal?.throwIfAborted();
    return "complete";
  }
  const result = yield* attemptSendCesrTcp(target.url, target.message, {
    services,
    signal,
    ...(runtime ? { replies: { runtime, local: true } } : {}),
  });
  signal?.throwIfAborted();
  if (result.kind !== "refuse") return "complete";
  if (result.error.reason === "busy") return "busy";
  throw result.error;
}

interface PosterOptions {
  mailboxer?: Mailboxer | null;
  outboxer?: OutboxerLike;
  services?: RuntimeServices;
}

interface MailboxPollerOptions {
  mailboxAdmission?: { mode: "durable"; limits?: Partial<MailboxInboxLimits> };
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
   * - optional runtime lends same-socket TCP intake; standalone TCP is transmit-only
   * - public callers own synchronous route/signing preparation and wire retention
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
    runtime?: AgentRuntime,
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
            runtime,
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
        yield* sendPreparedCesrTarget(
          remoteCesrTarget(endpoint, message, this.hby.cesrBodyMode),
          this.services,
          undefined,
          runtime,
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
          runtime,
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
   * Optional runtime lends TCP intake; caller owns preparation/retention before transport.
   */
  *sendBytes(
    hab: Hab,
    args: {
      recipient: string;
      message: Uint8Array;
      topic?: string;
      delivery?: ExchangeDeliveryPreference;
    },
    runtime?: AgentRuntime,
  ): Operation<RawCesrSendResult> {
    const route = this.resolveBytesRoute(hab, args);
    const deliveries: string[] = [];
    const queued: string[] = [];
    const failed = new Map<string, string>();
    for (let index = 0; index < route.targets.length; index++) {
      const endpoint = route.targets[index]!;
      try {
        const target = this.prepareBytesTarget(hab, route, index, args.message);
        yield* sendPreparedCesrTarget(target, this.services, undefined, runtime);
        deliveries.push(endpoint.url);
      } catch (error) {
        if (route.kind !== "mailbox") throw error;
        failed.set(endpoint.eid, error instanceof Error ? error.message : String(error));
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
            recipient: route.recipient,
            topic: route.topic,
            createdAt: makeNowIso8601(),
          },
          failed.keys(),
        );
        const attemptedAt = makeNowIso8601();
        for (const [eid, error] of failed) {
          this.outboxer.markFailed(said, eid, attemptedAt, error);
          queued.push(`outbox:${eid}`);
        }
      } else if (deliveries.length === 0) {
        throw new ValidationError(
          `CESR delivery failed for ${route.recipient}: ${[...failed.values()].join("; ")}`,
        );
      }
    }
    return { deliveries, queued };
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
      delivery !== "direct" && topic && this.mailboxer && this.hby.db.prefixes.has(hab.pre)
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

  /** Guarded preparation; an explicit finite cap copies direct wire for independently credited retention. */
  prepareBytesTarget(
    hab: Hab,
    route: RawCesrRoute,
    index: number,
    message: Uint8Array,
    maxBytes?: number,
  ): PreparedCesrTarget {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
      throw new RangeError("Invalid cue target byte limit");
    }
    if (maxBytes !== undefined && message.buffer.byteLength > maxBytes) {
      throw new ResourceLimitError("Cue target backing exceeds limit");
    }
    if (hab.pre !== route.sender) throw new Error("CESR route belongs to another sender");
    const endpoint = route.targets[index];
    if (!Number.isSafeInteger(index) || !endpoint) throw new RangeError("Invalid CESR delivery target");
    if (route.kind !== "direct") {
      const forwarded = this.prepareForwardedTarget(hab, route.recipient, route.topic, message, endpoint, maxBytes);
      return forwarded.kind === "http" ? { ...forwarded, bodyMode: route.bodyMode } : forwarded;
    }
    return remoteCesrTarget(endpoint, maxBytes === undefined ? message : message.slice(), route.bodyMode);
  }

  /**
   * Retry any pending mailbox-target deliveries using current recipient state.
   *
   * Retry behavior is per mailbox endpoint, not per logical message. A removed
   * mailbox cancels only that endpoint's target row. Runtime route/signing and
   * outcome publication use short turns; transport cleanup joins outside the guard.
   * Runtime scans require pre-copy bounded reads and retain admitted copies through joined cleanup.
   * Standalone/custom iteration retains its caller-owned preparation and retention contract.
   */
  processPending(runtime?: AgentRuntime): Operation<void> {
    if (runtime && runtime.hby !== this.hby) throw new RangeError("Poster retry requires its owning Habery runtime");
    // deno-lint-ignore no-this-alias -- One retry pass owns transport cleanup before guarded publication.
    const self = this;
    return call(function*() {
      if (runtime && !self.outboxer.enabled) return;
      const limits = { maxMessageBytes: DEFAULT_FORWARD_BYTES, maxMetadataBytes: 65536 };
      if (runtime && self.outboxer.enabled && !self.outboxer.iterPendingBounded) {
        throw new RangeError("Runtime outbox retries require bounded reads from the custom store");
      }
      // Four payload copies (including pull overlap), retained wire plus three preparation copies, metadata/key work.
      // Register credit first: nested transport and cursor cleanup join before this owner releases.
      let busy = false;
      yield* resource<void>(function*(provide) {
        const credit = runtime && self.outboxer.enabled
          ? runtime.resources.reserve({ bytes: 8 * limits.maxMessageBytes + 8 * limits.maxMetadataBytes + 131072 })
          : undefined;
        if (credit?.kind === "refuse") {
          if (credit.reason === "busy") busy = true;
          else throw new ResourceAdmissionError("Outbox read/copy admission exceeds shared capacity", credit.reason);
        }
        try {
          yield* provide();
        } finally {
          if (credit?.kind === "reserve") credit.reservation.release();
        }
      });
      if (busy) return;
      let iterator: Generator<PendingOutboxEntry> | undefined;
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          const close = function*() {
            iterator?.return(undefined);
          };
          if (runtime) yield* runtime.reactor.settle(undefined, {}, close);
          else yield* close();
        }
      });
      while (true) {
        let next: IteratorResult<PendingOutboxEntry> | undefined;
        const pull = function*() {
          iterator ??= runtime && self.outboxer.enabled
            ? self.outboxer.iterPendingBounded!(limits)
            : self.outboxer.iterPending();
          next = iterator.next();
        };
        if (runtime) yield* runtime.reactor.settle(undefined, {}, pull);
        else yield* pull();
        if (next!.done) break;
        const pending = next!.value;
        const state: { target?: PreparedCesrTarget; failure?: { error: unknown } } = {};
        const prepare = function*() {
          const hab = self.hby.habs.get(pending.message.sender);
          if (!hab) {
            self.outboxer.cancelTarget(
              pending.said,
              pending.target.eid,
              makeNowIso8601(),
              "sender habitat is unavailable",
            );
            return;
          }
          const endpoint = mailboxDeliveryEndpoints(hab, pending.message.recipient)
            .find((current) => current.eid === pending.target.eid);
          if (!endpoint) {
            self.outboxer.cancelTarget(pending.said, pending.target.eid, makeNowIso8601(), "mailbox removed");
            return;
          }
          try {
            state.target = self.prepareForwardedTarget(
              hab,
              pending.message.recipient,
              pending.message.topic,
              pending.raw,
              endpoint,
            );
          } catch (error) {
            state.failure = { error };
          }
        };
        if (runtime) yield* runtime.reactor.settle(undefined, {}, prepare);
        else yield* prepare();
        if (!state.target && !state.failure) continue;
        if (state.target) {
          try {
            yield* call(() =>
              sendPreparedCesrTarget(
                state.target!,
                self.services,
                undefined,
                runtime,
              )
            );
          } catch (error) {
            state.failure = { error };
          }
        }
        const publish = function*() {
          try {
            if (state.failure) throw state.failure.error;
            self.outboxer.markDelivered(pending.said, pending.target.eid, makeNowIso8601());
          } catch (error) {
            self.outboxer.markFailed(
              pending.said,
              pending.target.eid,
              makeNowIso8601(),
              error instanceof Error ? error.message : String(error),
            );
          }
        };
        if (runtime) yield* runtime.reactor.settle(undefined, {}, publish);
        else yield* publish();
      }
    });
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
    runtime?: AgentRuntime,
  ): Operation<void> {
    yield* this.deliverForwardedTarget(
      hab,
      recipient,
      topic,
      message,
      endpoint,
      runtime,
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
    runtime?: AgentRuntime,
  ): Operation<void> {
    yield* this.deliverForwardedTarget(
      hab,
      recipient,
      topic,
      message,
      endpoint,
      runtime,
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
    runtime?: AgentRuntime,
  ): Operation<void> {
    const target = this.prepareForwardedTarget(hab, recipient, topic, message, endpoint);
    yield* sendPreparedCesrTarget(target, this.services, undefined, runtime);
  }

  /** Local mailbox writes and signed introductions finish before any network work starts. */
  private prepareForwardedTarget(
    hab: Hab,
    recipient: string,
    topic: string,
    message: Uint8Array,
    endpoint: { eid: string; url: string },
    maxBytes = DEFAULT_FORWARD_BYTES,
  ): PreparedCesrTarget {
    if (this.hby.db.prefixes.has(endpoint.eid)) {
      const stored = this.requireMailboxer().storeMsg(
        mailboxTopicKey(recipient, topic),
        mailboxReplyPayload(hab, recipient, topic, message, maxBytes),
      );
      if (!stored) throw new Error("Mailbox publication did not complete");
      return { kind: "stored" };
    }
    const forwarded = buildForwardedDelivery(hab, { recipient, topic, message }, maxBytes);
    const intro = introduce(hab, endpoint.eid, maxBytes - forwarded.length);
    return remoteCesrTarget(endpoint, concatBytes(intro, forwarded), this.hby.cesrBodyMode);
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
      // Mailbox LMDB accepts a finite row; collect one admitted child, never the whole exchange stream.
      return abortable(async (signal) => {
        const wire = await collectPayload(nestedPayload(child, Vrsn_2_0), MAX_NESTED_WIRE_BYTES, signal);
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
  private readonly delivered = new Set<string>();
  readonly inboxLimits: MailboxInboxLimits;
  private readonly durableAdmission: boolean;
  private readonly localCursors = new Map<string, Record<string, number>>();
  /** One bounded command-local resume position; endpoint/habitat metadata stays borrowed. */
  private readonly nextRemotePoll = { target: 0, endpoint: 0 };

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
    if (options.mailboxAdmission && options.mailboxAdmission.mode !== "durable") {
      throw new Error("Unsupported mailbox admission mode");
    }
    this.durableAdmission = options.mailboxAdmission?.mode === "durable";
    this.inboxLimits = { ...DEFAULT_MAILBOX_INBOX_LIMITS, ...options.mailboxAdmission?.limits };
    for (const limit of Object.values(this.inboxLimits)) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new MailboxAdmissionError("invalid-input", "Invalid mailbox inbox limit");
      }
    }
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
    const batches: MailboxPollBatch[] = this.replayRetained();
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

    const targets = this.remotePollTargets();
    if (targets.length === 0) return this.handOff(batches);
    const firstTarget = this.nextRemotePoll.target % targets.length;
    const firstEndpoint = this.nextRemotePoll.endpoint;
    // Wrap to the earlier endpoints of the starting habitat without flattening peer metadata.
    for (let visited = 0; visited <= targets.length; visited++) {
      const targetIndex = (firstTarget + visited) % targets.length;
      const target = targets[targetIndex];
      const remoteEndpoints = mailboxPollEndpoints(this.hby, target.hab);
      if (remoteEndpoints.length === 0) continue;
      const resume = firstEndpoint % remoteEndpoints.length;
      const start = visited === 0 ? resume : 0;
      const end = visited === targets.length ? resume : remoteEndpoints.length;
      for (let endpointIndex = start; endpointIndex < end; endpointIndex++) {
        const remainingBudgetMs = deadline - this.services.clock.now();
        if (remainingBudgetMs <= 0) return this.handOff(batches);
        // Advance before the joined poll, so an empty, failed or cancelled long poll cannot monopolize the next turn.
        const nextEndpoint = endpointIndex + 1;
        this.nextRemotePoll.target = nextEndpoint < remoteEndpoints.length
          ? targetIndex
          : (targetIndex + 1) % targets.length;
        this.nextRemotePoll.endpoint = nextEndpoint < remoteEndpoints.length ? nextEndpoint : 0;
        const batch = yield* this.pollRemoteEndpointOnce(target, remoteEndpoints[endpointIndex], remainingBudgetMs);
        if (batch) batches.push(batch);
      }
    }

    return this.handOff(batches);
  }

  /**
   * Poll forever, streaming typed batches into one sink.
   *
   * Long-lived runtime polling stays callback-based because concurrent remote
   * workers do not have a natural finite return value.
   */
  *pollDo(
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<never> {
    const remoteWorkers = new Map<string, Task<void>>();

    try {
      while (true) {
        for (const batch of this.replayRetained()) {
          yield* call(() => onBatch(batch));
          this.handOff([batch]);
        }
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
    let bytes = 0;

    for (const topic of topics) {
      for (
        const item of this.mailboxDirector.topicIter(
          pre,
          topic,
          cursor[topic] ?? 0,
        )
      ) {
        if (item.msg.length > this.inboxLimits.maxRecordBytes) {
          throw new MailboxAdmissionError("capacity", "Mailbox record byte limit");
        }
        if (
          messages.length === this.inboxLimits.maxBatchRecords
          || item.msg.length > this.inboxLimits.maxBatchBytes - bytes
        ) return messages;
        bytes += item.msg.length;
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
    onBatch?: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<MailboxPollBatch | null> {
    const cursor = this.mailboxDirector.remoteQueryCursor(
      target.targetPre,
      endpoint.eid,
    );
    const messages: MailboxSseMessage[] = [];
    let bytes = 0;
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    yield* this.pollTransport.poll({
      hab: target.signerHab,
      targetPre: target.targetPre,
      endpoint,
      topics: cursor,
      bodyMode: this.hby.cesrBodyMode,
      timeouts: mailboxFetchTimeoutPolicy(this.timeoutPolicy, budgetMs),
      services: this.services,
    }, function*(message) {
      if (message.msg.length > self.inboxLimits.maxRecordBytes) {
        throw new MailboxAdmissionError("capacity", "Mailbox record byte limit");
      }
      if (message.msg.length > self.inboxLimits.maxBatchBytes) {
        throw new MailboxAdmissionError("capacity", "Mailbox batch byte limit");
      }
      if (onBatch) {
        // Await acceptance before asking SSE for another event; durable cursors move with retained bytes.
        if (self.durableAdmission) {
          self.hby.db.mailboxInbox.admit(target.targetPre, endpoint.eid, [message], self.inboxLimits);
          for (const batch of self.replayRetained(target.targetPre, endpoint.eid)) {
            yield* call(() => onBatch(batch));
            self.handOff([batch]);
          }
        } else {
          yield* call(() =>
            onBatch({ source: "remote", pre: target.targetPre, eid: endpoint.eid, messages: [message.msg] })
          );
          self.mailboxDirector.updateRemoteCursor(target.targetPre, endpoint.eid, message.topic, message.idx);
        }
        return;
      }
      // Command-local batches are finite; unread/over-budget events remain at the peer for the next poll.
      if (message.msg.length > self.inboxLimits.maxBatchBytes - bytes) return false;
      bytes += message.msg.length;
      messages.push(message);
      return messages.length < self.inboxLimits.maxBatchRecords;
    });
    if (messages.length === 0) {
      return null;
    }
    if (!this.durableAdmission) {
      for (const message of messages) {
        this.mailboxDirector.updateRemoteCursor(target.targetPre, endpoint.eid, message.topic, message.idx);
      }
      return {
        source: "remote",
        pre: target.targetPre,
        eid: endpoint.eid,
        messages: messages.map((message) => message.msg),
      };
    }
    this.hby.db.mailboxInbox.admit(target.targetPre, endpoint.eid, messages, this.inboxLimits);
    return this.replayRetained(target.targetPre, endpoint.eid)[0] ?? null;
  }

  /** Deliver retained ingress once per poller lifetime; consumers explicitly dispose durable outcomes. */
  private replayRetained(pre?: string, eid?: string): MailboxPollBatch[] {
    if (!this.durableAdmission) return [];
    const topics = new Set(this.mailboxDirector.registeredTopics());
    if (topics.size === 0) return [];
    const retained = this.hby.db.mailboxInbox.pending({ pre, eid, topics, exclude: this.delivered });
    const batches = new Map<string, MailboxPollBatch>();
    for (const { delivery, msg } of retained) {
      if (this.delivered.has(delivery.id) || (pre && delivery.pre !== pre) || (eid && delivery.eid !== eid)) continue;
      const key = JSON.stringify([delivery.pre, delivery.eid]);
      let batch = batches.get(key);
      if (!batch) {
        batch = { source: "remote", pre: delivery.pre, eid: delivery.eid, messages: [], deliveries: [] };
        batches.set(key, batch);
      }
      batch.messages.push(msg);
      batch.deliveries!.push(delivery);
    }
    return [...batches.values()];
  }

  /** Mark successful handoff only, never selection before later network work or a throwing sink. */
  private handOff(batches: MailboxPollBatch[]): MailboxPollBatch[] {
    // Validate/prune before marking new IDs: a corrupt retained row must not lose this handoff.
    if (
      this.delivered.size + batches.reduce((n, batch) => n + (batch.deliveries?.length ?? 0), 0)
        > this.inboxLimits.maxRetainedRecords
    ) {
      const retained = new Set(this.hby.db.mailboxInbox.retained().map((row) => row.id));
      for (const id of this.delivered) if (!retained.has(id)) this.delivered.delete(id);
    }
    const output: MailboxPollBatch[] = [];
    for (const batch of batches) {
      if (!batch.deliveries) {
        output.push(batch);
        continue;
      }
      const messages: Uint8Array[] = [], deliveries: MailboxDelivery[] = [];
      for (const [index, delivery] of batch.deliveries.entries()) {
        if (this.delivered.has(delivery.id)) continue;
        this.delivered.add(delivery.id);
        messages.push(batch.messages[index]);
        deliveries.push(delivery);
      }
      if (messages.length) output.push({ ...batch, messages, deliveries });
    }
    return output;
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
      const batch = yield* this.pollRemoteEndpointOnce(
        target,
        endpoint,
        this.timeoutPolicy.maxPollDurationMs,
        onBatch,
      );
      if (batch) {
        yield* call(() => onBatch(batch));
        this.handOff([batch]);
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
  maxBytes = DEFAULT_FORWARD_BYTES,
): Uint8Array {
  if (args.message.buffer.byteLength > maxBytes) throw new ResourceLimitError("Forwarded payload exceeds byte limit");
  const [serder, attachments] = exchange(
    "/fwd",
    {},
    {
      sender: hab.pre,
      modifiers: { pre: args.recipient, topic: transportMailboxTopic(args.topic) },
      embeds: { evt: args.message },
    },
  );
  const endorsed = hab.endorse(serder, { pipelined: false });
  if (endorsed.length + attachments.length > maxBytes) {
    throw new ResourceLimitError("Cue forwarded wire exceeds limit");
  }
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
  maxBytes = DEFAULT_FORWARD_BYTES,
): Uint8Array {
  if (topic !== "/reply" && topic !== "reply") {
    return message;
  }
  if (message.buffer.byteLength > maxBytes) throw new ResourceLimitError("Mailbox reply exceeds byte limit");
  const introduction = introduce(hab, recipient, maxBytes - message.length);
  return introduction.length === 0 ? message : concatBytes(introduction, message);
}

/** Finite convenience wire ceiling; a local policy rather than a protocol maximum. */
const DEFAULT_FORWARD_BYTES = 8 * 1024 * 1024;

/**
 * Borrow a Hab/store for lazy introduction output, preserving target KEL, oldest
 * delegator first, then endpoint/location replies. Capture begins on iteration.
 * No source is opened when a witness/receipt already makes introduction unnecessary.
 * Native proof/key copies and the large-history transport caller remain separately qualified.
 */
export function introductionMessages(
  hab: Hab,
  remote: string,
  limits: OobiReplyLimits = {},
): Iterable<Uint8Array> {
  const endpoints = hab.replyEndRoleMessages(hab.pre, undefined, [], "", limits);
  const maxDepth = limits.maxDepth ?? 32;
  const maxMessageBytes = limits.maxMessageBytes ?? DEFAULT_FORWARD_BYTES;
  return {
    *[Symbol.iterator]() {
      const kever = hab.kever;
      if (!kever || kever.wits.includes(remote)) return;
      const latestSaid = kever.serder.said;
      if (!latestSaid || remoteAlreadyReceiptedLatestEvent(hab, remote, latestSaid)) return;
      const captured = hab.db.replay(hab.pre, 0, {
        maxDepth,
        maxMessageBytes,
      });
      if (captured) yield* captured;
      yield* endpoints;
    },
  };
}

/**
 * Collect a finite introduction under a configurable 8 MiB default; explicit
 * Infinity is misuse. Admit every message before retention and the final join.
 * Remaining credit may be zero when witness/receipt suppression produces no output.
 * This convenience collector does not establish a shared runtime memory bound.
 */
export function introduce(
  hab: Hab,
  remote: string,
  maxBytes = DEFAULT_FORWARD_BYTES,
  limits: OobiReplyLimits = {},
): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid introduction byte limit");
  const configuredMessageBytes = limits.maxMessageBytes ?? DEFAULT_FORWARD_BYTES;
  if (!Number.isSafeInteger(configuredMessageBytes) || configuredMessageBytes < 1) {
    throw new RangeError("Invalid introduction message limit");
  }
  const configuredMetadataBytes = limits.maxDescriptorBytes ?? configuredMessageBytes;
  if (
    !Number.isSafeInteger(configuredMetadataBytes) || configuredMetadataBytes < 0
    || configuredMetadataBytes > configuredMessageBytes
  ) {
    throw new RangeError("Invalid introduction metadata limit");
  }
  const maxMessageBytes = Math.min(configuredMessageBytes, Math.max(1, maxBytes));
  const maxDescriptorBytes = Math.min(configuredMetadataBytes, maxMessageBytes);
  const messages: Uint8Array[] = [];
  let size = 0;
  for (const bytes of introductionMessages(hab, remote, { ...limits, maxMessageBytes, maxDescriptorBytes })) {
    if (bytes.length > maxBytes - size) throw new ResourceLimitError("Query introduction exceeds byte limit");
    size += bytes.length;
    if (bytes.length) messages.push(bytes);
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
  /** Stable IDs for retained remote bytes; parser return does not acknowledge them. */
  deliveries?: MailboxDelivery[];
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
