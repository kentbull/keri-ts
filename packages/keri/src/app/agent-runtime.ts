import type { ResourcePolicy } from "cesr-ts";
import { call, type Operation, resource, spawn } from "npm:effection@^3.6.0";
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
import { Mailboxer } from "../db/mailboxing.ts";
import { Noter } from "../db/noting.ts";
import { createReger, Reger } from "../db/reger.ts";
import { Regery as VdrRegery } from "../vdr/credentialing.ts";
import { Tevery } from "../vdr/eventing.ts";
import { Authenticator } from "./authenticating.ts";
import { loadChallengeHandlers } from "./challenging.ts";
import { cueDo, type CueSink, processCuesOnce } from "./cue-runtime.ts";
import { Anchorer, loadDelegationHandlers } from "./delegating.ts";
import {
  ForwardHandler,
  type MailboxPollBatch,
  MailboxPoller,
  type MailboxPollTransport,
  mailboxTopicForRoute,
  Poster,
} from "./forwarding.ts";
import { FrameIntake } from "./frame-intake.ts";
import { loadMultisigHandlers } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import { loadIpexHandlers } from "./ipexing.ts";
import { MailboxDirector, type MailboxStreamLimits } from "./mailbox-director.ts";
import { mailboxerOptionsForHabery } from "./mailboxing.ts";
import { noterOptionsForHabery, Notifier } from "./notifying.ts";
import { isWellKnownOobiUrl, loadOobiHandlers, Oobiery, type OobiJob, parseOobiUrl } from "./oobiery.ts";
import { QueryCoordinator } from "./querying.ts";
import { type AcdcRuntimeServices, Reactor, type VdrRuntimeServices } from "./reactor.ts";
import { ReplyStreams } from "./reply-streams.ts";
import { recipientForCue, Respondant, senderHabForCue, topicForCue } from "./respondant.ts";
import { RuntimeDeliveries } from "./runtime-deliveries.ts";
import { resolveRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import { Signaler } from "./signaling.ts";
import { Verifier } from "./verifying.ts";

/** Compose responder source-to-delivery wiring at the runtime root; admission receives the actual cue flow. */
export function respondantCueSink(runtime: AgentRuntime, hab?: Hab | null): CueSink {
  return {
    admitCue(source, interpreter) {
      const cue = source.peekHead();
      if (!cue || !interpreter) return "ineligible";
      const recipient = recipientForCue(cue), topic = topicForCue(cue);
      const sender = senderHabForCue(runtime.hby, cue, hab);
      if (!recipient || !topic || !sender) return "ineligible";
      const transferred = runtime.deliveries.enqueueCue(
        interpreter,
        source,
        () =>
          runtime.poster.findBytesRoute(sender, { recipient, topic }) ?? {
            sender: sender.pre,
            recipient,
            topic,
            bodyMode: runtime.hby.cesrBodyMode,
            kind: "direct",
            targets: [],
          },
        sender,
      );
      return transferred.kind === "prepared" ? "transferred" : "ineligible";
    },
    send: (emission) => runtime.respondant.sendWithHab(emission, hab),
  };
}

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
  /** Shared stream, byte and decryption credit; pass this same policy to hosted ESSR recipients. */
  readonly resources: ResourcePolicy;
  mode: AgentMode;
  mailboxer: Mailboxer | null;
  noter: Noter | null;
  notifier: Notifier | null;
  signaler: Signaler | null;
  /**
   * Default cues retain shared byte/item credit through joined consumer cleanup.
   * Consume with processCuesOnce or an owned transfer; naked pull cannot discard that credit.
   */
  cues: Deck<AgentCue>;
  /** Demand-driven input lifetime; protocol decisions stay with Reactor. */
  readonly intake: FrameIntake;
  reactor: Reactor;
  oobiery: Oobiery;
  authenticator: Authenticator;
  mailboxDirector: MailboxDirector;
  respondant: Respondant;
  mailboxPoller: MailboxPoller;
  poster: Poster;
  delegating: Anchorer;
  querying: QueryCoordinator;
  /** Live lazy HTTP replies, closed before their database owners. */
  replyStreams: ReplyStreams;
  /** Bounded query/cue deliveries drained outside guarded cue handling. */
  deliveries: RuntimeDeliveries;
  vdr: VdrRuntimeServices;
  /** V2 registry services, separately owned from the legacy VDR environment. */
  acdc: AcdcRuntimeServices;
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
  /** Must match the policy installed when opening Habery, including shared deployments. */
  resources?: ResourcePolicy;
  mode?: AgentMode;
  mailboxer?: Mailboxer;
  noter?: Noter;
  signaler?: Signaler;
  notifier?: Notifier;
  enableMailboxStore?: boolean;
  services?: Partial<RuntimeServices>;
  mailboxPollTransport?: MailboxPollTransport;
  mailboxStreamLimits?: MailboxStreamLimits;
  vdr?: VdrRuntimeServices;
  /** An injected v2 manager and its backing store remain caller-owned. */
  acdc?: AcdcRuntimeServices;
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
 * - every host mode uses the same shared cue deck and the same component
 *   classes
 * - hosting style changes where the runtime is run, not what it is
 */
export function* createAgentRuntime(
  hby: Habery,
  options: AgentRuntimeOptions = {},
): Operation<AgentRuntime> {
  const resources = hby.db.resources;
  if (
    (options.resources && options.resources !== resources)
    || (options.services?.resources && options.services.resources !== resources)
  ) {
    throw new RangeError("AgentRuntime requires the Habery Baser resource policy; supply it when opening Habery");
  }
  const injectedSignaler = options.signaler ?? options.notifier?.signaler;
  if (
    (options.notifier && options.notifier.hby !== hby)
    || (options.signaler && options.notifier && options.signaler !== options.notifier.signaler)
  ) {
    throw new RangeError("AgentRuntime notification services require its exact Habery and Signaler");
  }
  const mode = options.mode ?? "local";
  const services = resolveRuntimeServices({ ...options.services, resources });
  const enableMailboxStore = options.enableMailboxStore ?? mode === "indirect";
  const mailboxer = options.mailboxer
    ?? (enableMailboxStore ? (yield* openRuntimeMailboxer(hby)) : null);
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
    ?? (noter && signaler ? new Notifier(hby, { noter, signaler }) : null);
  const vdr: VdrRuntimeServices = { ...(options.vdr ?? {}) };
  let ownsReger = false;
  if (!vdr.reger && !hby.readonly) {
    vdr.reger = yield* openRegerForHabery(hby);
    ownsReger = true;
  }
  const reger = vdr.reger instanceof Reger ? vdr.reger : null;
  const acdc: AcdcRuntimeServices = { ...(options.acdc ?? {}) };
  let ownsAcdcRegery = false;
  if (acdc.rgy == null && !hby.readonly) {
    acdc.rgy = yield* openAcdcRegeryForHabery(hby);
    ownsAcdcRegery = true;
  }
  const acdcRegery = acdc.rgy;
  // Acquire after stores, before processors/consumers: reverse teardown joins consumers, clears cues, closes stores.
  const cues = yield* resource<Deck<AgentCue>>(function*(provide) {
    const owned = new Deck<AgentCue>();
    try {
      yield* provide(owned);
    } finally {
      owned.clear();
    }
  });
  if (reger && !vdr.tvy) {
    vdr.tvy = new Tevery({ db: hby.db, reger, cues });
  }
  if (reger && !vdr.vry) {
    vdr.vry = new Verifier(hby, { reger, cues });
  }
  if (reger && vdr.tvy instanceof Tevery && vdr.vry instanceof Verifier && !vdr.rgy) {
    vdr.rgy = new VdrRegery(hby, {
      reger,
      tvy: vdr.tvy,
      vry: vdr.vry,
      cues,
    });
  }
  // Reverse scope teardown joins borrowed output evidence before its backing stores close.
  const replyStreams = yield* resource<ReplyStreams>(function*(provide) {
    const streams = new ReplyStreams();
    try {
      yield* provide(streams);
    } finally {
      streams.close();
    }
  });
  const deliveries = yield* resource<RuntimeDeliveries>(function*(provide) {
    const deliveries = new RuntimeDeliveries();
    try {
      yield* provide(deliveries);
    } finally {
      yield* deliveries.close();
    }
  });
  const intake = new FrameIntake(
    resources,
    async (signal) => (await hby.db.openPayloads(signal)).files.stage(signal),
  );
  const reactor = new Reactor(hby, {
    intake,
    cues,
    vdr,
    resources,
    acdc,
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
    registry: acdc.rgy?.store ?? null,
  });
  const mailboxDirector = yield* resource<MailboxDirector>(function*(provide) {
    const director = new MailboxDirector(hby, {
      ...(mailboxer ? { mailboxer } : {}),
      resources,
      streamLimits: options.mailboxStreamLimits,
    });
    try {
      yield* provide(director);
    } finally {
      yield* call(() => director.close());
    }
  });
  const poster = new Poster(hby, { mailboxer, services });
  const respondant = new Respondant(hby, { poster, mailboxDirector });
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
    const coordinator = new QueryCoordinator(hby);
    try {
      yield* provide(coordinator);
    } finally {
      yield* coordinator.close();
    }
  });
  const delegating = new Anchorer(hby, { poster, querying, services });
  const oobiery = new Oobiery(hby, reactor, { cues, services });
  oobiery.registerReplyRoutes(reactor.router);
  const authenticator = new Authenticator(hby, { services });
  return {
    hby,
    resources,
    mode,
    mailboxer,
    noter,
    notifier,
    signaler,
    cues,
    intake,
    reactor,
    oobiery,
    authenticator,
    mailboxDirector,
    respondant,
    mailboxPoller,
    poster,
    delegating,
    querying,
    replyStreams,
    deliveries,
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
          yield* deliveries.close();
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
 * Drain one bounded mailbox polling turn and settle each returned batch.
 *
 * This keeps mailbox polling ownership inside the shared runtime surface so
 * commands do not need to know how mailbox ingress is parsed and escrowed.
 */
export function* processMailboxTurn(
  runtime: AgentRuntime,
  options: {
    hab?: Hab;
    budgetMs?: number;
  } = {},
): Operation<MailboxPollBatch[]> {
  runtime.mailboxPoller.configure({ hab: options.hab });
  const batches = yield* runtime.mailboxPoller.processOnce({
    budgetMs: options.budgetMs,
  });
  for (const batch of batches) {
    yield* settleMailboxPollBatch(runtime, batch);
  }
  return batches;
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
    pollMailbox?: boolean;
  } = {},
): Operation<void> {
  runtime.querying.configure({ hab: options.hab, sink: options.sink });
  yield* runtime.reactor.processOnce();
  yield* runtime.oobiery.processOnce();
  yield* runtime.authenticator.processOnce();
  yield* runtime.delegating.processAllOnce(runtime);
  runtime.signaler?.processOnce();
  if (options.pollMailbox ?? true) {
    yield* processMailboxTurn(runtime, { hab: options.hab });
  }
  yield* processCuesOnce(runtime, { ...options, sink: runtime.querying });
  yield* runtime.querying.processPending();
  yield* runtime.reactor.processEscrowsOnce();
  yield* runtime.delegating.processAllOnce(runtime);
  yield* processCuesOnce(runtime, { ...options, sink: runtime.querying });
  yield* runtime.querying.processPending();
  yield* runtime.deliveries.process(runtime);
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
    deliveriesPending: runtime.deliveries.hasPending,
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
    pollMailbox?: boolean;
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
      while (true) {
        yield* runtime.deliveries.process(runtime);
        yield* runtimeTurn();
      }
    }),
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
    ...(runtime.signaler
      ? [
        yield* spawn(function*() {
          yield* runtime.signaler!.signalDo();
        }),
      ]
      : []),
    yield* spawn(function*() {
      yield* runtime.mailboxPoller.pollDo((batch) => settleMailboxPollBatch(runtime, batch));
    }),
    yield* spawn(function*() {
      while (true) {
        yield* runtime.delegating.processAllOnce(runtime);
        yield* runtimeTurn();
      }
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
