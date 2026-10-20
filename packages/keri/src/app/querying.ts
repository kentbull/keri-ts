import { concatBytes, type SealEvent } from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { AgentCue, QueryCue, QueryInstruction, QueryRequest } from "../core/cues.ts";
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

/**
 * Query/reply correspondence helpers for the Gate E runtime.
 *
 * KERIpy correspondence:
 * - `keri.app.querying` hosts the `KeyStateNoticer`, `LogQuerier`,
 *   `SeqNoQuerier`, and `AnchorQuerier` doers
 * - `keri.app.agenting.WitnessInquisitor` chooses an honest remote attester
 *   when a query is finally emitted
 *
 * `keri-ts` keeps the same behavioral split but makes the ownership seam more
 * explicit:
 * - `QueryCoordinator` owns correspondence, signed query packets and joined
 *   response I/O using concrete protocol and clock/HTTP dependencies
 * - `Hab.processCuesIter()` remains the cue-to-wire interpreter for already
 *   complete cues
 *
 * Non-goals:
 * - this module never receives a parent AgentRuntime or discovers sibling services
 * - this module does not guess across multiple local habitats
 * - this module does not turn watcher/query selection into generic cue logic
 */

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
 * Runtime continuation contract for query-driven follow-on work.
 *
 * Each continuation:
 * - observes emitted cues for relevant state transitions
 * - can enqueue additional queries when local or remote state requires it
 * - exposes `done` so the runtime can include it in convergence checks
 */
interface QueryContinuation {
  /**
   * Whether accepted state satisfies this continuation; completed entries leave the coordinator.
   */
  readonly done: boolean;
  /**
   * Observe a relevant application cue without taking ownership of the shared cue Deck.
   *
   * @param cue Published protocol/application fact, possibly unrelated and ignored.
   * @param coordinator Borrowed correspondence owner for follow-on query admission.
   */
  observe(cue: AgentCue, coordinator: QueryCoordinator): void;
  /**
   * Inspect accepted state and enqueue any query still owed by this continuation.
   *
   * @param coordinator Borrowed state/query owner; this synchronous step performs no network I/O.
   */
  tick(coordinator: QueryCoordinator): void;
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
 * Parse one hex sequence number field from key-state/query payloads.
 *
 * @param value Remote query/key-state ordinal field.
 * @returns parseInt base-16 result, or null for empty/non-string/NaN input; this is not full-string validation.
 */
function parseHexOrdinal(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = parseInt(value, 16);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Encode one non-negative sequence number in KERI hex-ordinal form.
 *
 * @param num Sequence/FEL ordinal; negative input is clamped to zero.
 * @returns Lowercase hexadecimal representation.
 */
function encodeHexOrdinal(num: number): string {
  return Math.max(0, num).toString(16);
}

/**
 * KERIpy-style noticer that starts with a `ksn` query and upgrades to a
 * `logs` query when the remote key state is ahead of local accepted state.
 *
 * Start condition:
 * - caller wants authoritative remote key state for one AID
 *
 * Completion condition:
 * - accepted local key state is at or beyond the remote `ksn.s`
 *
 * Emitted query shape:
 * - first `ksn` with `{ fn: "0", s: "0" }`
 * - later `logs` through `LogQuerier` if remote state is ahead
 */
export class KeyStateNoticer implements QueryContinuation {
  /**
   * Queried AID whose accepted state determines completion.
   */
  readonly pre: string;
  /**
   * Optional local signing AID; distinct from remote attester src.
   */
  readonly signer?: string;
  /**
   * Copied ordered attester overrides, or undefined for endpoint-role selection.
   */
  readonly wits?: string[];
  /**
   * Whether this continuation's accepted-state predicate has completed.
   */
  done = false;
  /**
   * Whether the initial request(s) have been admitted; prevents repeated enqueue on ticks.
   */
  private queried = false;
  /**
   * Follow-on log continuation when remote key state is ahead; null until needed.
   */
  private logQuerier: LogQuerier | null = null;

  /**
   * Initialize an in-memory query continuation; no network work starts in construction.
   *
   * @param pre AID whose accepted KEL state must satisfy this continuation.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   */
  constructor(
    pre: string,
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.signer = signer;
    this.wits = wits ? [...wits] : undefined;
  }

  /**
   * Observe saved remote key state and request missing logs when needed.
   *
   * @param cue Published cue inspected for matching saved key state.
   * @param coordinator Borrowed query owner supplying accepted state and follow-on admission.
   */
  observe(cue: AgentCue, coordinator: QueryCoordinator): void {
    if (this.done || cue.kin !== "keyStateSaved" || cue.ksn.i !== this.pre) {
      return;
    }
    const local = coordinator.hby.db.getKever(this.pre);
    const remoteSn = parseHexOrdinal(cue.ksn.s);
    if (!local || remoteSn === null) {
      return;
    }
    if (local.sn < remoteSn) {
      if (!this.logQuerier || this.logQuerier.targetSn < remoteSn) {
        this.logQuerier = new LogQuerier(this.pre, remoteSn, {
          signer: this.signer,
          wits: this.wits,
        });
      }
      this.logQuerier.tick(coordinator);
      return;
    }
    this.done = true;
  }

  /**
   * Advance this continuation once, enqueueing its initial query only once and marking done when its accepted-state predicate holds.
   *
   * @param coordinator Borrowed query owner used for request admission and accepted-state lookups.
   */
  tick(coordinator: QueryCoordinator): void {
    if (this.done) {
      return;
    }
    if (!this.queried) {
      coordinator.enqueue({
        pre: this.pre,
        route: "ksn",
        q: { fn: "0", s: "0" },
        signer: this.signer,
        wits: this.wits,
      });
      this.queried = true;
    }

    if (this.logQuerier) {
      this.logQuerier.tick(coordinator);
      if (this.logQuerier.done) {
        this.done = true;
      }
    }
  }
}

/**
 * KERIpy-style log querier that waits until local accepted key state reaches a
 * target sequence number.
 *
 * Start condition:
 * - caller already knows the remote target sequence number
 *
 * Completion condition:
 * - local accepted key state reaches `targetSn`
 *
 * Emitted query shape:
 * - `logs` with `{ fn: "0", s: "0" }`
 */
export class LogQuerier implements QueryContinuation {
  /**
   * Queried AID whose accepted state determines completion.
   */
  readonly pre: string;
  /**
   * Inclusive accepted KEL sequence threshold as a number.
   */
  readonly targetSn: number;
  /**
   * Optional local signing AID; distinct from remote attester src.
   */
  readonly signer?: string;
  /**
   * Copied ordered attester overrides, or undefined for endpoint-role selection.
   */
  readonly wits?: string[];
  /**
   * Whether this continuation's accepted-state predicate has completed.
   */
  done = false;
  /**
   * Whether the initial request(s) have been admitted; prevents repeated enqueue on ticks.
   */
  private queried = false;

  /**
   * Initialize an in-memory query continuation; no network work starts in construction.
   *
   * @param pre AID whose accepted KEL state must satisfy this continuation.
   * @param targetSn Required event sequence number as a number, inclusive.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   */
  constructor(
    pre: string,
    targetSn: number,
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.targetSn = targetSn;
    this.signer = signer;
    this.wits = wits ? [...wits] : undefined;
  }

  /**
   * Leave cue observation empty; completion is checked from accepted state in tick.
   *
   * @param _cue Unused; this continuation reads accepted database state in tick.
   * @param _coordinator Unused on cue observation.
   */
  observe(_cue: AgentCue, _coordinator: QueryCoordinator): void {
    return;
  }

  /**
   * Advance this continuation once, enqueueing its initial query only once and marking done when its accepted-state predicate holds.
   *
   * @param coordinator Borrowed query owner used for request admission and accepted-state lookups.
   */
  tick(coordinator: QueryCoordinator): void {
    if (this.done) {
      return;
    }
    if (!this.queried) {
      coordinator.enqueue({
        pre: this.pre,
        route: "logs",
        q: { fn: "0", s: "0" },
        signer: this.signer,
        wits: this.wits,
      });
      this.queried = true;
    }

    const local = coordinator.hby.db.getKever(this.pre);
    if (local && local.sn >= this.targetSn) {
      this.done = true;
    }
  }
}

/**
 * Query helper that waits until local accepted key state reaches one sequence
 * number threshold.
 *
 * Start condition:
 * - caller wants logs replayed until local state reaches `targetSn`
 *
 * Completion condition:
 * - local accepted key state reaches `targetSn`
 *
 * Emitted query shape:
 * - `logs` with explicit `fn` and `s`
 */
export class SeqNoQuerier implements QueryContinuation {
  /**
   * Queried AID whose accepted state determines completion.
   */
  readonly pre: string;
  /**
   * Inclusive accepted KEL sequence threshold as a number.
   */
  readonly targetSn: number;
  /**
   * First-seen ordinal used as the replay start, encoded as hexadecimal in the query.
   */
  readonly fn: number;
  /**
   * Optional local signing AID; distinct from remote attester src.
   */
  readonly signer?: string;
  /**
   * Copied ordered attester overrides, or undefined for endpoint-role selection.
   */
  readonly wits?: string[];
  /**
   * Whether this continuation's accepted-state predicate has completed.
   */
  done = false;
  /**
   * Whether the initial request(s) have been admitted; prevents repeated enqueue on ticks.
   */
  private queried = false;

  /**
   * Initialize an in-memory query continuation; no network work starts in construction.
   *
   * @param pre AID whose accepted KEL state must satisfy this continuation.
   * @param targetSn Required event sequence number as a number, inclusive.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation. fn is the first-seen ordinal start, default zero.
   */
  constructor(
    pre: string,
    targetSn: number,
    {
      fn = 0,
      signer,
      wits,
    }: {
      fn?: number;
      signer?: string;
      wits?: string[];
    } = {},
  ) {
    this.pre = pre;
    this.targetSn = targetSn;
    this.fn = fn;
    this.signer = signer;
    this.wits = wits ? [...wits] : undefined;
  }

  /**
   * Leave cue observation empty; completion is checked from accepted state in tick.
   *
   * @param _cue Unused; this continuation reads accepted database state in tick.
   * @param _coordinator Unused on cue observation.
   */
  observe(_cue: AgentCue, _coordinator: QueryCoordinator): void {
    return;
  }

  /**
   * Advance this continuation once, enqueueing its initial query only once and marking done when its accepted-state predicate holds.
   *
   * @param coordinator Borrowed query owner used for request admission and accepted-state lookups.
   */
  tick(coordinator: QueryCoordinator): void {
    if (this.done) {
      return;
    }
    if (!this.queried) {
      coordinator.enqueue({
        pre: this.pre,
        route: "logs",
        q: {
          fn: encodeHexOrdinal(this.fn),
          s: encodeHexOrdinal(this.targetSn),
        },
        signer: this.signer,
        wits: this.wits,
      });
      this.queried = true;
    }

    const local = coordinator.hby.db.getKever(this.pre);
    if (local && local.sn >= this.targetSn) {
      this.done = true;
    }
  }
}

/**
 * Query helper that waits until local state contains an anchored event seal.
 *
 * Start condition:
 * - caller needs proof of one anchored seal in the queried prefix's KEL
 *
 * Completion condition:
 * - local DB can resolve a sealing event for the requested anchor
 *
 * Emitted query shape:
 * - `logs` from `{ fn: "0", s: "0", a: anchor }`
 */
export class AnchorQuerier implements QueryContinuation {
  /**
   * Queried AID whose accepted state determines completion.
   */
  readonly pre: string;
  /**
   * Copied event seal that must appear in the queried AID's accepted KEL.
   */
  readonly anchor: ReturnType<typeof SealEvent.toSad>;
  /**
   * Optional local signing AID; distinct from remote attester src.
   */
  readonly signer?: string;
  /**
   * Copied ordered attester overrides, or undefined for endpoint-role selection.
   */
  readonly wits?: string[];
  /**
   * Whether this continuation's accepted-state predicate has completed.
   */
  done = false;
  /**
   * Whether the initial request(s) have been admitted; prevents repeated enqueue on ticks.
   */
  private queried = false;

  /**
   * Initialize an in-memory query continuation; no network work starts in construction.
   *
   * @param pre AID whose accepted KEL state must satisfy this continuation.
   * @param anchor Event seal copied by i/s/d and sought in the queried AID's accepted KEL.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   */
  constructor(
    pre: string,
    anchor: AnchorQuerier["anchor"],
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.anchor = { i: anchor.i, s: anchor.s, d: anchor.d };
    this.signer = signer;
    this.wits = wits ? [...wits] : undefined;
  }

  /**
   * Leave cue observation empty; completion is checked from accepted state in tick.
   *
   * @param _cue Unused; this continuation reads accepted database state in tick.
   * @param _coordinator Unused on cue observation.
   */
  observe(_cue: AgentCue, _coordinator: QueryCoordinator): void {
    return;
  }

  /**
   * Advance this continuation once, enqueueing its initial query only once and marking done when its accepted-state predicate holds.
   *
   * @param coordinator Borrowed query owner used for request admission and accepted-state lookups.
   */
  tick(coordinator: QueryCoordinator): void {
    if (this.done) return;
    if (coordinator.hby.db.fetchLastSealingEventByEventSeal(this.pre, this.anchor)) {
      this.done = true;
      return;
    }
    if (this.queried) return;
    // A retired witness may never learn the seal. Ask every current candidate once.
    // With no endpoints, retain one ordinary request for deferred resolution.
    const attesters = coordinator.attestersFor(this.pre, { signer: this.signer, wits: this.wits });
    for (const src of attesters.length ? attesters : [undefined]) {
      coordinator.enqueue({
        pre: this.pre,
        route: "logs",
        q: { fn: "0", s: "0", a: { ...this.anchor } },
        signer: this.signer,
        src,
        wits: this.wits,
      });
    }
    this.queried = true;
  }
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
 * Runtime query side-effect owner.
 *
 * Responsibilities:
 * - turn incomplete portable `query` cues into honest outbound `qry` wire
 *   packets when a local habitat and remote attester can be resolved
 * - host KERIpy-style query continuations such as `KeyStateNoticer`
 */
export class QueryCoordinator {
  /** Borrowed local signers and accepted-state stores. */
  readonly hby: Habery;
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
  /** Aborts the active send when this coordinator closes. */
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
  /** Domain query workflows observing accepted state until their own completion. */
  private continuations: QueryContinuation[] = [];

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

  /**
   * Register one persistent key-state continuation.
   *
   * @param pre Subject AID whose accepted state is observed.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   * @returns The registered in-memory continuation; registration alone does not send a query.
   */
  watchKeyState(
    pre: string,
    options: { signer?: string; wits?: string[] } = {},
  ): KeyStateNoticer {
    this.compactContinuations();
    const noticer = new KeyStateNoticer(pre, options);
    this.continuations.push(noticer);
    return noticer;
  }

  /**
   * Register one persistent logs-until-sequence continuation.
   *
   * @param pre Subject AID whose accepted state is observed.
   * @param sn Inclusive accepted KEL sequence threshold.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   * @returns The registered in-memory continuation; registration alone does not send a query.
   */
  watchSeqNo(
    pre: string,
    sn: number,
    options: { fn?: number; signer?: string; wits?: string[] } = {},
  ): SeqNoQuerier {
    this.compactContinuations();
    const querier = new SeqNoQuerier(pre, sn, options);
    this.continuations.push(querier);
    return querier;
  }

  /**
   * Register one persistent logs-until-anchor continuation.
   *
   * @param pre Subject AID whose accepted state is observed.
   * @param anchor Seal that must appear in the accepted subject KEL.
   * @param options Optional local signer AID and remote witness/attester overrides; neither selects a transport implementation.
   * @returns The registered in-memory continuation; registration alone does not send a query.
   */
  watchAnchor(
    pre: string,
    anchor: AnchorQuerier["anchor"],
    options: { signer?: string; wits?: string[] } = {},
  ): AnchorQuerier {
    this.compactContinuations();
    const querier = new AnchorQuerier(pre, anchor, options);
    this.continuations.push(querier);
    return querier;
  }

  /** Return true while continuations or unsent queries are still pending. */
  hasPendingWork(): boolean {
    this.compactContinuations();
    return !this.requests.empty || this.continuations.length > 0 || this.hasPendingDelivery;
  }

  /**
   * Queue for later resolution/delivery: copy the top level/witness list only.
   * Nested query values remain borrowed immutable data until consumption or joined close retires the record.
   *
   * @param request Typed request; signer names a local AID and src names a remote attester.
   */
  enqueue(request: QueryRequest): void {
    if (this.closed) throw new Error("Query coordinator is closed");
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
    if (this.closed) throw new Error("Query coordinator is closed");
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
   * @param controller Coordinator attempt cancellation; its signal covers response parsing and cleanup.
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
    this.tickContinuations();
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
    this.tickContinuations();
  }

  /** Abort and join real output before clearing packets and correspondence. */
  *close(): Operation<void> {
    this.closed = true;
    this.output?.abort();
    if (this.outputJoined) yield* call(() => this.outputJoined!);
    this.requests.clear();
    this.deliveries.clear();
    this.continuations = [];
  }

  /** Continuous background query worker for long-lived runtime hosts. */
  *queryDo(): Operation<never> {
    while (true) {
      yield* this.processPending();
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
   * Observe retained cue evidence after its immediate destination transfer.
   *
   * @param cue Already-routed protocol observation borrowed by active continuations.
   */
  observeCue(cue: AgentCue): void {
    for (const continuation of this.continuations) continuation.observe(cue, this);
    this.compactContinuations();
  }

  /** Advance domain predicates before producing another query pass. */
  private tickContinuations(): void {
    for (const continuation of this.continuations) continuation.tick(this);
    this.compactContinuations();
  }

  /** Release completed workflows after their final accepted-state observation. */
  private compactContinuations(): void {
    this.continuations = this.continuations.filter((continuation) => !continuation.done);
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
