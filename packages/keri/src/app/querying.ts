import { concatBytes, type SealEvent } from "cesr-ts";
import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { AgentCue, QueryCue, QueryInstruction, QueryRequest } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Roles } from "../core/roles.ts";
import { Schemes } from "../core/schemes.ts";
import { introduce } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import { HTTPMessenger } from "./http-messenger.ts";
import { flattenRoleUrls } from "./mailboxing.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";
import { type RuntimeServices } from "./runtime-services.ts";
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

/**
 * Preferred remote-attester role order for runtime-generated queries.
 *
 * `keri-ts` intentionally chooses a deterministic first-available endpoint
 * instead of KERIpy's random witness/controller/agent selection. That keeps
 * tests and maintainer reasoning stable at the correspondence layer.
 */
const QUERY_ROLE_PRIORITY = [Roles.controller, Roles.agent, Roles.witness];

/** Copy only the owned query-body level without erasing its route/payload relationship. */
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
  readonly done: boolean;
  observe(cue: AgentCue, coordinator: QueryCoordinator): void;
  tick(coordinator: QueryCoordinator): void;
}

/**
 * Return the sole local habitat when exactly one exists.
 *
 * Honesty rule:
 * - one habitat means runtime may safely use it as an implicit signer
 * - more than one habitat means runtime must not guess
 */
function soleHab(hby: Habery): Hab | null {
  const habitats = hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}

/** Parse one hex sequence number field from key-state/query payloads. */
function parseHexOrdinal(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = parseInt(value, 16);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Encode one non-negative sequence number in KERI hex-ordinal form. */
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
  readonly pre: string;
  readonly signer?: string;
  readonly wits?: string[];
  done = false;
  private queried = false;
  private logQuerier: LogQuerier | null = null;

  constructor(
    pre: string,
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.signer = signer;
    this.wits = wits ? [...wits] : undefined;
  }

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
  readonly pre: string;
  readonly targetSn: number;
  readonly signer?: string;
  readonly wits?: string[];
  done = false;
  private queried = false;

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

  observe(_cue: AgentCue, _coordinator: QueryCoordinator): void {
    return;
  }

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
  readonly pre: string;
  readonly targetSn: number;
  readonly fn: number;
  readonly signer?: string;
  readonly wits?: string[];
  done = false;
  private queried = false;

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

  observe(_cue: AgentCue, _coordinator: QueryCoordinator): void {
    return;
  }

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
  readonly pre: string;
  readonly anchor: ReturnType<typeof SealEvent.toSad>;
  readonly signer?: string;
  readonly wits?: string[];
  done = false;
  private queried = false;

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

  observe(_cue: AgentCue, _coordinator: QueryCoordinator): void {
    return;
  }

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
 * Transport policy:
 * - explicit witness-targeted queries resolve directly from the witness AID's
 *   `locs.` replies because KERIpy witness inquiries do not depend on the
 *   queried controller advertising witness end roles
 * - prefer direct controller/agent/witness URLs when the chosen destination
 *   matches an advertised end role
 * - in mailbox-only topologies, allow queries addressed to the controller AID
 *   to ride the first mailbox endpoint URL
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
    const endpoint = flattenRoleUrls(ends[role]).find((entry) => entry.eid === destination);
    if (endpoint) {
      return endpoint.url;
    }
  }

  if (destination === queriedPre) {
    return flattenRoleUrls(ends[Roles.mailbox])[0]?.url ?? null;
  }

  return null;
}

/** One signed query packet captured before asynchronous transport. */
interface QueryDelivery {
  url: string;
  body: Uint8Array;
  bodyMode: "header" | "body";
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
  /** Borrowed HTTP and clock dependencies selected at composition. */
  private readonly services: RuntimeServices;
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

  /** Bind actual protocol and I/O collaborators; acquire no store or network lifetime. */
  constructor(hby: Habery, protocol: ProtocolProcessor, services: RuntimeServices, hab: Hab | null = null) {
    if (protocol.kvy.db !== hby.db) throw new RangeError("Query protocol must use the same database");
    this.hby = hby;
    this.protocol = protocol;
    this.services = services;
    this.hab = hab;
  }

  /** Select the local habitat used when queued requests have no explicit signer. */
  configure({ hab = null }: { hab?: Hab | null } = {}): void {
    this.hab = hab;
  }

  /** Register one persistent key-state continuation. */
  watchKeyState(
    pre: string,
    options: { signer?: string; wits?: string[] } = {},
  ): KeyStateNoticer {
    this.compactContinuations();
    const noticer = new KeyStateNoticer(pre, options);
    this.continuations.push(noticer);
    return noticer;
  }

  /** Register one persistent logs-until-sequence continuation. */
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

  /** Register one persistent logs-until-anchor continuation. */
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
   */
  enqueue(request: QueryRequest): void {
    if (this.closed) throw new Error("Query coordinator is closed");
    this.requests.append({
      ...request,
      ...copyQuery(request),
      wits: request.wits ? [...request.wits] : undefined,
    });
  }

  /** Prepare routed query cues before source removal, or retain unresolved requests for a later turn. */
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

  /** One delivery scope owns upload frames and all response readers through completion or cancellation. */
  private *postQueryMessage(
    delivery: QueryDelivery,
    controller: AbortController,
  ): Operation<void> {
    // Retained packet ownership stays here; the selected messenger owns only this attempt.
    const services = this.services;
    if (new URL(delivery.url).protocol === "tcp:") {
      yield* new TCPMessenger(this.protocol, services.clock).send(delivery.url, delivery.body, {
        signal: controller.signal,
        replies: true,
        local: true,
      });
      return;
    }
    yield* new HTTPMessenger(this.protocol, services.http, services.clock).query(delivery.url, delivery.body, {
      bodyMode: delivery.bodyMode,
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
   */
  private configuredHab(signer?: string): Hab | null {
    return signer === undefined ? this.hab ?? soleHab(this.hby) : this.hby.habs.get(signer) ?? null;
  }

  /** Observe retained cue evidence after its immediate destination transfer. */
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

  /** Capture/sign the selected query, introduction and endpoint; unresolved routing retains its source request. */
  private prepareRequest(request: QueryRequest): boolean {
    const hab = this.configuredHab(request.signer);
    if (!hab) return false;
    const destination = request.src
      ?? this.attestersFor(request.pre, { signer: hab.pre, wits: request.wits })[0];
    if (!destination) return false;
    const url = resolveQueryDestinationUrl(hab, request.pre, destination, {
      explicitWitness: request.wits?.includes(destination) ?? false,
    });
    if (!url) throw new ValidationError(`No endpoint URL found for query destination ${destination}.`);
    const message = hab.query(request.pre, destination, copyQuery(request));
    const intro = introduce(hab, destination);
    this.deliveries.push({ url, body: concatBytes(intro, message), bodyMode: this.hby.cesrBodyMode, destination });
    return true;
  }

  /** Return eligible attester IDs in role priority; explicit witness overrides retain caller order. */
  attestersFor(
    pre: string,
    { signer, wits }: { signer?: string; wits?: string[] } = {},
  ): string[] {
    if (wits && wits.length > 0) {
      // Explicit watcher/witness overrides outrank endpoint-role lookup.
      return [...wits];
    }
    const hab = this.configuredHab(signer);
    if (!hab) return [];

    const ends = hab.endsFor(pre);
    for (const role of QUERY_ROLE_PRIORITY) {
      const roleEnds = ends[role];
      if (!roleEnds) {
        continue;
      }
      // Keep stable candidate order; ordinary requests still select the first ID.
      const eids = Object.keys(roleEnds).sort();
      if (eids.length > 0) return eids;
    }

    if (
      (ends[Roles.mailbox] && Object.keys(ends[Roles.mailbox]).length > 0)
      && this.hby.db.getKever(pre)
    ) {
      // Mailbox-only topologies still query the controller AID itself; the
      // mailbox role affects delivery transport, not the attester identity.
      return [pre];
    }

    return [];
  }
}
