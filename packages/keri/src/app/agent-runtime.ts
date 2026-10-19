import { call, type Operation, resource, spawn, suspend } from "npm:effection@^3.6.0";
import { createRegery as createAcdcRegery, type Regery as AcdcRegery } from "../acdc/registraring.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import type { MessagePolicy } from "../core/eventing.ts";
import type { KramConfig } from "../core/kraming.ts";
import {
  CREDENTIAL_MAILBOX_TOPIC,
  DELEGATE_MAILBOX_TOPIC,
  RECEIPT_MAILBOX_TOPIC,
  REPLAY_MAILBOX_TOPIC,
  REPLY_MAILBOX_TOPIC,
} from "../core/mailbox-topics.ts";
import type { OobiRecord } from "../core/records.ts";
import { Revery } from "../core/routing.ts";
import { Mailboxer } from "../db/mailboxing.ts";
import { Noter } from "../db/noting.ts";
import { createReger, Reger } from "../db/reger.ts";
import { Regery as VdrRegery } from "../vdr/credentialing.ts";
import { Tevery } from "../vdr/eventing.ts";
import { Authenticator } from "./authenticating.ts";
import { loadChallengeHandlers } from "./challenging.ts";
import { cueDo } from "./cue-runtime.ts";
import { Anchorer, loadDelegationHandlers } from "./delegating.ts";
import {
  ForwardHandler,
  type MailboxPollBatch,
  MailboxPoller,
  type MailboxPollTransport,
  mailboxTopicForRoute,
  Poster,
} from "./forwarding.ts";
import { loadMultisigHandlers } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import { loadIpexHandlers } from "./ipexing.ts";
import { MailboxDirector } from "./mailbox-director.ts";
import { mailboxerOptionsForHabery } from "./mailboxing.ts";
import { noterOptionsForHabery, Notifier } from "./notifying.ts";
import { isWellKnownOobiUrl, loadOobiHandlers, Oobiery, type OobiJob, parseOobiUrl } from "./oobiery.ts";
import { QueryCoordinator } from "./querying.ts";
import { Reactor } from "./reactor.ts";
import { ReplyStreams } from "./reply-streams.ts";
import { Respondant } from "./respondant.ts";
import { resolveRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { Signaler } from "./signaling.ts";

export type { KeriDispatchEnvelope, OobiJob, TransIdxSigGroup };

/**
 * Shared runtime composition root owned by one `Habery`.
 *
 * Ownership model:
 * - the root keeps only truly shared state: `hby` and the shared
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
  mailboxer: Mailboxer | null;
  noter: Noter | null;
  notifier: Notifier | null;
  signaler: Signaler | null;
  /** Ordinary protocol facts, consumed by the composed cue workers. */
  cues: Deck<AgentCue>;
  /** Demand-driven input lifetime; protocol decisions stay with Reactor. */
  reactor: Reactor;
  oobiery: Oobiery;
  authenticator: Authenticator;
  mailboxDirector: MailboxDirector;
  respondant: Respondant;
  mailboxPoller: MailboxPoller;
  postman: Poster;
  delegating: Anchorer;
  querying: QueryCoordinator;
  /** Live lazy HTTP replies, closed before their database owners. */
  replyStreams: ReplyStreams;
  /** Concrete legacy TEL/credential owner; absent for a readonly Habery without an injected store. */
  readonly vdr: VdrRegery | null;
  /** V2 registry services, separately owned from the legacy VDR environment. */
  readonly acdc: AcdcRegery | null;
  services: RuntimeServices;
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
  mailboxer?: Mailboxer;
  noter?: Noter;
  signaler?: Signaler;
  notifier?: Notifier;
  /** Construct a provider mailbox store. Omitted leaves it absent; injected mailboxer stays borrowed. */
  enableMailboxStore?: boolean;
  services?: Partial<RuntimeServices>;
  mailboxPollTransport?: MailboxPollTransport;
  /** Borrowed legacy registry store; the runtime creates its processors and never closes this store. */
  reger?: Reger;
  /** An injected v2 manager and its backing store remain caller-owned. */
  acdc?: AcdcRegery;
  /** Sender filtering for v2 non-event ingress; denial always wins. */
  messagePolicy?: MessagePolicy;
  /** Optional KRAM uses the trusted runtime receiver clock. */
  kram?: KramConfig;
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
  delegationPending: boolean;
  /** True when query continuations or deferred correspondence requests remain. */
  queriesPending: boolean;
  /** True while independently retained query/cue delivery owners remain. */
  deliveriesPending: boolean;
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
 * - hosts choose concrete optional stores and borrow supplied dependencies
 * - the composition owns only stores it constructs
 */
export function* createAgentRuntime(
  hby: Habery,
  options: AgentRuntimeOptions = {},
): Operation<AgentRuntime> {
  const injectedSignaler = options.signaler ?? options.notifier?.signaler;
  if (
    (options.notifier && options.notifier.signator !== hby.signator)
    || (options.noter && options.notifier && options.noter !== options.notifier.noter)
    || (options.signaler && options.notifier && options.signaler !== options.notifier.signaler)
  ) {
    throw new RangeError("AgentRuntime notification services require its exact Signator, Noter and Signaler");
  }
  const services = resolveRuntimeServices(options.services);
  const mailboxer = options.mailboxer
    ?? (options.enableMailboxStore ? (yield* openRuntimeMailboxer(hby)) : null);
  const ownsMailboxer = options.mailboxer === undefined && mailboxer !== null;
  const ownsSignaler = injectedSignaler === undefined && hby.signator !== null;
  const signaler = injectedSignaler ?? (ownsSignaler
    ? (yield* resource<Signaler>(function*(provide) {
      const owned = new Signaler();
      try {
        yield* provide(owned);
      } finally {
        owned.close();
      }
    }))
    : null);
  const noter = options.noter
    ?? options.notifier?.noter
    ?? (!hby.readonly && hby.signator ? (yield* openRuntimeNoter(hby)) : null);
  const ownsNoter = options.noter === undefined
    && options.notifier === undefined
    && noter !== null;
  const notifier = options.notifier
    ?? (hby.signator && noter && signaler ? new Notifier(hby.signator, { noter, signaler }) : null);
  const reger = options.reger ?? (!hby.readonly ? (yield* openRegerForHabery(hby)) : null);
  const ownsReger = options.reger === undefined && reger !== null;
  const acdc = options.acdc ?? (!hby.readonly ? (yield* openAcdcRegeryForHabery(hby)) : null);
  const ownsAcdcRegery = options.acdc === undefined && acdc !== null;
  const acdcRegery = acdc;
  // Acquire after stores, before processors/consumers: reverse teardown joins consumers, clears cues, closes stores.
  const cues = yield* resource<Deck<AgentCue>>(function*(provide) {
    const owned = new Deck<AgentCue>();
    try {
      yield* provide(owned);
    } finally {
      owned.clear();
    }
  });
  const protocolCues = new Deck<AgentCue>();
  const revery = new Revery(hby.db, { cues: protocolCues });
  const tvy = reger ? new Tevery({ db: hby.db, reger, cues: protocolCues, rvy: revery }) : undefined;
  const vdr = reger ? new VdrRegery(hby, { reger, cues: protocolCues, tvy }) : null;
  // Reverse scope teardown joins borrowed output evidence before its backing stores close.
  const replyStreams = yield* resource<ReplyStreams>(function*(provide) {
    const streams = new ReplyStreams();
    try {
      yield* provide(streams);
    } finally {
      streams.close();
    }
  });
  const reactor = new Reactor(hby, {
    cues,
    protocolCues,
    revery,
    tevery: vdr?.tvy,
    verifier: vdr?.vry,
    registry: acdc ?? undefined,
    messagePolicy: options.messagePolicy,
    kram: options.kram,
    now: () => services.clock.now(),
  });
  yield* resource<void>(function*(provide) {
    try {
      yield* provide();
    } finally {
      reactor.clearIngress();
    }
  });
  loadChallengeHandlers(hby.db, reactor.exchanger);
  loadDelegationHandlers(hby, reactor.exchanger, notifier);
  loadOobiHandlers(hby, reactor.exchanger, notifier);
  loadMultisigHandlers(hby, reactor.exchanger, { notifier });
  loadIpexHandlers(hby, reactor.exchanger, {
    notifier,
    registry: acdc?.store ?? null,
  });
  const mailboxDirector = yield* resource<MailboxDirector>(function*(provide) {
    const director = new MailboxDirector(hby, {
      ...(mailboxer ? { mailboxer } : {}),
    });
    try {
      yield* provide(director);
    } finally {
      yield* call(() => director.close());
    }
  });
  const postman = yield* resource<Poster>(function*(provide) {
    const postman = new Poster(hby, mailboxer, reactor, services);
    try {
      yield* provide(postman);
    } finally {
      yield* postman.close();
    }
  });
  const respondant = new Respondant(hby, { postman, replyStreams });
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
  const mailboxPoller = new MailboxPoller(hby, mailboxDirector, {
    services,
    pollTransport: options.mailboxPollTransport,
  });
  for (
    const topic of [
      DELEGATE_MAILBOX_TOPIC,
      CREDENTIAL_MAILBOX_TOPIC,
      RECEIPT_MAILBOX_TOPIC,
      REPLAY_MAILBOX_TOPIC,
      REPLY_MAILBOX_TOPIC,
    ]
  ) {
    mailboxDirector.registerTopic(topic);
  }
  const querying = yield* resource<QueryCoordinator>(function*(provide) {
    const coordinator = new QueryCoordinator(hby, { reactor, services });
    try {
      yield* provide(coordinator);
    } finally {
      yield* coordinator.close();
    }
  });
  const delegating = new Anchorer(hby, { postman, querying, services, reactor });
  const oobiery = new Oobiery(hby, reactor, { cues, services });
  oobiery.registerReplyRoutes(reactor.router);
  const authenticator = new Authenticator(hby, { services });
  return {
    hby,
    mailboxer,
    noter,
    notifier,
    signaler,
    cues,
    reactor,
    oobiery,
    authenticator,
    mailboxDirector,
    respondant,
    mailboxPoller,
    postman,
    delegating,
    querying,
    replyStreams,
    vdr,
    acdc,
    services,
    *close(): Operation<void> {
      reactor.clearIngress();
      const failures: unknown[] = [];
      const cleanup = [
        function*() {
          yield* querying.close();
        },
        function*() {
          if (ownsSignaler) signaler?.close();
        },
        function*() {
          yield* postman.close();
        },
        function*() {
          yield* call(() => Promise.resolve(replyStreams.close()));
        },
        function*() {
          yield* call(() => mailboxDirector.close());
        },
        function*() {
          cues.clear();
        },
        function*() {
          if (ownsNoter && noter?.opened) yield* noter.close(hby.temp);
        },
        function*() {
          if (ownsMailboxer && mailboxer?.opened) yield* mailboxer.close(hby.temp);
        },
        function*() {
          if (ownsAcdcRegery && acdcRegery?.store.opened) yield* acdcRegery.close();
        },
        function*() {
          if (ownsReger && reger?.opened) yield* reger.close(hby.temp);
        },
      ];
      for (const close of cleanup) {
        try {
          yield* close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "Runtime cleanup failed");
    },
  };
}

/** Own the runtime notification store before its cancellable open can yield. */
function* openRuntimeNoter(hby: Habery): Operation<Noter> {
  return yield* resource<Noter>(function*(provide) {
    const options = noterOptionsForHabery(hby);
    const store = new Noter(options);
    try {
      if (!(yield* store.reopen(options))) throw new DatabaseNotOpenError("Failed to open runtime Noter");
      yield* provide(store);
    } finally {
      yield* store.close(hby.temp);
    }
  });
}

/** Own the provider mailbox store through acquisition failure and runtime scope exit. */
function* openRuntimeMailboxer(hby: Habery): Operation<Mailboxer> {
  return yield* resource<Mailboxer>(function*(provide) {
    const options = mailboxerOptionsForHabery(hby);
    const store = new Mailboxer(options);
    try {
      if (!(yield* store.reopen(options))) throw new DatabaseNotOpenError("Failed to open runtime Mailboxer");
      yield* provide(store);
    } finally {
      yield* store.close(hby.temp);
    }
  });
}

/** Open v2 registry services owned by the current Effection scope. */
function* openAcdcRegeryForHabery(hby: Habery): Operation<AcdcRegery> {
  return yield* resource<AcdcRegery>(function*(provide) {
    const rgy = yield* call(() => createAcdcRegery({ hby }));
    try {
      yield* provide(rgy);
    } finally {
      yield* rgy.close();
    }
  });
}

/** Open the runtime's default TEL store with the same scope-owned lifetime. */
function* openRegerForHabery(hby: Habery): Operation<Reger> {
  return yield* resource<Reger>(function*(provide) {
    const store = yield* call(() =>
      createReger({
        name: hby.name,
        base: hby.base,
        temp: hby.temp,
        headDirPath: hby.headDirPath,
        compat: hby.compat,
      })
    );
    try {
      yield* provide(store);
    } finally {
      if (store.opened) yield* store.close(hby.temp);
    }
  });
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
 * Parse and settle one or more complete KERI/CESR records immediately.
 *
 * This is the shared ingress-settlement seam for mailbox-delivered batches and
 * HTTP request payloads that should advance parser and escrow state together.
 *
 * Maintainer mental model:
 * - this helper is intentionally route-policy-free
 * - callers decide whether a message should be treated as `local` or ordinary
 *   remote ingress before calling it
 * - once called, it always does the same two things: finish each record and run
 *   one escrow replay turn
 *
 * Why `local` matters:
 * - `local` is not an HTTP transport detail
 * - it is a parser/runtime semantic switch used when the host is acting as the
 *   local controller or local witness for the received message
 * - witness hosting relies on that distinction so accepted witness-targeted
 *   events emit witness cues rather than ordinary remote receipt cues
 */
export function* settleRuntimeIngress(
  runtime: AgentRuntime,
  messages: Iterable<Uint8Array>,
  {
    local,
    mailboxAid,
  }: {
    local?: boolean;
    /** Receiving hosted endpoint; passed through each dispatch rather than stored globally. */
    mailboxAid?: string | null;
  } = {},
): Operation<void> {
  for (const message of messages) {
    yield* runtime.reactor.processBytes(message, { local, mailboxAid });
  }
  yield* runtime.reactor.processEscrowsOnce();
}

/**
 * Settle one mailbox retrieval batch while preserving per-source boundaries.
 *
 * Local and remote poll results are intentionally processed batch-by-batch so
 * follow-on escrow progress can occur before the next source is consumed.
 */
export function* settleMailboxPollBatch(
  runtime: AgentRuntime,
  batch: MailboxPollBatch,
): Operation<void> {
  for (const message of batch.messages) {
    yield* runtime.reactor.processBytes(message);
  }
  yield* runtime.reactor.processEscrowsOnce();
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
    ingress: runtime.reactor.hasIngress,
    cues: !runtime.cues.empty,
    replyEscrow: runtime.hby.db.rpes.cnt() > 0,
    oobiQueued: runtime.hby.db.oobis.cnt() > 0,
    oobiInFlight: runtime.hby.db.coobi.cnt() > 0,
    multiPending: runtime.hby.db.moobi.cnt() > 0,
    authQueued: runtime.hby.db.woobi.cnt() > 0,
    authInFlight: runtime.hby.db.mfa.cnt() > 0,
    delegationPending: runtime.hby.db.dpwe.cnt() > 0
      || runtime.hby.db.dune.cnt() > 0
      || runtime.hby.db.dpub.cnt() > 0,
    queriesPending: runtime.querying.hasPendingWork(),
    deliveriesPending: runtime.querying.hasPendingDelivery || runtime.postman.hasPending,
  };
}

/** Return true when any command-local runtime work remains in flight. */
export function runtimeHasPendingWork(runtime: AgentRuntime): boolean {
  const state = runtimePendingState(runtime);
  return state.ingress || state.cues || state.replyEscrow
    || state.oobiQueued || state.oobiInFlight || state.multiPending
    || state.authQueued || state.authInFlight
    || state.delegationPending
    || state.queriesPending
    || state.deliveriesPending;
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
 * Return true once OOBI acceptance and its ingress/query dependencies settle.
 * Background receipt delivery is not remote acknowledgement of OOBI acceptance;
 * static OOBI servers may refuse unsolicited posts. Runtime close still joins I/O.
 */
export function runtimeOobiConverged(
  runtime: AgentRuntime,
  url: string,
): boolean {
  const pending = runtimePendingState(runtime);
  return runtimeOobiTerminalState(runtime, url).status !== "pending"
    && !pending.ingress && !pending.cues && !pending.replyEscrow
    && !pending.oobiQueued && !pending.oobiInFlight && !pending.multiPending
    && !pending.authQueued && !pending.authInFlight && !pending.delegationPending
    && !pending.queriesPending;
}

/** Run the same component workers as a host until command state completes or its deadline expires. */
export function* runAgentRuntimeUntil(
  runtime: AgentRuntime,
  done: () => boolean,
  options: {
    hab?: Hab;
    timeoutMs: number;
    pollMailbox?: boolean;
  },
): Operation<void> {
  if (done()) return;
  const { timeoutMs, ...workerOptions } = options;
  const deadline = Date.now() + timeoutMs;
  const worker = yield* spawn(() => runAgentRuntime(runtime, workerOptions));
  try {
    while (!done()) {
      if (Date.now() >= deadline) throw new Error(`Runtime did not converge within ${timeoutMs}ms.`);
      yield* runtimeTurn();
    }
  } finally {
    yield* worker.halt();
  }
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
    pollMailbox?: boolean;
  } = {},
): Operation<void> {
  runtime.querying.configure({ hab: options.hab });
  const tasks = [
    yield* spawn(function*() {
      while (true) {
        yield* runtime.querying.deliverOnce();
        yield* runtimeTurn();
      }
    }),
    yield* spawn(() => runtime.postman.deliverDo()),
    yield* spawn(function*() {
      yield* runtime.reactor.msgDo();
    }),
    yield* spawn(function*() {
      yield* cueDo(runtime, options);
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
    ...(runtime.signaler
      ? [
        yield* spawn(function*() {
          yield* runtime.signaler!.signalDo();
        }),
      ]
      : []),
    ...(options.pollMailbox ?? true
      ? [
        yield* spawn(function*() {
          yield* runtime.mailboxPoller.pollDo((batch) => settleMailboxPollBatch(runtime, batch));
        }),
      ]
      : []),
    yield* spawn(function*() {
      while (true) {
        yield* runtime.delegating.processAllOnce();
        yield* runtimeTurn();
      }
    }),
    yield* spawn(function*() {
      yield* runtime.querying.queryDo();
    }),
  ];
  try {
    return yield* suspend();
  } finally {
    for (const task of tasks.reverse()) {
      yield* task.halt();
    }
  }
}
