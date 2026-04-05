import type { Operation } from "npm:effection@^3.6.0";
import type { AgentCue, CueEmission, QueryCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { Roles } from "../core/roles.ts";
import type { CueSink } from "./cue-runtime.ts";
import type { Hab, Habery } from "./habbing.ts";
import { runtimeTurn } from "./runtime-turn.ts";

const QUERY_ROLE_PRIORITY = [Roles.controller, Roles.agent, Roles.witness];

const ignoreSink: CueSink = {
  *send(_emission: CueEmission): Operation<void> {
    return;
  },
};

interface QueryRequest {
  pre: string;
  route: string;
  query: Record<string, unknown>;
  hab?: Hab;
  src?: string;
  wits?: string[];
}

interface QueryContinuation {
  readonly done: boolean;
  observe(cue: AgentCue, coordinator: QueryCoordinator): void;
  tick(coordinator: QueryCoordinator): void;
}

function cloneQueryBody(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return { ...query };
}

function soleHab(hby: Habery): Hab | null {
  const habitats = [...hby.habs.values()];
  return habitats.length === 1 ? habitats[0] ?? null : null;
}

function queryBodyFromCue(cue: QueryCue): Record<string, unknown> {
  return cloneQueryBody(cue.query ?? cue.q ?? {});
}

function extractQueriedPrefix(cue: QueryCue): string | null {
  const body = cue.query ?? cue.q ?? {};
  const pre = cue.pre
    ?? (typeof body.pre === "string" ? body.pre : null)
    ?? (typeof body.i === "string" ? body.i : null);
  return typeof pre === "string" && pre.length > 0 ? pre : null;
}

/**
 * Normalize one `QueryCue` body into the actual KERI `qry.q` payload.
 *
 * KERIpy correspondence:
 * - cue producers often use `pre` and `sn` as local portability hints
 * - wire queries still need the canonical `i` and `s` fields supplied by
 *   `Hab.query(...)`
 */
function normalizeOutboundQuery(cue: QueryCue): Record<string, unknown> {
  const body = queryBodyFromCue(cue);
  if (body.sn !== undefined && body.s === undefined) {
    body.s = body.sn;
  }
  if (body.anchor !== undefined && body.a === undefined) {
    body.a = body.anchor;
  }
  delete body.pre;
  delete body.src;
  delete body.i;
  return body;
}

function parseHexOrdinal(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = parseInt(value, 16);
  return Number.isNaN(parsed) ? null : parsed;
}

function encodeHexOrdinal(num: number): string {
  return Math.max(0, num).toString(16);
}

function firstSorted(values: Iterable<string>): string | null {
  const sorted = [...values].sort();
  return sorted[0] ?? null;
}

/**
 * KERIpy-style noticer that starts with a `ksn` query and upgrades to a
 * `logs` query when the remote key state is ahead of local accepted state.
 */
export class KeyStateNoticer implements QueryContinuation {
  readonly pre: string;
  readonly hab?: Hab;
  readonly wits?: string[];
  done = false;
  private queried = false;
  private logQuerier: LogQuerier | null = null;

  constructor(
    pre: string,
    { hab, wits }: { hab?: Hab; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.hab = hab;
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
          hab: this.hab,
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
        query: { fn: "0", s: "0" },
        hab: this.hab,
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
 */
export class LogQuerier implements QueryContinuation {
  readonly pre: string;
  readonly targetSn: number;
  readonly hab?: Hab;
  readonly wits?: string[];
  done = false;
  private queried = false;

  constructor(
    pre: string,
    targetSn: number,
    { hab, wits }: { hab?: Hab; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.targetSn = targetSn;
    this.hab = hab;
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
        query: { fn: "0", s: "0" },
        hab: this.hab,
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
 */
export class SeqNoQuerier implements QueryContinuation {
  readonly pre: string;
  readonly targetSn: number;
  readonly fn: number;
  readonly hab?: Hab;
  readonly wits?: string[];
  done = false;
  private queried = false;

  constructor(
    pre: string,
    targetSn: number,
    {
      fn = 0,
      hab,
      wits,
    }: {
      fn?: number;
      hab?: Hab;
      wits?: string[];
    } = {},
  ) {
    this.pre = pre;
    this.targetSn = targetSn;
    this.fn = fn;
    this.hab = hab;
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
        query: {
          fn: encodeHexOrdinal(this.fn),
          s: encodeHexOrdinal(this.targetSn),
        },
        hab: this.hab,
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
 */
export class AnchorQuerier implements QueryContinuation {
  readonly pre: string;
  readonly anchor: Record<string, unknown>;
  readonly hab?: Hab;
  readonly wits?: string[];
  done = false;
  private queried = false;

  constructor(
    pre: string,
    anchor: Record<string, unknown>,
    { hab, wits }: { hab?: Hab; wits?: string[] } = {},
  ) {
    this.pre = pre;
    this.anchor = { ...anchor };
    this.hab = hab;
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
        query: { fn: "0", s: "0", a: { ...this.anchor } },
        hab: this.hab,
        wits: this.wits,
      });
      this.queried = true;
    }

    if (
      coordinator.hby.db.fetchAllSealingEventByEventSeal(this.pre, this.anchor)
    ) {
      this.done = true;
    }
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
  readonly pending = new Deck<QueryRequest>();
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
    options: { hab?: Hab; wits?: string[] } = {},
  ): KeyStateNoticer {
    const noticer = new KeyStateNoticer(pre, options);
    this.continuations.push(noticer);
    return noticer;
  }

  /** Register one persistent logs-until-sequence continuation. */
  watchSeqNo(
    pre: string,
    sn: number,
    options: { fn?: number; hab?: Hab; wits?: string[] } = {},
  ): SeqNoQuerier {
    const querier = new SeqNoQuerier(pre, sn, options);
    this.continuations.push(querier);
    return querier;
  }

  /** Register one persistent logs-until-anchor continuation. */
  watchAnchor(
    pre: string,
    anchor: Record<string, unknown>,
    options: { hab?: Hab; wits?: string[] } = {},
  ): AnchorQuerier {
    const querier = new AnchorQuerier(pre, anchor, options);
    this.continuations.push(querier);
    return querier;
  }

  /** Return true while continuations or unsent queries are still pending. */
  hasPendingWork(): boolean {
    this.compactContinuations();
    return !this.pending.empty || this.continuations.length > 0;
  }

  /** Queue one continuation-owned query for later resolution and delivery. */
  enqueue(request: QueryRequest): void {
    this.pending.push({
      ...request,
      query: cloneQueryBody(request.query),
      wits: request.wits ? [...request.wits] : undefined,
    });
  }

  /**
   * Consume one emitted cue, synthesizing any broader query/reply side effects
   * before forwarding to the configured downstream sink.
   */
  *send(emission: CueEmission): Operation<void> {
    this.observeContinuations(emission.cue);

    if (emission.cue.kin === "query" && emission.kind !== "wire") {
      const replacement = this.transientQueryEmission(emission.cue);
      if (replacement) {
        yield* this.sink.send(replacement);
      } else {
        yield* this.sink.send(emission);
      }
    } else {
      yield* this.sink.send(emission);
    }

    yield* this.processPending();
  }

  /**
   * Drain one bounded pass of continuation-owned query work.
   *
   * This is the Effection analogue of the KERIpy query/noticer doers: inspect
   * local state, emit any initial or follow-on queries that can honestly be
   * constructed, and retain unresolved work for later turns.
   */
  *processPending(): Operation<void> {
    this.tickContinuations();

    const kept = new Deck<QueryRequest>();
    while (!this.pending.empty) {
      const request = this.pending.pull();
      if (!request) {
        continue;
      }
      const emission = this.wireEmissionForRequest(request);
      if (emission) {
        yield* this.sink.send(emission);
      } else {
        kept.push(request);
      }
    }
    this.pending.extend(kept);
    this.tickContinuations();
  }

  /** Continuous background query worker for long-lived runtime hosts. */
  *queryDo(): Operation<never> {
    while (true) {
      yield* this.processPending();
      yield* runtimeTurn();
    }
  }

  private configuredHab(requestHab?: Hab): Hab | null {
    return requestHab ?? this.hab ?? soleHab(this.hby);
  }

  private observeContinuations(cue: AgentCue): void {
    for (const continuation of this.continuations) {
      continuation.observe(cue, this);
    }
    this.compactContinuations();
  }

  private tickContinuations(): void {
    for (const continuation of this.continuations) {
      continuation.tick(this);
    }
    this.compactContinuations();
  }

  private compactContinuations(): void {
    this.continuations = this.continuations.filter((continuation) => !continuation.done);
  }

  private transientQueryEmission(cue: QueryCue): CueEmission | null {
    const pre = extractQueriedPrefix(cue);
    if (!pre) {
      return null;
    }
    return this.wireEmissionForRequest({
      pre,
      route: cue.route ?? "logs",
      query: normalizeOutboundQuery(cue),
      src: cue.src,
      wits: cue.wits,
    });
  }

  private wireEmissionForRequest(request: QueryRequest): CueEmission | null {
    const hab = this.configuredHab(request.hab);
    if (!hab) {
      return null;
    }

    const src = request.src
      ?? this.resolveAttester(hab, request.pre, request.wits);
    if (!src) {
      return null;
    }

    const query = cloneQueryBody(request.query);
    return {
      cue: {
        kin: "query",
        pre: request.pre,
        src,
        route: request.route,
        query,
        wits: request.wits ? [...request.wits] : undefined,
      },
      msgs: [hab.query(request.pre, src, query, request.route)],
      kind: "wire",
    };
  }

  private resolveAttester(
    hab: Hab,
    pre: string,
    wits?: string[],
  ): string | null {
    if (wits && wits.length > 0) {
      return wits[0] ?? null;
    }

    const ends = hab.endsFor(pre);
    for (const role of QUERY_ROLE_PRIORITY) {
      const roleEnds = ends[role];
      if (!roleEnds) {
        continue;
      }
      const eid = firstSorted(Object.keys(roleEnds));
      if (eid) {
        return eid;
      }
    }

    return null;
  }
}
