import { type SealEvent } from "cesr-ts";
import { call, type Operation, resource, spawn, type Task } from "npm:effection@^3.6.0";
import { type CueQueueInput, cueReader } from "../core/cue-publishing.ts";
import type { AgentCue, CueEmission, QueryCue, QueryInstruction, QueryRequest } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { Roles } from "../core/roles.ts";
import type { CueAdmission, CueSink } from "./cue-runtime.ts";
import type { Hab, Habery } from "./habbing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

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
 * - `QueryCoordinator` owns runtime correspondence for incomplete `query` cues
 * - `Hab.processCuesIter()` remains the cue-to-wire interpreter for already
 *   complete cues
 *
 * Non-goals:
 * - this module does not own transport
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

/** Sink used when the runtime has no external transport side effects to perform. */
const ignoreSink: CueSink = {
  *send(_emission: CueEmission): Operation<void> {
    return;
  },
};

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
 * Runtime query side-effect owner.
 *
 * Responsibilities:
 * - turn incomplete portable `query` cues into honest outbound `qry` wire
 *   emissions when a local habitat and remote attester can be resolved
 * - host KERIpy-style query continuations such as `KeyStateNoticer`
 * - forward all other cue emissions unchanged to the configured downstream sink
 */
export class QueryCoordinator implements CueSink {
  readonly hby: Habery;
  private readonly requests = new Deck<QueryRequest>();
  /** Inspect deferred work without exposing queue mutation outside its owner. */
  get pending(): Pick<Deck<QueryRequest>, "length" | "empty" | "peekHead"> {
    return this.requests;
  }
  /** Prevent a cue consumer and the background worker from sending the same head concurrently. */
  private processing = false;
  private closed = false;
  private active?: Task<void>;
  private joined?: Promise<void>;
  /** Retain the joined halt result across a cancelled close so the next owner still observes late failure. */
  private stopping?: { task: Task<void>; cleanup: Promise<void> };
  private sink: CueSink;
  private hab: Hab | null;
  private continuations: QueryContinuation[] = [];

  constructor(
    hby: Habery,
    { sink = ignoreSink, hab = null }: { sink?: CueSink; hab?: Hab | null } = {},
  ) {
    this.hby = hby;
    this.sink = sink;
    this.hab = hab;
  }

  /** Rebind the active downstream sink and optional local habitat hint. */
  configure({ sink = ignoreSink, hab = null }: {
    sink?: CueSink;
    hab?: Hab | null;
  } = {}): void {
    this.sink = sink;
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
    return !this.requests.empty || this.continuations.length > 0;
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

  /** Retain routed work only; unresolved schema/credential notices have no outbound query instruction. */
  enqueueCue(cue: QueryCue): boolean {
    if (this.closed) throw new Error("Query coordinator is closed");
    if (!cue.route || !cue.pre) return false;
    const { kin: _, ...request } = cue;
    this.enqueue(request);
    return true;
  }

  /** Observe a source cue only after the downstream owner has atomically retained eligible delivery. */
  admitCue(source: CueQueueInput, interpreter: Hab | null, sink: CueSink = this.sink): CueAdmission {
    const cue = source.peekHead();
    let admission: CueAdmission;
    if (cue?.kin === "query" && sink.admitQuery) {
      admission = sink.admitQuery(cue, () => {
        const emission = interpreter?.interpretCue(cue);
        return emission?.kind === "wire" ? emission : this.transientQueryEmission(cue, interpreter ?? undefined);
      });
      if (admission === "transferred") {
        if (source.peekHead() !== cue) throw new Error("Query source changed during admission");
        const original = cueReader(source).takeOwned()!;
        try {
          this.observeCue(cue);
        } finally {
          original?.release();
        }
        return "transferred";
      }
    } else admission = sink.admitCue?.(source, interpreter) ?? "ineligible";
    if (admission !== "transferred" && admission !== "busy" && admission !== "ineligible") {
      throw new TypeError("Invalid query source admission");
    }
    if (cue && admission === "transferred") this.observeCue(cue);
    return admission;
  }

  /** Observe and resolve incomplete queries synchronously under the caller's local preparation ownership. */
  prepareEmission(emission: CueEmission): CueEmission {
    this.observeCue(emission.cue);
    const prepared = emission.cue.kin === "query" && emission.kind !== "wire"
      ? this.transientQueryEmission(emission.cue) ?? emission
      : emission;
    return this.sink.prepareEmission?.(prepared) ?? prepared;
  }

  /** Await downstream consumption of a prepared emission, with no repeated local signing or observation. */
  *sendPrepared(emission: CueEmission): Operation<void> {
    yield* (this.sink.sendPrepared ?? this.sink.send).call(this.sink, emission);
  }

  /**
   * Direct convenience operation: the caller supplies local preparation ownership/guard
   * and emission lifetime. Runtime cue drains prepare under their turn and send outside it.
   */
  *send(emission: CueEmission): Operation<void> {
    yield* this.sendPrepared(this.prepareEmission(emission));
    if (!this.sink.admitQuery) yield* this.processPending();
  }

  /**
   * Drain one bounded pass of continuation-owned query work.
   *
   * This is the Effection analogue of the KERIpy query/noticer doers: inspect
   * local state, emit any initial or follow-on queries that can honestly be
   * constructed, and retain unresolved work for later turns.
   * Preparation/admission are synchronous owner operations over committed accepted state.
   * Admitted sinks retain wire ownership; no network wait occurs while signing or borrowing state.
   * Plain pending records have no byte reservations or configured queue caps.
   * Standalone/custom wire preparation retains caller-owned bounds.
   */
  processPending(): Operation<void> {
    // deno-lint-ignore no-this-alias -- The isolated generator owns one complete drain pass.
    const self = this;
    return call(function*() {
      if (self.processing || self.closed) return;
      self.processing = true;
      let finish!: () => void;
      self.joined = new Promise<void>((resolve) => finish = resolve);
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          self.active = undefined;
          self.processing = false;
          self.joined = undefined;
          finish();
        }
      });
      let failure: { error: unknown } | undefined;
      const task = yield* spawn(function*() {
        try {
          self.tickContinuations();
          const count = self.requests.length;
          for (let index = 0; index < count; index++) {
            const request = self.requests.peekHead();
            if (!request) break;
            if (self.sink.admitQuery) {
              const cue: QueryCue = { kin: "query", ...request };
              const admission = self.sink.admitQuery(cue, () => self.wireEmissionForRequest(request));
              if (admission === "busy") break;
              if (admission === "transferred") {
                self.requests.pull();
                continue;
              }
              if (admission !== "ineligible") throw new TypeError("Invalid query admission");
              self.requests.pull();
              self.requests.append(request);
              continue;
            }
            const emission = self.wireEmissionForRequest(request);
            if (emission) {
              // Keep the head while transport can suspend or fail.
              yield* self.sink.send(emission);
              self.requests.pull();
            } else {
              // Defer unresolved work to the next pass.
              self.requests.pull();
              self.requests.append(request);
            }
          }
          self.tickContinuations();
        } catch (error) {
          failure = { error };
          throw error;
        }
      });
      self.active = task;
      try {
        yield* task;
      } catch (error) {
        const stopping = self.stopping;
        if (!stopping || stopping.task !== task) throw error;
        yield* call(() => stopping.cleanup);
        if (failure) throw failure.error;
      }
    });
  }

  /** Stop active processing and join its children before clearing pending requests. Do not reenter from its sink. */
  *close(): Operation<void> {
    this.closed = true;
    const failures: unknown[] = [];
    try {
      if (this.active && !this.stopping) {
        const task = this.active;
        this.stopping = { task, cleanup: Promise.resolve().then(() => task.halt()) };
      }
      const stopping = this.stopping;
      if (stopping) yield* call(() => stopping.cleanup);
    } catch (error) {
      failures.push(error);
    }
    try {
      if (this.joined) yield* call(() => this.joined!);
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    }
    this.requests.clear();
    this.stopping = undefined;
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Query coordinator cleanup failed");
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

  private tickContinuations(): void {
    for (const continuation of this.continuations) continuation.tick(this);
    this.compactContinuations();
  }

  private compactContinuations(): void {
    this.continuations = this.continuations.filter((continuation) => !continuation.done);
  }

  /**
   * Convert one incomplete portable query cue into a wire-ready request when
   * runtime can honestly resolve its queried prefix.
   */
  private transientQueryEmission(cue: QueryCue, hab?: Hab): CueEmission | null {
    if (!cue.route || !cue.pre) return null;
    return this.wireEmissionForRequest({
      signer: cue.signer ?? hab?.pre,
      pre: cue.pre,
      ...copyQuery(cue),
      src: cue.src,
      wits: cue.wits,
    });
  }

  /**
   * Build one outbound wire emission after habitat and attester resolution.
   *
   * Returned `null` means runtime still lacks honest information and should
   * defer the request rather than manufacture a query from guesswork.
   */
  private wireEmissionForRequest(request: QueryRequest): CueEmission | null {
    const hab = this.configuredHab(request.signer);
    if (!hab) {
      return null;
    }

    const src = request.src
      ?? this.attestersFor(request.pre, { signer: hab.pre, wits: request.wits })[0];
    if (!src) {
      return null;
    }

    const instruction = copyQuery(request);
    return {
      cue: {
        kin: "query",
        pre: request.pre,
        ...(request.signer === undefined ? {} : { signer: request.signer }),
        src,
        ...instruction,
        wits: request.wits ? [...request.wits] : undefined,
      },
      messages: [hab.query(request.pre, src, instruction)],
      kind: "wire",
    };
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
