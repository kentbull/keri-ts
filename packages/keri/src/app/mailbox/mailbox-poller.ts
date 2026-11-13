/** Recipient mailbox polling: signed queries, awaited SSE intake and persisted cursor progression. */
import { call, type Operation, scoped, spawn, type Task } from "npm:effection@^3.6.0";
import type { MailboxPollCue } from "../../core/cues.ts";
import type { Deck } from "../../core/deck.ts";
import type { Relay } from "../delivery/relaying.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { abortable } from "../runtime/abortable.ts";
import { type DoerPacing, doEvery, PROTOCOL_TOCK_MS } from "../runtime/doing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { runtimeTurn } from "../runtime/runtime-turn.ts";
import { waitOnClock } from "../runtime/workflow-contract.ts";
import { isLegacyCesrMediaRejection, readResponseDetail } from "../transport/cesr-egress.ts";
import {
  buildCesrRequest,
  CESR_CONTENT_TYPE,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "../transport/cesr-http.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { requestWithHeaderTimeout } from "../transport/httping.ts";
import { TransportError } from "../transport/transport-error.ts";
import { keepsForPickup } from "./agent-inbox.ts";
import type { MailboxDirector } from "./mailbox-director.ts";
import { consumeMailboxSse, type MailboxSseMessage } from "./mailbox-sse.ts";
import { mailboxPollEndpoints } from "./mailboxing.ts";

/**
 * Scalar polling policy overrides; dependencies are constructor arguments.
 */
interface MailboxPollerOptions {
  /**
   * Optional millisecond header and poll-window overrides.
   */
  timeouts?: Partial<MailboxPollingTimeoutPolicy>;
  /**
   * Where each served poll (`polled`) and each 403 (`unauthorized`) is pushed; the runtime wires the KEL publisher's
   * `polls` deck here, which the publisher drains on its tock. Omitted, polls are reported nowhere.
   */
  polls?: Deck<MailboxPollCue>;
}

/** Tocks between the poller's full re-selection of workers: 160 tocks of 31.25 ms is five seconds. */
export const MAILBOX_POLLER_SWEEP_TOCKS = 160;
/**
 * The production pacing of the mailbox poller. Between sweeps it re-selects workers only when the registered
 * topics or the number of identifiers change, or for an identifier passed to {@link MailboxPoller.prompt} (the
 * runtime prompts one when a mailbox end role is accepted). Endpoint changes other than an accepted mailbox end
 * role (a rotated-in witness, a location accepted after its role, another process writing the same store) are
 * therefore picked up within five seconds.
 */
export const MAILBOX_POLLER_PACING: Readonly<DoerPacing> = Object.freeze({
  tockMs: PROTOCOL_TOCK_MS,
  sweepTocks: MAILBOX_POLLER_SWEEP_TOCKS,
});

/**
 * Retrieve recipient messages from remote mailbox or witness endpoints over HTTP/SSE.
 *
 * Each endpoint has an independent worker and durable progress in the director.
 * Retrieved records are lent to the awaited consumer; protocol intake stays outside.
 * A provider store in the same runtime is never scanned for local recipient input, and this runtime never polls its
 * own endpoint for a local group whose mail it processes on arrival (see {@link MailboxPoller.deliveredOnArrival}).
 */
export class MailboxPoller {
  /**
   * Default header acquisition (5 seconds) and absolute poll window (30 seconds).
   */
  static readonly DefaultTimeoutPolicy: Readonly<MailboxPollingTimeoutPolicy> = Object.freeze({
    requestOpenTimeoutMs: 5_000,
    maxPollDurationMs: 30_000,
    readIdleTimeoutMs: 500,
    refusalInitialMs: 1_000,
    refusalMaxMs: 30_000,
  });
  /**
   * Default idle read window after the first complete event, in milliseconds.
   */
  static readonly ReadIdleTimeoutMs = 500;
  /**
   * Wait after a poll that was not served (a refused status, a 403, no response headers, or an unreachable
   * host), in milliseconds: it starts at `initialMs`, doubles with each consecutive failure up to `maxMs` and
   * starts over after a served poll. Without a wait the worker would repeat the same signed request as fast as
   * the loop turns.
   */
  static readonly RefusalBackoff: Readonly<RefusalBackoffPolicy> = Object.freeze({
    initialMs: 1_000,
    maxMs: 30_000,
  });

  /** Borrowed habitat collection used to select mailbox signers. */
  readonly hby: Habery;
  /** Shared provider topics and persisted remote cursors. */
  readonly mailboxDirector: MailboxDirector;
  /** Existing request-open and SSE-window settings, normalized once. */
  readonly timeoutPolicy: Readonly<MailboxPollingTimeoutPolicy>;
  /** Borrowed HTTP client passed to each polling attempt. */
  readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  readonly clock: RuntimeClock;
  /** Where served polls and 403s are pushed, for the KEL publisher; null when nothing consumes them. */
  readonly polls: Deck<MailboxPollCue> | null;
  /** The agent this runtime polls through (an edge), its only provider; null polls mailboxes and witnesses. */
  readonly relay: Relay | null;

  /**
   * Bind polling inputs and dependencies without starting workers or acquiring stores.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param mailboxDirector Borrowed provider/topic/cursor owner.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   * @param relay The agent every subject is polled through; null selects authorized mailboxes and witnesses.
   * @param options Optional timeout overrides and poll-report deck; finite positive timeouts are floored with a 1 ms minimum. Missing/nonpositive/nonfinite values use 5-second headers and 30-second poll windows.
   */
  constructor(
    hby: Habery,
    mailboxDirector: MailboxDirector,
    http: HttpClient,
    clock: RuntimeClock,
    relay: Relay | null,
    options: MailboxPollerOptions = {},
  ) {
    const { timeouts, polls } = options;
    this.polls = polls ?? null;
    this.hby = hby;
    this.mailboxDirector = mailboxDirector;
    this.timeoutPolicy = normalizeMailboxPollingTimeoutPolicy(timeouts);
    this.http = http;
    this.clock = clock;
    this.relay = relay;
  }

  /**
   * Register one mailbox topic that this poller should retrieve.
   *
   * @param topic Protocol mailbox topic; leading slash is normalized where required.
   */
  registerTopic(topic: string): void {
    this.mailboxDirector.registerTopic(topic);
  }

  /**
   * Poll forever, streaming typed batches into one sink.
   *
   * Each remote endpoint progresses independently, and awaits the consumer before
   * reading the next event or advancing its persisted cursor.
   *
   * @param onBatch Awaited endpoint-batch consumer; the durable event cursor advances only after it succeeds. Failure or cancellation leaves that event available for later retrieval.
   * @throws Consumer/transport failures propagate; endpoint workers are joined on scope exit.
   */
  *pollDo(
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
    pacing: Readonly<DoerPacing> = MAILBOX_POLLER_PACING,
  ): Operation<never> {
    const remoteWorkers = new Map<string, Task<void>>();
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    let habs = -1, shape = "";
    try {
      return yield* doEvery(this.clock, pacing.tockMs, function*(tock) {
        const topics = self.mailboxDirector.registeredTopics();
        // Every tock looks only at what changed: the topics, the number of identifiers, and the identifiers
        // prompted since. Everything else is found by the sweep on tock 0 and every `sweepTocks`.
        const changed = topics.join("|") !== shape || self.hby.habs.size !== habs;
        if (tock % pacing.sweepTocks === 0 || changed) {
          shape = topics.join("|");
          habs = self.hby.habs.size;
          self.#dirty.clear();
          yield* self.syncRemoteWorkers(remoteWorkers, onBatch, topics, pacing.tockMs);
        } else if (self.#dirty.size) {
          const only = new Set(self.#dirty);
          self.#dirty.clear();
          yield* self.syncRemoteWorkers(remoteWorkers, onBatch, topics, pacing.tockMs, only);
        }
      });
    } finally {
      for (const task of [...remoteWorkers.values()].reverse()) {
        yield* task.halt();
      }
    }
  }

  /** Identifiers whose mailbox endpoints changed; the poller re-selects their workers on the next tock. */
  readonly #dirty = new Set<string>();

  /**
   * Tell the poller `pre`'s mailbox roles or endpoints changed, so its workers are re-selected on the next tock
   * instead of at the next sweep.
   */
  prompt(pre: string): void {
    this.#dirty.add(pre);
  }

  /**
   * Stream one remote response through its consumer before recording cursor progress.
   *
   * @param target Mailbox subject habitat plus the actual local signer (a member for groups).
   * @param endpoint Selected remote endpoint AID and HTTP(S) URL.
   * @param onBatch Awaited consumer; successful completion precedes durable cursor advancement.
   * @returns How the poll ended; see {@link PollOutcome}.
   */
  private *pollRemoteEndpointOnce(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<PollOutcome> {
    const cursor = this.mailboxDirector.remoteQueryCursor(target.targetPre, endpoint.eid);
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    // The concrete HTTP/SSE operation owns and joins this whole poll attempt.
    return yield* call(() =>
      fetchMailboxMessages(
        target.signerHab,
        target.targetPre,
        endpoint.eid,
        endpoint.url,
        cursor,
        mailboxFetchTimeoutPolicy(this.timeoutPolicy),
        this.http,
        this.clock,
        function* deliverThenAdvanceCursor(message) {
          yield* call(() => onBatch({ pre: target.targetPre, eid: endpoint.eid, messages: [message.msg] }));
          // A subject retired during this poll keeps no cursor: its worker halts on the next tock.
          if (!self.hby.habs.has(target.targetPre)) return;
          self.mailboxDirector.updateRemoteCursor(target.targetPre, endpoint.eid, message.topic, message.idx);
        },
      )
    );
  }

  /**
   * Keep one long-lived worker running for each currently configured remote endpoint.
   *
   * @param remoteWorkers Owned worker map, mutated to match current endpoint selection.
   * @param onBatch Shared awaited consumer used independently by each endpoint worker.
   * @param topics Current registered topics; no topics means no remote workers.
   * @param tockMs How long a worker whose signer cannot sign yet waits before it looks again.
   */
  private *syncRemoteWorkers(
    remoteWorkers: Map<string, Task<void>>,
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
    topics: readonly string[],
    tockMs: number,
    only?: ReadonlySet<string>,
  ): Operation<void> {
    const wanted = new Map<string, { target: MailboxPollTarget; endpoint: { eid: string; url: string } }>();
    if (topics.length > 0) {
      for (const target of this.remotePollTargets(only)) {
        for (const endpoint of mailboxPollEndpoints(target.hab, this.relay)) {
          if (this.deliveredOnArrival(target.targetPre, endpoint.eid)) continue;
          // The signer is part of the identity: a group whose local member was replaced gets a new worker.
          wanted.set(`${target.targetPre}:${target.signerHab.pre}:${endpoint.key}`, { target, endpoint });
        }
      }
    }

    for (const [workerKey, task] of [...remoteWorkers.entries()]) {
      if (wanted.has(workerKey) || (only && !only.has(workerKey.slice(0, workerKey.indexOf(":"))))) {
        continue;
      }
      yield* task.halt();
      remoteWorkers.delete(workerKey);
    }

    for (const [workerKey, { target, endpoint }] of wanted) {
      if (remoteWorkers.has(workerKey)) continue;
      remoteWorkers.set(workerKey, yield* spawn(() => this.remoteEndpointWorker(target, endpoint, onBatch, tockMs)));
    }
  }

  /**
   * Poll one remote endpoint continuously in the long-lived runtime shape.
   *
   * This keeps KERIpy's "one poller per endpoint" behavior while preserving
   * `keri-ts`'s split between mailbox transport and runtime parser ownership. Each poll ends in a
   * {@link PollOutcome}; {@link nextPoll} maps it and the backoff state to the next action. A mailbox that is
   * unreachable or refuses is retried on {@link MailboxPoller.RefusalBackoff}, never in a tight loop and never
   * by failing the runtime. A served poll and a 403 are pushed onto `polls` for the KEL publisher, which owns posting
   * the KEL.
   *
   * A signer that cannot sign yet (a store opened without it) is not a remote failure: the worker neither polls
   * nor backs off, and looks again each tock, so it polls within one tock of `Manager.hold`. Because it never polls
   * for such a subject, the consumer's protocol work never runs for it either.
   *
   * @param target Mailbox subject habitat plus the actual local signer (a member for groups).
   * @param endpoint Selected remote endpoint AID and HTTP(S) URL.
   * @param onBatch Awaited consumer; successful completion precedes durable cursor advancement.
   * @param tockMs How long the worker waits before it looks again at a signer that cannot sign.
   */
  private *remoteEndpointWorker(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
    tockMs: number,
  ): Operation<never> {
    let state: PollState = { backoffMs: 0 };
    while (true) {
      if (!target.signerHab.canSign()) {
        yield* waitOnClock(this.clock, tockMs);
        continue;
      }
      const outcome = yield* this.pollRemoteEndpointOnce(target, endpoint, onBatch);
      const step = nextPoll(state, outcome, {
        initialMs: this.timeoutPolicy.refusalInitialMs,
        maxMs: this.timeoutPolicy.refusalMaxMs,
      });
      state = step.state;
      switch (step.action.kind) {
        case "poll":
          this.polls?.push({ kin: "polled", pre: target.targetPre, mailbox: endpoint.eid });
          yield* runtimeTurn();
          break;
        case "prompt-publisher":
          this.polls?.push({ kin: "unauthorized", pre: target.targetPre, mailbox: endpoint.eid });
          yield* waitOnClock(this.clock, step.action.ms);
          break;
        case "wait":
          yield* waitOnClock(this.clock, step.action.ms);
          break;
      }
    }
  }

  /**
   * Whether `subject`'s mail at `eid` already reached local processing when it arrived, so polling `eid` for it would
   * process every stored message a second time. That holds when this runtime is the provider (it owns the mailbox
   * store), `eid` is one of its own habitats and it keeps `subject`'s mail for pickup ({@link keepsForPickup}: for a
   * local subject, a group that authorized `eid` as mailbox or agent). Such a host ingests every `/fwd` for the group
   * on arrival (`ForwardHandler`) and dispatches every raw arrival before keeping it; the copy it stores is for the
   * group's remote members, who poll it from here. Any other local subject at a local endpoint (a single-sig habitat
   * whose mailbox is this host) is still polled over loopback HTTP, which is its only local delivery of stored mail.
   * Without a mailbox store this runtime is not the provider, so it polls as any remote client would.
   *
   * @param subject Local mailbox subject AID.
   * @param eid Selected provider AID.
   * @returns True when the endpoint must not be polled for this subject.
   */
  private deliveredOnArrival(subject: string, eid: string): boolean {
    return !!this.mailboxDirector.mailboxer && this.hby.habs.has(eid) && keepsForPickup(this.hby, subject, eid);
  }

  /**
   * Select locally pollable subjects without substituting the group for its member signer.
   *
   * @param only When given, only these identifiers are considered.
   * @returns Local subject/signing pairs; groups without an available local member are omitted.
   */
  private remotePollTargets(only?: ReadonlySet<string>): MailboxPollTarget[] {
    const targets: MailboxPollTarget[] = [];
    for (const hab of this.hby.habs.values()) {
      if (only && !only.has(hab.pre)) continue;
      const signerHab = this.pollSignerHab(hab);
      if (!signerHab) {
        continue;
      }
      targets.push({ hab, targetPre: hab.pre, signerHab });
    }
    return targets;
  }

  /**
   * Choose the actual local signer for a subject's mailbox query.
   *
   * @param hab Local subject habitat, possibly a group.
   * @returns The habitat itself, or its available local group member; null when unresolved.
   */
  private pollSignerHab(hab: Hab): Hab | null {
    if (!this.hby.db.groups.has(hab.pre)) {
      return hab;
    }
    const mid = this.hby.db.getHab(hab.pre)?.mid;
    if (!mid) {
      return null;
    }
    return this.hby.habs.get(mid) ?? null;
  }
}

/**
 * Mailbox subject and signer selection; a group subject uses its local member for signing.
 */
interface MailboxPollTarget {
  /**
   * Subject habitat whose endpoint roles choose remote mailbox targets.
   */
  hab: Hab;
  /**
   * Subject AID requested in the mailbox query.
   */
  targetPre: string;
  /**
   * Local signing habitat; may differ from the group subject.
   */
  signerHab: Hab;
}

/** Mailbox polling windows in milliseconds; the poller floors positive overrides with a 1 ms minimum. */
export interface MailboxPollingTimeoutPolicy {
  /** Abort the HTTP request when no response headers arrive before this deadline. */
  requestOpenTimeoutMs: number;
  /** Stop reading one mailbox SSE response after this long-poll window. */
  maxPollDurationMs: number;
  /** Stop reading one response this long after its last complete event. */
  readIdleTimeoutMs: number;
  /** First wait after a poll that was not served; it doubles per consecutive failure. */
  refusalInitialMs: number;
  /** Longest wait after a poll that was not served. */
  refusalMaxMs: number;
}

/** Waits after polls that were not served, in milliseconds. */
export interface RefusalBackoffPolicy {
  initialMs: number;
  maxMs: number;
}

/** One remote mailbox batch, consumed before its provider cursor advances. */
export interface MailboxPollBatch {
  /**
   * Mailbox subject AID, possibly distinct from the signing member.
   */
  pre: string;
  /**
   * Mailbox provider AID that supplied this batch; distinct from the subject and query signer.
   */
  eid: string;
  /**
   * Complete wire messages passed to the awaited batch consumer in order.
   */
  messages: Uint8Array[];
}

/**
 * Per-attempt header and SSE window settings in milliseconds.
 */
export interface MailboxFetchTimeoutPolicy {
  /**
   * Header acquisition deadline in milliseconds.
   */
  requestOpenTimeoutMs: number;
  /**
   * Absolute SSE read window in milliseconds.
   */
  maxReadDurationMs: number;
  /**
   * Idle read deadline after a complete event, in milliseconds.
   */
  readIdleTimeoutMs: number;
}

/**
 * How one poll ended. `served` is the only outcome that resets the backoff; every other one is a reason to wait.
 * - `served`: the mailbox answered 2xx and its events were consumed (possibly none).
 * - `no-response`: no response headers within the open window.
 * - `unreachable`: the connection failed before or while the response was read (refused, DNS, reset).
 * - `unauthorized`: 403, the mailbox cannot authenticate the requester against the KEL it holds.
 * - `refused`: any other non-success status.
 */
export type PollOutcome = "served" | "no-response" | "unreachable" | "unauthorized" | "refused";

/** One request: its outcome, or the exact pre-intake KERIpy media refusal that asks for a second request. */
type PollAttempt = { kind: "outcome"; outcome: PollOutcome } | { kind: "legacy-media-required" };

/** What the worker carries between polls: the current backoff, zero after a served poll. */
export interface PollState {
  readonly backoffMs: number;
}

/**
 * What the worker does next: poll again after a scheduler turn, wait, or (for a 403) prompt the publisher and
 * then wait.
 */
export type PollAction =
  | { kind: "poll" }
  | { kind: "wait"; ms: number }
  | { kind: "prompt-publisher"; ms: number };

/** Classify a non-success status: 403 is the mailbox not recognising the requester; anything else is a refusal. */
export function classifyPollRefusal(status: number): "unauthorized" | "refused" {
  switch (status) {
    case 403:
      return "unauthorized";
    default:
      return "refused";
  }
}

/** Double the backoff (or start it) and wait that long. */
export function backOff(
  state: PollState,
  backoff: Readonly<RefusalBackoffPolicy> = MailboxPoller.RefusalBackoff,
): { state: PollState; action: PollAction } {
  const backoffMs = Math.min(backoff.maxMs, state.backoffMs ? state.backoffMs * 2 : backoff.initialMs);
  return { state: { backoffMs }, action: { kind: "wait", ms: backoffMs } };
}

/** The transition: where a poll's outcome leaves the worker, and what it does about it. */
export function nextPoll(
  state: PollState,
  outcome: PollOutcome,
  backoff: Readonly<RefusalBackoffPolicy> = MailboxPoller.RefusalBackoff,
): { state: PollState; action: PollAction } {
  switch (outcome) {
    case "served":
      return { state: { backoffMs: 0 }, action: { kind: "poll" } };
    case "unauthorized": {
      const step = backOff(state, backoff);
      return { state: step.state, action: { kind: "prompt-publisher", ms: step.state.backoffMs } };
    }
    case "no-response":
    case "unreachable":
    case "refused":
      return backOff(state, backoff);
  }
}

/**
 * Query one endpoint and consume complete SSE events within one request scope.
 * A header timeout, a failed connection or a non-success status ends this attempt without events. Successful
 * body processing and its cleanup finish before the endpoint worker begins another poll.
 * The sole second request is the exact pre-intake KERIpy media refusal:
 * drain/close that request, then reuse the same signed query and attachments with
 * legacy metadata. Authentication or protocol refusals do not take that branch.
 * consume runs inline and is awaited before the caller persists its cursor; this
 * callback is a scoped event-consumer boundary, not deferred workflow scheduling.
 * A `TransportError` from the connection (opening it or reading its body) is an outcome; a failure of
 * `consume`, cancellation and cleanup failures propagate.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param targetPre Mailbox subject AID; may be a group distinct from hab.
 * @param src Remote mailbox attester AID.
 * @param url Selected HTTP(S) polling endpoint.
 * @param topics Next-wanted ordinals by topic.
 * @param timeouts Header, absolute read and idle windows in milliseconds.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param consume Awaited complete-event consumer; false stops the poll and errors propagate before remote cursor advancement.
 * @returns How the poll ended.
 */
function* fetchMailboxMessages(
  hab: Hab,
  targetPre: string,
  src: string,
  url: string,
  topics: Record<string, number>,
  timeouts: MailboxFetchTimeoutPolicy,
  http: HttpClient,
  clock: RuntimeClock,
  consume: (message: MailboxSseMessage) => Operation<boolean | void>,
): Operation<PollOutcome> {
  const query = hab.query(targetPre, src, { route: "mbx", q: { topics } });
  const prepared = buildCesrRequest(query, { destination: src });
  // A consumer's own TransportError is the consumer's failure, not the mailbox's.
  let consumerFailure: unknown;
  const guarded = function*(message: MailboxSseMessage): Operation<boolean | void> {
    try {
      return yield* consume(message);
    } catch (error) {
      consumerFailure = error;
      throw error;
    }
  };
  const attempt = function*(contentType: string): Operation<PollAttempt> {
    try {
      // Closing a refused request is part of the scoped operation. A close failure escapes before another
      // request can submit these same signed bytes.
      return yield* scoped(function*(): Operation<PollAttempt> {
        const controller = new AbortController();
        const request = {
          method: "POST",
          headers: { ...prepared.headers, "Content-Type": contentType },
          body: prepared.body,
          signal: controller.signal,
        };
        const response = yield* requestWithHeaderTimeout(http, clock, url, request, timeouts.requestOpenTimeoutMs);
        if (!response) return { kind: "outcome", outcome: "no-response" };
        if (!response.ok) {
          const detail = yield* abortable(signal => readResponseDetail(response, signal));
          if (isLegacyCesrMediaRejection(request, response.status, detail)) return { kind: "legacy-media-required" };
          return { kind: "outcome", outcome: classifyPollRefusal(response.status) };
        }
        yield* consumeMailboxSse(response, controller, guarded, clock, {
          idleTimeoutMs: timeouts.readIdleTimeoutMs,
          maxDurationMs: timeouts.maxReadDurationMs,
        });
        return { kind: "outcome", outcome: "served" };
      });
    } catch (error) {
      if (error instanceof TransportError && error !== consumerFailure) {
        return { kind: "outcome", outcome: "unreachable" };
      }
      throw error;
    }
  };
  const first = yield* attempt(CESR_CONTENT_TYPE);
  if (first.kind === "outcome") return first.outcome;
  const second = yield* attempt(KERIPY_CESR_JSON_CONTENT_TYPE);
  return second.kind === "outcome" ? second.outcome : "refused";
}

/**
 * Normalize the caller's polling policy against the existing defaults.
 *
 * @param overrides Optional timeout values; missing/nonpositive/nonfinite values use defaults.
 * @returns Frozen header/poll settings with finite positive inputs floored and clamped to at least 1 ms.
 */
function normalizeMailboxPollingTimeoutPolicy(
  overrides: Partial<MailboxPollingTimeoutPolicy> | undefined,
): Readonly<MailboxPollingTimeoutPolicy> {
  const defaults = MailboxPoller.DefaultTimeoutPolicy;
  return Object.freeze({
    requestOpenTimeoutMs: positiveTimeoutMs(
      overrides?.requestOpenTimeoutMs,
      defaults.requestOpenTimeoutMs,
    ),
    maxPollDurationMs: positiveTimeoutMs(
      overrides?.maxPollDurationMs,
      defaults.maxPollDurationMs,
    ),
    readIdleTimeoutMs: positiveTimeoutMs(overrides?.readIdleTimeoutMs, defaults.readIdleTimeoutMs),
    refusalInitialMs: positiveTimeoutMs(overrides?.refusalInitialMs, defaults.refusalInitialMs),
    refusalMaxMs: positiveTimeoutMs(overrides?.refusalMaxMs, defaults.refusalMaxMs),
  });
}

/**
 * Translate poller windows into the concrete request/SSE settings.
 *
 * @param timeouts Normalized poller policy.
 * @returns Per-attempt windows with the policy's read-idle interval.
 */
function mailboxFetchTimeoutPolicy(
  timeouts: Readonly<MailboxPollingTimeoutPolicy>,
): MailboxFetchTimeoutPolicy {
  return {
    requestOpenTimeoutMs: timeouts.requestOpenTimeoutMs,
    maxReadDurationMs: timeouts.maxPollDurationMs,
    readIdleTimeoutMs: timeouts.readIdleTimeoutMs,
  };
}

/**
 * Normalize a polling duration without turning a positive override into a zero-length window.
 *
 * @param value Optional proposed duration in milliseconds.
 * @param fallback Default used for missing, nonfinite or nonpositive input.
 * @returns Finite positive input floored with a 1 ms minimum; otherwise fallback.
 */
function positiveTimeoutMs(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}
