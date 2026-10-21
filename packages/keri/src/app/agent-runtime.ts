import { call, type Operation, resource, spawn, suspend } from "npm:effection@^3.6.0";
import { RegistryObserver } from "../acdc/observing.ts";
import { createRegery as createAcdcRegery, type Regery as AcdcRegery } from "../acdc/registraring.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseNotOpenError } from "../core/errors.ts";
import { Kevery, type MessagePolicy } from "../core/eventing.ts";
import { type KramConfig, Kramer } from "../core/kraming.ts";
import {
  CREDENTIAL_MAILBOX_TOPIC,
  DELEGATE_MAILBOX_TOPIC,
  RECEIPT_MAILBOX_TOPIC,
  REPLAY_MAILBOX_TOPIC,
  REPLY_MAILBOX_TOPIC,
} from "../core/mailbox-topics.ts";
import { Revery } from "../core/routing.ts";
import { Mailboxer } from "../db/mailboxing.ts";
import { Noter } from "../db/noting.ts";
import { createReger, Reger } from "../db/reger.ts";
import { Backer, type BackerRequest } from "../vdr/backing.ts";
import { Regery as VdrRegery } from "../vdr/credentialing.ts";
import { Tevery } from "../vdr/eventing.ts";
import { Authenticator } from "./authenticating.ts";
import { BackerService } from "./backer-service.ts";
import { loadChallengeHandlers } from "./challenging.ts";
import { cueDo } from "./cue-runtime.ts";
import { Anchorer, loadDelegationHandlers } from "./delegating.ts";
import { Exchanger } from "./exchanging.ts";
import {
  ForwardHandler,
  type MailboxPollBatch,
  MailboxPoller,
  mailboxTopicForRoute,
  Poster,
} from "./forwarding.ts";
import { loadMultisigHandlers } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import { loadIpexHandlers } from "./ipexing.ts";
import { MailboxDirector } from "./mailbox-director.ts";
import { mailboxerOptionsForHabery } from "./mailboxing.ts";
import { noterOptionsForHabery, Notifier } from "./notifying.ts";
import { loadOobiHandlers, Oobiery, type OobiJob, oobiTerminalState } from "./oobiery.ts";
import { ProtocolProcessor } from "./protocol-processing.ts";
import { QueryReplies } from "./query-replies.ts";
import { Reactor } from "./reactor.ts";
import { ReplyStreams } from "./reply-streams.ts";
import { Respondant } from "./respondant.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { Signaler } from "./signaling.ts";
import { WitnessInquisitor } from "./witness-inquisitor.ts";

export type { KeriDispatchEnvelope, OobiJob, TransIdxSigGroup };

/**
 * Shared runtime composition root owned by one `Habery`.
 *
 * Ownership model:
 * - the root keeps only truly shared state: `hby` and the shared
 *   cue deck
 * - topic-local state belongs to the component that owns that flow
 * - `Reactor` owns byte ingress; `ProtocolProcessor` owns shared protocol work
 * - `Oobiery` owns durable OOBI queue processing
 * - `Authenticator` owns well-known auth convergence
 *
 * KERIpy mental model:
 * - this is the closest local analogue to a composition root that assembles
 *   multiple doer-owning components, not a bag of every runtime queue
 */
export interface AgentRuntime {
  /** Borrowed identities and accepted-state stores; the runtime never closes the Habery. */
  hby: Habery;
  /** Provider mailbox store, borrowed when injected and otherwise owned when enabled. */
  mailboxer: Mailboxer | null;
  /** Persistent notice store; ownership follows explicit injection. */
  noter: Noter | null;
  /** Configured notice producer, sharing the composed signer and signaler. */
  notifier: Notifier | null;
  /** Transient notice hints; only a runtime-created instance is closed here. */
  signaler: Signaler | null;
  /** Ordinary protocol facts, consumed by the composed cue workers. */
  cues: Deck<AgentCue>;
  /** Demand-driven input lifetime; protocol decisions stay with ProtocolProcessor. */
  reactor: Reactor;
  /** Shared protocol mutations, publication and background escrow processing. */
  protocol: ProtocolProcessor;
  /** Request-owned correlation slots shared with protocol cue publication. */
  replies: QueryReplies;
  /** Configured application exchange processor; workflows observe its durable completion. */
  exc: Exchanger;
  /** Durable OOBI job owner, independent of outgoing delivery. */
  oobiery: Oobiery;
  /** Well-known authentication jobs over the shared HTTP service. */
  authenticator: Authenticator;
  /** Provider stream and mailbox correlation owner. */
  mailboxDirector: MailboxDirector;
  /** Cue-to-signed-message producer; it publishes to postman. */
  respondant: Respondant;
  /** Outbound mailbox SSE polling with independently owned response lifetimes. */
  mailboxPoller: MailboxPoller;
  /** Single FIFO outgoing delivery queue and retained failure owner. */
  postman: Poster;
  /** Explicitly enabled TEL signer and receipt producer, absent on ordinary hosts. */
  backerService: BackerService | null;
  /** Delegation workflow state and delivery/accepted-state gates. */
  delegating: Anchorer;
  /**
   * Background unsigned-request sender, run independently of reply intake.
   * Pending sender work excludes semantic query waits; their invoking operations
   * must observe accepted state and own their own deadline/cancellation.
   */
  querying: WitnessInquisitor;
  /** Live lazy HTTP replies, closed before their database owners. */
  replyStreams: ReplyStreams;
  /** Concrete legacy TEL/credential owner; absent for a readonly Habery without an injected store. */
  readonly vdr: VdrRegery | null;
  /** V2 registry services, separately owned from the legacy VDR environment. */
  readonly acdc: AcdcRegery | null;
  /** Borrowed HTTP implementation selected by the application root. */
  readonly http: HttpClient;
  /** Borrowed clock selected by the same application root. */
  readonly clock: RuntimeClock;
  /** Close only runtime-owned sidecars; caller-injected resources stay caller-owned. */
  close(): Operation<void>;
}

/**
 * Store acquisition and protocol policy choices for one composed agent.
 *
 * Required I/O collaborators are separate arguments. Optional stores select
 * borrowed resources; omitted stores follow the explicit acquisition rules.
 */
export interface AgentRuntimeOptions {
  /**
   * Borrowed provider store; omission creates none unless enableMailboxStore is true.
   */
  mailboxer?: Mailboxer;
  /**
   * Borrowed notice store; omission may acquire a writable default store.
   */
  noter?: Noter;
  /**
   * Borrowed transient hint source, shared with any injected notifier.
   */
  signaler?: Signaler;
  /**
   * Borrowed notice producer; signer/store/signaler identities must match the composition.
   */
  notifier?: Notifier;
  /** Construct a provider mailbox store. Omitted leaves it absent; injected mailboxer stays borrowed. */
  enableMailboxStore?: boolean;
  /** Borrowed legacy registry store; the runtime creates its processors and never closes this store. */
  reger?: Reger;
  /** An injected v2 manager and its backing store remain caller-owned. */
  acdc?: AcdcRegery;
  /** Sender filtering for v2 non-event ingress; denial always wins. */
  messagePolicy?: MessagePolicy;
  /** Optional KRAM uses the trusted runtime receiver clock. */
  kram?: KramConfig;
  /**
   * Explicit nontransferable signer for optional legacy/v1-style TEL backing.
   * Independent of issuer multisig/KEL witnessing; native ACDC v2 does not require it.
   * Borrowed from this Habery, never inferred from hosted identities.
   */
  backerHab?: Hab;
}

/** Summary of pending runtime-backed durable work for bounded command hosts. */
export interface RuntimePendingState {
  /**
   * Whether ordinary application cues await routing.
   */
  cues: boolean;
  /**
   * Whether reply-signature escrow rows remain.
   */
  replyEscrow: boolean;
  /**
   * Whether durable OOBI jobs await acquisition.
   */
  oobiQueued: boolean;
  /**
   * Whether OOBI jobs are marked in flight.
   */
  oobiInFlight: boolean;
  /**
   * Whether multi-OOBI work remains.
   */
  multiPending: boolean;
  /**
   * Whether well-known authentication jobs await processing.
   */
  authQueued: boolean;
  /**
   * Whether authentication requests are marked in flight.
   */
  authInFlight: boolean;
  /**
   * Whether witness, unanchored or publication delegation escrow remains.
   */
  delegationPending: boolean;
  /** True while unsigned query requests or their current transport attempt remain. */
  queriesPending: boolean;
  /** True while independently retained query/cue delivery owners remain. */
  deliveriesPending: boolean;
}

/**
 * Create the shared runtime composition root used by CLI commands and
 * `tufa agent`.
 *
 * Construction rule:
 * - application roots supply HTTP, clock and mailbox transport explicitly
 * - hosts choose concrete optional stores and borrow supplied dependencies
 * - the composition owns only stores it constructs
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param options Optional borrowed stores and protocol policy; omitted writable stores follow the documented acquisition rules.
 * @returns A composed runtime within the enclosing Effection scope; workers are started separately.
 * @throws Dependency mismatch/acquisition errors propagate after owned resource cleanup.
 */
export function* createAgentRuntime(
  hby: Habery,
  http: HttpClient,
  clock: RuntimeClock,
  options: AgentRuntimeOptions = {},
): Operation<AgentRuntime> {
  if (
    options.backerHab && (options.backerHab.db !== hby.db || hby.habs.get(options.backerHab.pre) !== options.backerHab)
  ) {
    throw new RangeError("AgentRuntime backer must be an explicitly selected habitat in this Habery");
  }
  const injectedSignaler = options.signaler ?? options.notifier?.signaler;
  if (
    (options.notifier && options.notifier.signator !== hby.signator)
    || (options.noter && options.notifier && options.noter !== options.notifier.noter)
    || (options.signaler && options.notifier && options.signaler !== options.notifier.signaler)
  ) {
    throw new RangeError("AgentRuntime notification services require its exact Signator, Noter and Signaler");
  }
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
  const backerRequests = options.backerHab ? new Deck<BackerRequest>() : undefined;
  if (options.backerHab && !reger) throw new Error("Hosted TEL backer requires a writable registry store");
  const backer = options.backerHab && reger ? new Backer(options.backerHab, reger) : null;
  const protocolCues = new Deck<AgentCue>();
  const revery = new Revery(hby.db, { cues: protocolCues });
  const tvy = reger ? new Tevery({ db: hby.db, reger, cues: protocolCues, rvy: revery, backerRequests }) : undefined;
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
  // Compose the shared semantic handlers before input owners or network delivery.
  /** Preserve the composed clock receiver when passing a plain epoch-time callback. */
  const now = () => clock.now();
  const kramer = options.kram ? new Kramer(hby.db, { config: options.kram, cues: protocolCues, now }) : undefined;
  const kvy = new Kevery(hby.db, { cues: protocolCues, rvy: revery, messagePolicy: options.messagePolicy, kramer });
  const exc = new Exchanger(hby, { cues: protocolCues, now });
  const replies = new QueryReplies(cues);
  const protocol = new ProtocolProcessor(
    kvy,
    revery,
    exc,
    vdr?.tvy ?? null,
    vdr?.vry ?? null,
    acdc ? new RegistryObserver(hby.db, acdc.store) : null,
    protocolCues,
    cues,
    replies,
  );
  const reactor = new Reactor(protocol);
  loadChallengeHandlers(hby.db, exc);
  loadDelegationHandlers(hby, exc, notifier);
  loadOobiHandlers(hby, exc, notifier);
  loadMultisigHandlers(hby, exc, { notifier });
  loadIpexHandlers(hby, exc, {
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
    const postman = new Poster(hby, mailboxer, protocol, http, clock);
    try {
      yield* provide(postman);
    } finally {
      yield* postman.close();
    }
  });
  const respondant = new Respondant(hby, postman);
  if (mailboxer) {
    exc.addHandler(new ForwardHandler(mailboxDirector));
  }
  for (const route of exc.routes.keys()) {
    if (route === ForwardHandler.resource) {
      continue;
    }
    const topic = mailboxTopicForRoute(route);
    if (topic.length > 0) {
      mailboxDirector.registerTopic(topic);
    }
  }
  const mailboxPoller = new MailboxPoller(
    hby,
    mailboxDirector,
    http,
    clock,
    {},
  );
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
  const querying = yield* resource<WitnessInquisitor>(function*(provide) {
    const inquisitor = new WitnessInquisitor(hby, protocol, http, clock);
    try {
      yield* provide(inquisitor);
    } finally {
      yield* inquisitor.close();
    }
  });
  const backerService = backer && backerRequests ? new BackerService(backer, backerRequests, postman) : null;
  const delegating = new Anchorer(hby, postman, querying, protocol, http, clock);
  const oobiery = new Oobiery(hby, protocol, revery, http, cues);
  oobiery.registerReplyRoutes(revery.rtr);
  const authenticator = new Authenticator(hby, http);
  return {
    hby,
    mailboxer,
    noter,
    notifier,
    signaler,
    cues,
    reactor,
    protocol,
    replies,
    exc,
    oobiery,
    authenticator,
    mailboxDirector,
    respondant,
    mailboxPoller,
    postman,
    backerService,
    delegating,
    querying,
    replyStreams,
    vdr,
    acdc,
    http,
    clock,
    /**
     * Close runtime-owned resources after stopping their dependent I/O.
     * Callers must halt host workers before explicit close. Query/Poster operations and
     * response readers close before owned stores; injected stores and Habery remain
     * borrowed. Continue remaining cleanups after a failure and preserve all failures.
     */
    *close(): Operation<void> {
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
          backerRequests?.clear();
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

/**
 * Own the runtime notification store before its cancellable open can yield.
 *
 * @param hby Habery supplying name/path/temp policy; this helper does not close it.
 * @returns New store/manager owned by the current scope, including failed-open cleanup.
 */
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

/**
 * Own the provider mailbox store through acquisition failure and runtime scope exit.
 *
 * @param hby Habery supplying name/path/temp policy; this helper does not close it.
 * @returns New store/manager owned by the current scope, including failed-open cleanup.
 */
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

/**
 * Open v2 registry services owned by the current Effection scope.
 *
 * @param hby Habery supplying name/path/temp policy; this helper does not close it.
 * @returns New store/manager owned by the current scope, including failed-open cleanup.
 */
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

/**
 * Open the runtime's default TEL store with the same scope-owned lifetime.
 *
 * @param hby Habery supplying name/path/temp policy; this helper does not close it.
 * @returns New store/manager owned by the current scope, including failed-open cleanup.
 */
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
 * Queue one OOBI resolution job through the durable OOBI component.
 *
 * Unlike the older bootstrap runtime, this no longer stages jobs on a root
 * in-memory deck. The authoritative queue is the `oobis.` database family.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param job URL and optional alias admitted to the durable OOBI owner.
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
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param messages Complete resident wire records, processed in iterable order.
 * @param options Optional local-controller/witness policy and receiving mailbox endpoint provenance.
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
  yield* runtime.protocol.processEscrowsOnce();
}

/**
 * Process one remote mailbox batch and its follow-on escrow work.
 *
 * The poller awaits this operation before recording the provider cursor or
 * reading the next event. Protocol completion can accept, escrow or reject input;
 * it does not acknowledge the message to the provider or delete its stored row.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param batch Ordered wire messages for one mailbox subject and provider AID; each is processed before the final escrow pass.
 */
export function* settleMailboxPollBatch(
  runtime: AgentRuntime,
  batch: MailboxPollBatch,
): Operation<void> {
  for (const message of batch.messages) {
    yield* runtime.reactor.processBytes(message);
  }
  yield* runtime.protocol.processEscrowsOnce();
}

/**
 * Return the current pending-work summary for bounded command-local hosts.
 *
 * `queriesPending` describes the background sender only. A concrete workflow
 * remains active in its invoking operation until its accepted-state predicate holds.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @returns Current selected work summary; retained Poster failures/completion cues do not imply pending delivery.
 */
export function runtimePendingState(
  runtime: AgentRuntime,
): RuntimePendingState {
  return {
    cues: !runtime.cues.empty || !!runtime.backerService?.requests.length,
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

/**
 * Return true when any command-local runtime work remains in flight.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @returns Whether any category in runtimePendingState is pending.
 */
export function runtimeHasPendingWork(runtime: AgentRuntime): boolean {
  const state = runtimePendingState(runtime);
  return state.cues || state.replyEscrow
    || state.oobiQueued || state.oobiInFlight || state.multiPending
    || state.authQueued || state.authInFlight
    || state.delegationPending
    || state.queriesPending
    || state.deliveriesPending;
}

/**
 * Return true once OOBI acceptance and its ingress/query dependencies settle.
 * Background receipt delivery is not remote acknowledgement of OOBI acceptance;
 * static OOBI servers may refuse unsolicited posts. Runtime close still joins I/O.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param url Exact requested OOBI/well-known URL whose durable state is inspected.
 * @returns Whether the documented authentication/convergence predicate currently holds.
 */
export function runtimeOobiConverged(
  runtime: AgentRuntime,
  url: string,
): boolean {
  const pending = runtimePendingState(runtime);
  return oobiTerminalState(runtime.hby.db, url).status !== "pending"
    && !pending.cues && !pending.replyEscrow
    && !pending.oobiQueued && !pending.oobiInFlight && !pending.multiPending
    && !pending.authQueued && !pending.authInFlight && !pending.delegationPending
    && !pending.queriesPending;
}

/**
 * Run host workers until the caller's predicate succeeds or its deadline expires.
 * The deadline uses Date.now wall time in the current implementation. The worker
 * is halted and joined on success, timeout, failure or cancellation before the
 * caller can release stores. A true predicate at entry starts no worker.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param done Synchronous accepted-state/completion predicate, checked before worker startup and each turn.
 * @param options Required timeoutMs plus optional signer and mailbox polling selection.
 * @throws Timeout or worker/cleanup failure propagates.
 */
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
 * Start the independently progressing runtime workers and suspend until halted.
 * Compose query delivery, Poster delivery, cue routing,
 * ProtocolProcessor escrows, OOBI/authentication, optional notice/mailbox workers,
 * delegation and ordinary query sending. The finalizer halts children in reverse
 * order; store ownership remains with the composition scope.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param options Optional default query/cue signer, remote pollMailbox switch
 * (default true) and command-owned queryCues Deck. Wire queryCues before starting
 * workers; the application cue owner transfers saved notices to its sole noticer.
 * Provider storage never enables local consumption.
 */
export function* runAgentRuntime(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    pollMailbox?: boolean;
    queryCues?: Deck<AgentCue>;
  } = {},
): Operation<void> {
  runtime.querying.configure({ hab: options.hab });
  const tasks = [
    yield* spawn(() => runtime.querying.deliverDo()),
    yield* spawn(() => runtime.postman.deliverDo()),
    ...(runtime.backerService ? [yield* spawn(() => runtime.backerService!.run())] : []),
    yield* spawn(function*() {
      yield* cueDo(runtime, options);
    }),
    yield* spawn(function*() {
      yield* runtime.protocol.escrowDo();
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
  ];
  try {
    return yield* suspend();
  } finally {
    for (const task of tasks.reverse()) {
      yield* task.halt();
    }
  }
}
