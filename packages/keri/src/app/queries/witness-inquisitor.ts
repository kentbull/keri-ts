/**
 * Outbound query selection, signing and transport, corresponding to KERIpy's
 * `agenting.WitnessInquisitor`. Query workflows live in querying.ts; this sender
 * neither decides that a KEL is caught up nor waits for an HTTP protocol reply.
 *
 * `signer` means a locally controlled AID, `pre` is the queried subject and `src`
 * is an explicitly selected remote attester. Resolve/sign just before sending,
 * using accepted endpoint evidence. One worker owns the unsigned request Deck
 * and current network attempt; there is no retained signed retry backlog.
 *
 * With a relay (an edge runtime) every query is addressed and sent to the relay,
 * which is the attester: it answers from its own store through its Respondant
 * and Poster into the edge's mailbox, which it hosts. No query goes to a witness
 * or controller, whatever `src` or `wits` the request names.
 */
import { concatBytes } from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { QueryCue, QueryInstruction, QueryRequest } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import { ValidationError } from "../../core/errors.ts";
import { consoleLogger } from "../../core/logger.ts";
import { Roles } from "../../core/roles.ts";
import { Schemes } from "../../core/schemes.ts";
import { introduce } from "../delivery/introducing.ts";
import { type Relay, relayEndpoint, relayRefusal } from "../delivery/relaying.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { PROTOCOL_TOCK_MS } from "../runtime/doing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { waitOnClock } from "../runtime/workflow-contract.ts";
import { CesrHttpRefusal } from "../transport/cesr-egress.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { HTTPMessenger } from "../transport/http-messenger.ts";
import { requireTcpDialer } from "../transport/tcp-dialer.ts";
import { TransportError } from "../transport/transport-error.ts";

/** First eligible role used by KERIpy WitnessInquisitor before random endpoint selection. */
const QUERY_ROLE_PRIORITY = [Roles.controller, Roles.agent, Roles.witness];

/**
 * Copy only the owned query-body level without erasing its route/payload relationship.
 *
 * @param instruction Typed route and query body; nested values remain borrowed immutable data.
 * @returns A copy of the route/body level preserving its discriminated shape.
 */
function copyQuery(instruction: QueryInstruction): QueryInstruction {
  switch (instruction.route) {
    case "logs":
      return { route: "logs", q: { ...instruction.q } };
    case "ksn":
      return { route: "ksn", q: { ...instruction.q } };
    case "tels":
    case "tsn":
      return { route: instruction.route, q: { ...instruction.q } };
  }
}

/**
 * Identity of one unsigned request for duplicate detection: every field that changes what is signed or where it goes.
 *
 * @param request Queued or candidate request; query filters are strings and string-valued seal SADs.
 * @returns A canonical string equal for two requests exactly when they would produce the same query.
 */
function requestKey(request: QueryRequest): string {
  return JSON.stringify([
    request.route,
    request.pre,
    request.signer ?? null,
    request.src ?? null,
    request.wits ?? null,
    request.q,
  ]);
}

/**
 * Return the sole local habitat when exactly one exists.
 *
 * Honesty rule:
 * - one habitat means runtime may safely use it as an implicit signer
 * - more than one habitat means runtime must not guess
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @returns Only local habitat, or null when selection is ambiguous or absent.
 */
function soleHab(hby: Habery): Hab | null {
  const habitats = hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}

/**
 * The attesters an ordinary (non-relay) query for `pre` may go to: the AIDs of the first role among controller,
 * agent and witness that has any accepted endpoint for the subject. Mailbox providers are not query attesters.
 *
 * @param hab Local habitat whose accepted-state store is read.
 * @param pre Subject AID whose accepted endpoint roles are consulted.
 * @returns Eligible attester AIDs, or an empty array for an unknown subject or a subject with no such endpoint.
 */
export function queryAttesters(hab: Hab, pre: string): string[] {
  if (!hab.db.getKever(pre)) return [];
  const ends = hab.endsFor(pre);
  for (const role of QUERY_ROLE_PRIORITY) {
    const eids = Object.keys(ends[role] ?? {});
    if (eids.length > 0) return eids;
  }
  return [];
}

/**
 * Resolve the actual transport URL for one query destination AID.
 *
 * An explicit witness uses its own location records. Ordinary queries use only
 * the selected controller, agent or witness endpoint; mailbox providers are not
 * query attesters. Missing/unsupported locations do not promote another endpoint.
 *
 * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
 * @param queriedPre Subject AID whose state is requested.
 * @param destination Remote attester AID, distinct from the local signer.
 * @param options explicitWitness resolves directly through witness location records; default false.
 * @returns Preferred endpoint URL, or null if no permitted route exists.
 */
function resolveQueryDestinationUrl(
  hab: Hab,
  queriedPre: string,
  destination: string,
  {
    explicitWitness = false,
  }: {
    explicitWitness?: boolean;
  } = {},
): string | null {
  if (explicitWitness) {
    const urls = hab.fetchUrls(destination);
    return urls[Schemes.https] ?? urls[Schemes.http] ?? urls[Schemes.tcp] ?? null;
  }

  const ends = hab.endsFor(queriedPre);
  for (const role of [Roles.controller, Roles.agent, Roles.witness]) {
    const urls = ends[role]?.[destination];
    if (urls) return urls[Schemes.https] ?? urls[Schemes.http] ?? urls[Schemes.tcp] ?? null;
  }

  return null;
}

/** One attempt's signed query packet captured before asynchronous transport. */
interface QueryDelivery {
  /**
   * Captured transport endpoint for this packet.
   */
  url: string;
  /**
   * Signed query plus introduction captured before asynchronous delivery.
   */
  body: Uint8Array;
  /**
   * Remote attester AID carried to the messenger.
   */
  destination: string;
}

/**
 * KERIpy-shaped query sender, independent from semantic query completion.
 *
 * Responsibilities:
 * - turn incomplete portable `query` cues into honest outbound `qry` wire
 *   packets when a local habitat and remote attester can be resolved
 * - capture signed requests and own their concrete, joined transport attempts
 *
 * Unresolved signer/attester work stays unsigned for a later pass. Once a packet
 * is prepared, the request leaves the Deck before transport: a failed attempt is
 * reported, not automatically retried. Preparation failures leave the source
 * head available and propagate. HTTP completion includes response EOF/cleanup;
 * same-socket TCP completion also includes received protocol processing. Neither
 * is a substitute for the calling workflow's accepted-state predicate.
 */
export class WitnessInquisitor {
  /** Borrowed local signers and accepted-state stores. */
  private readonly hby: Habery;
  /** Borrowed receive processor for same-socket TCP replies only. */
  private readonly protocol: ProtocolProcessor;
  /** Borrowed HTTP client selected at composition. */
  private readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  private readonly clock: RuntimeClock;
  /** One operation owns the current network attempt. */
  private delivering = false;
  /** Aborts the active send when this sender closes. */
  private output?: AbortController;
  /** Joins active request/parser cleanup before owned queues are cleared. */
  private outputJoined?: Promise<void>;
  /** Unsigned query instructions awaiting an available signer/endpoint. */
  private readonly requests = new Deck<QueryRequest>();
  /** Inspect deferred work without exposing queue mutation outside its owner. */
  get pending(): Pick<Deck<QueryRequest>, "length" | "empty" | "peekHead"> {
    return this.requests;
  }
  /** Terminal admission state; closing stops production and delivery. */
  private closed = false;
  /** Explicit default signer; null requires a unique local habitat. */
  private hab: Hab | null;
  /** The agent every query is addressed and sent to (an edge); null selects ordinary attesters. */
  readonly relay: Relay | null;

  /**
   * Bind actual protocol and I/O collaborators; acquire no store or network lifetime.
   *
   * @param hby Borrowed local habitat collection and accepted-state database.
   * @param protocol Borrowed same-database processor for incoming query replies.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock for transport deadlines; times are milliseconds.
   * @param relay The agent every query goes to; null selects attesters from accepted endpoint roles.
   * @param hab Optional default local signer; null requires an unambiguous sole habitat.
   */
  constructor(
    hby: Habery,
    protocol: ProtocolProcessor,
    http: HttpClient,
    clock: RuntimeClock,
    relay: Relay | null,
    hab: Hab | null = null,
  ) {
    if (protocol.kvy.db !== hby.db) throw new RangeError("Query protocol must use the same database");
    this.hby = hby;
    this.protocol = protocol;
    this.http = http;
    this.clock = clock;
    this.relay = relay;
    this.hab = hab;
  }

  /**
   * Select the local habitat used when queued requests have no explicit signer.
   *
   * @param options Optional default signing habitat; omission/null clears the explicit selection.
   */
  configure({ hab = null }: { hab?: Hab | null } = {}): void {
    this.hab = hab;
  }

  /** The explicitly configured default signer, or null when the sole local habitat is used. */
  get defaultSigner(): string | null {
    return this.hab?.pre ?? null;
  }

  /** Whether a queued request names `signer` as its explicit signer. */
  hasRequestsSignedBy(signer: string): boolean {
    for (const request of this.requests) if (request.signer === signer) return true;
    return false;
  }

  /** Deferred instructions and active sends are this sender's only pending work. */
  hasPendingWork(): boolean {
    return !this.requests.empty || this.hasPendingDelivery;
  }

  /**
   * Queue for later resolution/delivery: copy the top level/witness list only.
   * Nested query values remain borrowed immutable data until consumption or joined close retires the record.
   *
   * @param request Typed request; signer names a local AID and src names a remote attester.
   */
  enqueue(request: QueryRequest): void {
    if (this.closed) throw new Error("Query sender is closed");
    this.requests.append({
      ...request,
      ...copyQuery(request),
      wits: request.wits ? [...request.wits] : undefined,
    });
  }

  /**
   * Admit a routed query cue for sender-owned resolution and one concrete transport attempt.
   *
   * @param cue Typed query cue; missing route/subject produces no request.
   * @param hab Optional local signer hint when the cue has no explicit signer.
   */
  enqueueCue(cue: QueryCue, hab?: Hab | null): void {
    if (this.closed) throw new Error("Query sender is closed");
    if (!cue.route || !cue.pre) return;
    const { kin: _, ...request } = cue;
    const selected = { ...request, signer: request.signer ?? hab?.pre };
    this.enqueue(selected);
  }

  /**
   * Admit a routed query cue unless an identical request is already queued: same subject, route, filters, signer,
   * attester and witness overrides, with the signer resolved as {@link enqueueCue} resolves it. A relaying host's cue
   * router uses this, so the queries of the many edges it serves about one subject leave one request queued; a request
   * already taken for delivery is no longer queued, so a later cue queues the next one.
   *
   * @param cue Typed query cue; missing route/subject produces no request.
   * @param hab Optional local signer hint when the cue has no explicit signer.
   */
  enqueueCueOnce(cue: QueryCue, hab?: Hab | null): void {
    if (this.closed) throw new Error("Query sender is closed");
    if (!cue.route || !cue.pre) return;
    const { kin: _, ...request } = cue;
    const key = requestKey({ ...request, signer: request.signer ?? hab?.pre });
    for (const queued of this.requests) if (requestKey(queued) === key) return;
    this.enqueueCue(cue, hab);
  }

  /** Include actual query I/O in convergence; pending instructions have their own queue. */
  get hasPendingDelivery(): boolean {
    return this.delivering;
  }

  /**
   * Attempt at most the work present when this pass starts, preserving new work
   * for a later pass. Unresolved records rotate to the tail. A recognized send
   * failure ends the pass and throws after cleanup; remaining requests stay queued.
   * Calling during an active pass or after close performs no work.
   */
  *deliverOnce(): Operation<void> {
    const failure = yield* this.deliveryPass();
    if (failure) throw failure;
  }

  /**
   * Own one joined output scope for the pass. Catch only the actual post attempt's
   * TransportError/CesrHttpRefusal as expected send outcomes. Resolution and
   * signing failures stay outside that catch even when they use the same error
   * type; joined-scope teardown failures also escape background reporting.
   */
  private deliveryPass(): Operation<TransportError | CesrHttpRefusal | undefined> {
    // deno-lint-ignore no-this-alias -- The operation owns one finite output pass.
    const self = this;
    return call(function*() {
      if (self.delivering || self.closed) return;
      self.delivering = true;
      const active = self.output = new AbortController();
      let complete!: () => void;
      self.outputJoined = new Promise<void>((resolve) => complete = resolve);
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          self.delivering = false;
          self.output = undefined;
          self.outputJoined = undefined;
          complete();
        }
      });
      const count = self.requests.length;
      for (let index = 0; index < count && !self.closed; index++) {
        const request = self.requests.peekHead();
        if (!request) break;
        const packet = self.prepareRequest(request);
        self.requests.pull();
        if (!packet) {
          self.requests.append(request);
          continue;
        }
        active.signal.throwIfAborted();
        try {
          yield* call(() => self.postQueryMessage(packet, active));
        } catch (error) {
          if (!(error instanceof TransportError || error instanceof CesrHttpRefusal)) throw error;
          return error;
        }
        active.signal.throwIfAborted();
      }
    });
  }

  /**
   * Use ordinary POST delivery for HTTP, draining successful bytes without
   * parsing them. The independent mailbox/direct receiver accepts HTTP replies.
   * TCP explicitly enables same-connection reply processing before completion.
   *
   * @param delivery Retained signed packet including introduction and destination.
   * @param controller Sender attempt cancellation; its signal covers response parsing and cleanup.
   */
  private *postQueryMessage(
    delivery: QueryDelivery,
    controller: AbortController,
  ): Operation<void> {
    // Only this attempt owns signed bytes; failed attempts are never automatically resubmitted.
    const http = this.http, clock = this.clock;
    if (new URL(delivery.url).protocol === "tcp:") {
      yield* requireTcpDialer(http).messenger(delivery.url, clock, this.protocol).send(delivery.body, {
        signal: controller.signal,
        replies: true,
        local: true,
      });
      return;
    }
    const outcome = yield* new HTTPMessenger(delivery.url, http, { destination: delivery.destination })
      .send(delivery.body, { signal: controller.signal });
    if (outcome.kind === "refuse") throw outcome.error;
  }

  /**
   * Stop admission, abort/join active transport and parser cleanup, then discard
   * unsigned pending work. Does not close borrowed collaborators or Baser.
   * Repeating close is harmless; genuine cleanup failures remain visible.
   */
  *close(): Operation<void> {
    this.closed = true;
    this.output?.abort();
    if (this.outputJoined) yield* call(() => this.outputJoined!);
    this.requests.clear();
  }

  /**
   * Long-lived sender worker, run once by composition. Report an expected send
   * failure once, then continue remaining requests on a later turn. Unexpected
   * preparation/cleanup faults terminate the worker. Caller cancellation joins
   * the current attempt; it does not close the borrowed state or HTTP service.
   */
  *deliverDo(tockMs: number = PROTOCOL_TOCK_MS): Operation<never> {
    while (true) {
      // Fixed tock: a pass only when a request is queued; a request waits at most `tockMs` to start.
      if (!this.requests.empty) {
        const failure = yield* this.deliveryPass();
        if (failure) consoleLogger.warn("Query delivery failed", failure);
      }
      yield* waitOnClock(this.clock, tockMs);
    }
  }

  /**
   * Resolve the habitat that is allowed to sign the outbound query.
   *
   * Resolution order:
   * - explicitly selected local signer (unavailable means unresolved, never fallback)
   * - runtime-configured habitat
   * - sole local habitat
   *
   * @param signer Explicit local AID; if unavailable return null rather than falling back.
   * @returns Explicit signer, configured habitat or sole local habitat; otherwise null.
   */
  private configuredHab(signer?: string): Hab | null {
    return signer === undefined ? this.hab ?? soleHab(this.hby) : this.hby.habs.get(signer) ?? null;
  }

  /**
   * Resolve/sign one selected query and introduction immediately before its attempt.
   *
   * @param request Deferred unsigned request; nested query values must remain immutable.
   * @returns Prepared packet, or null when signer/attester evidence is unresolved or the signer cannot sign yet.
   * @throws A selected attester with no endpoint URL throws; source removal remains with the caller.
   */
  private prepareRequest(request: QueryRequest): QueryDelivery | null {
    const hab = this.configuredHab(request.signer);
    // A signer that cannot sign yet leaves the request unresolved: it goes to the tail, and the next pass tries again.
    if (!hab || !hab.canSign()) return null;
    if (this.relay) return this.prepareRelayRequest(hab, request, this.relay);
    const attesters = request.src ? [] : this.attestersFor(request.pre, { signer: hab.pre, wits: request.wits });
    const destination = request.src ?? attesters[Math.floor(Math.random() * attesters.length)];
    if (!destination) return null;
    const url = resolveQueryDestinationUrl(hab, request.pre, destination, {
      explicitWitness: request.wits?.includes(destination) ?? false,
    });
    if (!url) throw new ValidationError(`No endpoint URL found for query destination ${destination}.`);
    const message = hab.query(request.pre, destination, copyQuery(request));
    const intro = introduce(hab, destination);
    return { url, body: concatBytes(intro, message), destination };
  }

  /**
   * Address one query to the relay and sign it for the relay's location. The relay must have an accepted location
   * and the signer must have authorized it as mailbox (where the answer is stored); until then the request stays
   * unresolved and is tried again on a later pass, as for a signer that cannot sign yet.
   *
   * @param hab Local signing habitat.
   * @param request Deferred unsigned request; its `src` and `wits` are not consulted.
   * @param relay The configured relay agent, which is the attester.
   * @returns Prepared packet for the relay, or null while {@link relayRefusal} refuses the relay for this signer.
   */
  private prepareRelayRequest(hab: Hab, request: QueryRequest, relay: Relay): QueryDelivery | null {
    if (relayRefusal(this.hby, relay, hab.pre)) return null;
    const endpoint = relayEndpoint(this.hby, relay)!;
    const message = hab.query(request.pre, relay.aid, copyQuery(request));
    return { url: endpoint.url, body: concatBytes(introduce(hab, relay.aid), message), destination: relay.aid };
  }

  /**
   * Return the first eligible role’s attester IDs; preparation chooses one randomly. With a relay, the relay is the
   * only attester.
   *
   * @param pre Subject AID whose accepted endpoint roles are consulted.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   * @returns Eligible attester AIDs, or an empty array for an unknown subject or unresolved signer/role.
   */
  attestersFor(
    pre: string,
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ): string[] {
    if (this.relay) return [this.relay.aid];
    if (wits && wits.length > 0) {
      // Explicit watcher/witness overrides outrank endpoint-role lookup.
      return [...wits];
    }
    const hab = this.configuredHab(signer);
    return hab ? queryAttesters(hab, pre) : [];
  }
}
