/** Signed query sending; concrete workflows own accepted-state completion. */
import { concatBytes } from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { QueryCue, QueryInstruction, QueryRequest } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { Schemes } from "../core/schemes.ts";
import { introduce } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { HTTPQuery } from "./http-query.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { TCPMessenger } from "./tcp-messenger.ts";

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

/** One signed query packet captured before asynchronous transport. */
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
 */
export class WitnessInquisitor {
  /** Borrowed local signers and accepted-state stores. */
  private readonly hby: Habery;
  /** Shared protocol owner used by each concrete messenger response parser. */
  private readonly protocol: ProtocolProcessor;
  /** Borrowed HTTP client selected at composition. */
  private readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  private readonly clock: RuntimeClock;
  /** Signed query packets; the delivery operation removes only completed sends. */
  private readonly deliveries = new Deck<QueryDelivery>();
  /** Prevents concurrent delivery passes over retained packets. */
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

  /**
   * Bind actual protocol and I/O collaborators; acquire no store or network lifetime.
   *
   * @param hby Borrowed local habitat collection and accepted-state database.
   * @param protocol Borrowed same-database processor for incoming query replies.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock for transport deadlines; times are milliseconds.
   * @param hab Optional default local signer; null requires an unambiguous sole habitat.
   */
  constructor(hby: Habery, protocol: ProtocolProcessor, http: HttpClient, clock: RuntimeClock, hab: Hab | null = null) {
    if (protocol.kvy.db !== hby.db) throw new RangeError("Query protocol must use the same database");
    this.hby = hby;
    this.protocol = protocol;
    this.http = http;
    this.clock = clock;
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

  /** Deferred instructions, captured packets and active sends are this sender's only pending work. */
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
   * Prepare routed query cues before source removal, or retain unresolved requests for a later turn.
   *
   * @param cue Typed query cue; missing route/subject produces no request.
   * @param hab Optional local signer hint when the cue has no explicit signer.
   */
  enqueueCue(cue: QueryCue, hab?: Hab | null): void {
    if (this.closed) throw new Error("Query sender is closed");
    if (!cue.route || !cue.pre) return;
    const { kin: _, ...request } = cue;
    const selected = { ...request, signer: request.signer ?? hab?.pre };
    if (!this.prepareRequest(selected)) this.enqueue(selected);
  }

  /** Include live query I/O and unsent packets in convergence. */
  get hasPendingDelivery(): boolean {
    return this.delivering || !this.deliveries.empty;
  }

  /** Join each real response before removing its captured packet; failed/cancelled sends retain exact bytes. */
  deliverOnce(): Operation<void> {
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
      const count = self.deliveries.length;
      for (let index = 0; index < count && !self.closed; index++) {
        const packet = self.deliveries.peekHead();
        if (!packet) break;
        active.signal.throwIfAborted();
        yield* call(() => self.postQueryMessage(packet, active));
        active.signal.throwIfAborted();
        self.deliveries.pull();
      }
    });
  }

  /**
   * One delivery scope owns upload frames and all response readers through completion or cancellation.
   *
   * @param delivery Retained signed packet including introduction and destination.
   * @param controller Sender attempt cancellation; its signal covers response parsing and cleanup.
   */
  private *postQueryMessage(
    delivery: QueryDelivery,
    controller: AbortController,
  ): Operation<void> {
    // Retained packet ownership stays here; the selected messenger owns only this attempt.
    const http = this.http, clock = this.clock;
    if (new URL(delivery.url).protocol === "tcp:") {
      yield* new TCPMessenger(delivery.url, clock, this.protocol).send(delivery.body, {
        signal: controller.signal,
        replies: true,
        local: true,
      });
      return;
    }
    yield* new HTTPQuery(this.protocol, http, clock).query(delivery.url, delivery.body, {
      destination: delivery.destination,
      signal: controller.signal,
    });
  }

  /** Sign and queue one initial pass; unresolved requests rotate and appended work waits for the next turn. */
  *processPending(): Operation<void> {
    if (this.closed) return;
    const count = this.requests.length;
    for (let index = 0; index < count; index++) {
      const request = this.requests.peekHead();
      if (!request) break;
      if (this.prepareRequest(request)) this.requests.pull();
      else {
        this.requests.pull();
        this.requests.append(request);
      }
    }
  }

  /** Abort and join real output before clearing packets and correspondence. */
  *close(): Operation<void> {
    this.closed = true;
    this.output?.abort();
    if (this.outputJoined) yield* call(() => this.outputJoined!);
    this.requests.clear();
    this.deliveries.clear();
  }

  /** Prepare messages independently while the delivery worker may be waiting on a response. */
  *msgDo(): Operation<never> {
    while (true) {
      yield* this.processPending();
      yield* runtimeTurn();
    }
  }

  /** Own concrete attempts independently of preparation; the root joins both workers before close. */
  *deliverDo(): Operation<never> {
    while (true) {
      yield* this.deliverOnce();
      yield* runtimeTurn();
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
   * Capture/sign the selected query, introduction and endpoint; unresolved routing retains its source request.
   *
   * @param request Deferred unsigned request; nested query values must remain immutable.
   * @returns True after signing and queueing a packet; false when signer/attester is unresolved.
   * @throws A selected attester with no endpoint URL throws; source removal remains with the caller.
   */
  private prepareRequest(request: QueryRequest): boolean {
    const hab = this.configuredHab(request.signer);
    if (!hab) return false;
    const attesters = request.src ? [] : this.attestersFor(request.pre, { signer: hab.pre, wits: request.wits });
    const destination = request.src ?? attesters[Math.floor(Math.random() * attesters.length)];
    if (!destination) return false;
    const url = resolveQueryDestinationUrl(hab, request.pre, destination, {
      explicitWitness: request.wits?.includes(destination) ?? false,
    });
    if (!url) throw new ValidationError(`No endpoint URL found for query destination ${destination}.`);
    const message = hab.query(request.pre, destination, copyQuery(request));
    const intro = introduce(hab, destination);
    this.deliveries.push({ url, body: concatBytes(intro, message), destination });
    return true;
  }

  /**
   * Return the first eligible role’s attester IDs; preparation chooses one randomly.
   *
   * @param pre Subject AID whose accepted endpoint roles are consulted.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   * @returns Eligible attester AIDs, or an empty array for an unknown subject or unresolved signer/role.
   */
  attestersFor(
    pre: string,
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ): string[] {
    if (wits && wits.length > 0) {
      // Explicit watcher/witness overrides outrank endpoint-role lookup.
      return [...wits];
    }
    const hab = this.configuredHab(signer);
    if (!hab || !this.hby.db.getKever(pre)) return [];

    const ends = hab.endsFor(pre);
    for (const role of QUERY_ROLE_PRIORITY) {
      const roleEnds = ends[role];
      if (!roleEnds) {
        continue;
      }
      const eids = Object.keys(roleEnds);
      if (eids.length > 0) return eids;
    }

    return [];
  }
}
