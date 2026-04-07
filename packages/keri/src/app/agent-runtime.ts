import { type Operation, spawn } from "npm:effection@^3.6.0";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import type { OobiRecord } from "../core/records.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import { Authenticator } from "./authenticating.ts";
import { loadChallengeHandlers } from "./challenging.ts";
import { cueDo, type CueSink, processCuesOnce } from "./cue-runtime.ts";
import { ForwardHandler, MailboxPoller, mailboxTopicForRoute, Poster } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import { MailboxDirector } from "./mailbox-director.ts";
import { openMailboxerForHabery } from "./mailboxing.ts";
import { isWellKnownOobiUrl, Oobiery, type OobiJob, parseOobiUrl } from "./oobiery.ts";
import { QueryCoordinator } from "./querying.ts";
import { Reactor } from "./reactor.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/**
 * Shared runtime host mode.
 *
 * These modes describe where the same `AgentRuntime` bundle is being hosted,
 * not different implementations. Gate E uses `local` for command-hosted work
 * and `indirect` for the long-lived HTTP OOBI host.
 */
export type AgentMode = "local" | "indirect" | "direct" | "both";

export type { KeriDispatchEnvelope, OobiJob, TransIdxSigGroup };
export type { CueSink };

/**
 * Shared runtime composition root owned by one `Habery`.
 *
 * Ownership model:
 * - the root keeps only truly shared state: `hby`, host `mode`, and the shared
 *   cue deck
 * - topic-local state belongs to the component that owns that flow
 * - `Reactor` owns parser ingress/routing/escrow work
 * - `Oobiery` owns durable OOBI queue processing
 * - `Authenticator` owns well-known auth convergence
 *
 * KERIpy mental model:
 * - this is the closest local analogue to a composition root that assembles
 *   multiple doer-owning components, not a bag of every runtime queue
 */
export interface AgentRuntime {
  hby: Habery;
  mode: AgentMode;
  mailboxer: Mailboxer | null;
  cues: Deck<AgentCue>;
  reactor: Reactor;
  oobiery: Oobiery;
  authenticator: Authenticator;
  mailboxDirector: MailboxDirector;
  mailboxPoller: MailboxPoller;
  poster: Poster;
  querying: QueryCoordinator;
  /** Close only runtime-owned sidecars; caller-injected resources stay caller-owned. */
  close(): Operation<void>;
}

/**
 * Construction options for the shared `AgentRuntime` bundle.
 *
 * The runtime intentionally has a small option surface in Gate E so command-
 * local hosting and long-lived hosting stay behaviorally aligned.
 */
export interface AgentRuntimeOptions {
  mode?: AgentMode;
  mailboxer?: Mailboxer;
  enableMailboxStore?: boolean;
}

/** Summary of pending runtime-backed durable work for bounded command hosts. */
export interface RuntimePendingState {
  ingress: boolean;
  cues: boolean;
  replyEscrow: boolean;
  oobiQueued: boolean;
  oobiInFlight: boolean;
  multiPending: boolean;
  authQueued: boolean;
  authInFlight: boolean;
  outboxPending: boolean;
  /** True when query continuations or deferred correspondence requests remain. */
  queriesPending: boolean;
}

export interface RuntimeOobiTerminalState {
  status: "pending" | "resolved" | "failed";
  via: "none" | "roobi" | "eoobi" | "rmfa";
  record: OobiRecord | null;
}

/**
 * Create the shared runtime composition root used by CLI commands and
 * `tufa agent`.
 *
 * Construction rule:
 * - every host mode uses the same shared cue deck and the same component
 *   classes
 * - hosting style changes where the runtime is run, not what it is
 */
export function* createAgentRuntime(
  hby: Habery,
  options: AgentRuntimeOptions = {},
): Operation<AgentRuntime> {
  const mode = options.mode ?? "local";
  const enableMailboxStore = options.enableMailboxStore ?? mode === "indirect";
  const mailboxer = options.mailboxer
    ?? (enableMailboxStore ? (yield* openMailboxerForHabery(hby)) : null);
  const ownsMailboxer = options.mailboxer === undefined && mailboxer !== null;
  const cues = new Deck<AgentCue>();
  const reactor = new Reactor(hby, { cues });
  loadChallengeHandlers(hby.db, reactor.exchanger);
  const mailboxDirector = new MailboxDirector(
    hby,
    mailboxer ? { mailboxer } : {},
  );
  if (mailboxer) {
    reactor.exchanger.addHandler(new ForwardHandler(mailboxDirector));
  }
  for (const route of reactor.exchanger.routes.keys()) {
    if (route === ForwardHandler.resource) {
      continue;
    }
    const topic = mailboxTopicForRoute(route);
    if (topic.length > 0) {
      mailboxDirector.registerTopic(topic);
    }
  }
  const mailboxPoller = new MailboxPoller(hby, mailboxDirector);
  const poster = new Poster(hby, { mailboxer });
  const oobiery = new Oobiery(hby, reactor, { cues });
  oobiery.registerReplyRoutes(reactor.router);
  const authenticator = new Authenticator(hby);
  const querying = new QueryCoordinator(hby);
  return {
    hby,
    mode,
    mailboxer,
    cues,
    reactor,
    oobiery,
    authenticator,
    mailboxDirector,
    mailboxPoller,
    poster,
    querying,
    *close(): Operation<void> {
      if (ownsMailboxer && mailboxer?.opened) {
        yield* mailboxer.close();
      }
    },
  };
}

/**
 * Queue one CESR/KERI message byte sequence for runtime parsing.
 *
 * This is the supported ingress seam for both local synthetic messages and
 * remotely fetched OOBI material.
 */
export function ingestKeriBytes(
  runtime: AgentRuntime,
  bytes: Uint8Array,
): void {
  runtime.reactor.ingest(bytes);
}

/**
 * Queue one OOBI resolution job through the durable OOBI component.
 *
 * Unlike the older bootstrap runtime, this no longer stages jobs on a root
 * in-memory deck. The authoritative queue is the `oobis.` database family.
 */
export function enqueueOobi(runtime: AgentRuntime, job: OobiJob): void {
  runtime.oobiery.resolve(job.url, job.alias);
}

/**
 * Drain one bounded runtime turn by delegating to component-owned flows.
 *
 * Turn order:
 * 1. `Reactor.processOnce()` drains queued ingress
 * 2. `Oobiery.processOnce()` resolves at most one durable OOBI record
 * 3. `Authenticator.processOnce()` advances one well-known auth step
 * 4. `processCuesOnce()` emits cues from fresh ingress/OOBI work into
 *    `QueryCoordinator`
 * 5. `QueryCoordinator.processPending()` resolves any newly correspondence-ready
 *    query work
 * 6. `Reactor.processEscrowsOnce()` runs KEL and reply escrow passes
 * 7. `processCuesOnce()` emits cues created during escrow progress
 * 8. `QueryCoordinator.processPending()` resolves any follow-on query work
 *
 * This helper remains because command-local CLI flows and focused tests need a
 * single deterministic step without having to spawn the long-lived doers.
 */
export function* processRuntimeTurn(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<void> {
  runtime.querying.configure({ hab: options.hab, sink: options.sink });
  runtime.mailboxPoller.configure({ hab: options.hab });
  runtime.reactor.processOnce();
  yield* runtime.oobiery.processOnce();
  yield* runtime.authenticator.processOnce();
  yield* runtime.poster.processPending();
  yield* runtime.mailboxPoller.processOnce((messages) => {
    for (const message of messages) {
      runtime.reactor.ingest(message);
    }
    runtime.reactor.processOnce();
    runtime.reactor.processEscrowsOnce();
  });
  yield* processCuesOnce(runtime, { ...options, sink: runtime.querying });
  yield* runtime.querying.processPending();
  runtime.reactor.processEscrowsOnce();
  yield* processCuesOnce(runtime, { ...options, sink: runtime.querying });
  yield* runtime.querying.processPending();
}

/**
 * Return the current pending-work summary for bounded command-local hosts.
 *
 * `queriesPending` is part of convergence because query continuations may still
 * owe a follow-on `logs` query or local catch-up wait after normal cue decks
 * and ingress have drained.
 */
export function runtimePendingState(
  runtime: AgentRuntime,
): RuntimePendingState {
  return {
    ingress: !runtime.reactor.ingress.empty,
    cues: !runtime.cues.empty,
    replyEscrow: runtime.hby.db.rpes.cnt() > 0,
    oobiQueued: runtime.hby.db.oobis.cnt() > 0,
    oobiInFlight: runtime.hby.db.coobi.cnt() > 0,
    multiPending: runtime.hby.db.moobi.cnt() > 0,
    authQueued: runtime.hby.db.woobi.cnt() > 0,
    authInFlight: runtime.hby.db.mfa.cnt() > 0,
    outboxPending: runtime.poster.hasPendingWork(),
    queriesPending: runtime.querying.hasPendingWork(),
  };
}

/** Return true when any command-local runtime work remains in flight. */
export function runtimeHasPendingWork(runtime: AgentRuntime): boolean {
  const state = runtimePendingState(runtime);
  return state.ingress || state.cues || state.replyEscrow
    || state.oobiQueued || state.oobiInFlight || state.multiPending
    || state.authQueued || state.authInFlight || state.outboxPending
    || state.queriesPending;
}

/** Return true when a well-known URL has been authorized into `wkas.`. */
export function runtimeHasWellKnownAuth(
  runtime: AgentRuntime,
  url: string,
): boolean {
  const cid = parseOobiUrl(url).cid;
  if (!cid) {
    return false;
  }
  return runtime.hby.db.wkas.get(cid).some((record) => record.url === url);
}

/** Return the current terminal state projection for one requested OOBI URL. */
export function runtimeOobiTerminalState(
  runtime: AgentRuntime,
  url: string,
): RuntimeOobiTerminalState {
  if (isWellKnownOobiUrl(url)) {
    const record = runtime.hby.db.rmfa.get(url);
    if (!record) {
      return { status: "pending", via: "none", record: null };
    }
    return {
      status: record.state === "resolved" ? "resolved" : "failed",
      via: "rmfa",
      record,
    };
  }

  const failed = runtime.hby.db.eoobi.get(url);
  if (failed) {
    return { status: "failed", via: "eoobi", record: failed };
  }

  const resolved = runtime.hby.db.roobi.get(url);
  if (resolved) {
    return { status: "resolved", via: "roobi", record: resolved };
  }

  return { status: "pending", via: "none", record: null };
}

/**
 * Return true once one requested OOBI has reached a terminal state and all
 * related runtime work has drained.
 */
export function runtimeOobiConverged(
  runtime: AgentRuntime,
  url: string,
): boolean {
  return runtimeOobiTerminalState(runtime, url).status !== "pending"
    && !runtimeHasPendingWork(runtime);
}

/**
 * Drive the shared runtime until the caller-provided completion predicate
 * succeeds or the bounded turn budget is exhausted.
 */
export function* processRuntimeUntil(
  runtime: AgentRuntime,
  done: () => boolean,
  options: {
    hab?: Hab;
    sink?: CueSink;
    maxTurns?: number;
  } = {},
): Operation<void> {
  const maxTurns = options.maxTurns ?? 64;
  for (let turn = 0; turn < maxTurns; turn++) {
    if (done()) {
      return;
    }
    yield* processRuntimeTurn(runtime, options);
    if (done()) {
      return;
    }
    if (!runtimeHasPendingWork(runtime)) {
      yield* runtimeTurn();
    }
  }

  throw new Error(
    `Runtime did not converge within ${maxTurns} turns.`,
  );
}

/**
 * Yield cooperatively back to the host scheduler between runtime turns.
 *
 * Re-exported here because earlier Gate E helpers imported the scheduler
 * boundary from `agent-runtime.ts`, and the boundary still conceptually belongs
 * to the shared runtime surface even though components use it internally too.
 */
export { runtimeTurn } from "./runtime-turn.ts";

/**
 * Run the shared runtime continuously until the surrounding host halts it.
 *
 * Component/doer model:
 * - `Reactor.msgDo()` owns continuous ingress draining
 * - `Reactor.escrowDo()` owns continuous escrow reprocessing
 * - `Oobiery.oobiDo()` owns durable OOBI resolution
 * - `Authenticator.authDo()` owns well-known auth convergence
 * - `QueryCoordinator.queryDo()` owns deferred query correspondence work
 *
 * The root itself now acts as a composition host: it starts the component
 * doers and stays alive until the surrounding Effection scope halts.
 */
export function* runAgentRuntime(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    sink?: CueSink;
  } = {},
): Operation<never> {
  runtime.querying.configure({ hab: options.hab, sink: options.sink });
  runtime.mailboxPoller.configure({ hab: options.hab });
  const tasks = [
    yield* spawn(function*() {
      yield* runtime.reactor.msgDo();
    }),
    yield* spawn(function*() {
      yield* cueDo(runtime, { ...options, sink: runtime.querying });
    }),
    yield* spawn(function*() {
      yield* runtime.reactor.escrowDo();
    }),
    yield* spawn(function*() {
      yield* runtime.oobiery.oobiDo();
    }),
    yield* spawn(function*() {
      yield* runtime.authenticator.authDo();
    }),
    yield* spawn(function*() {
      yield* runtime.mailboxPoller.pollDo((messages) => {
        for (const message of messages) {
          runtime.reactor.ingest(message);
        }
        runtime.reactor.processOnce();
        runtime.reactor.processEscrowsOnce();
      });
    }),
    yield* spawn(function*() {
      yield* runtime.querying.queryDo();
    }),
  ];
  try {
    while (true) {
      yield* runtimeTurn();
    }
  } finally {
    for (const task of tasks.reverse()) {
      yield* task.halt();
    }
  }
}
