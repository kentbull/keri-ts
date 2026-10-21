/** Recipient mailbox polling: signed queries, awaited SSE intake and persisted cursor progression. */
import { call, type Operation, scoped, spawn, type Task } from "npm:effection@^3.6.0";
import type { Hab, Habery } from "../identity/habbing.ts";
import { abortable } from "../runtime/abortable.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { runtimeTurn } from "../runtime/runtime-turn.ts";
import { isLegacyCesrMediaRejection, readResponseDetail } from "../transport/cesr-egress.ts";
import { buildCesrRequest, CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE } from "../transport/cesr-http.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { requestWithHeaderTimeout } from "../transport/httping.ts";
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
}

/**
 * Retrieve recipient messages from remote mailbox or witness endpoints over HTTP/SSE.
 *
 * Each endpoint has an independent worker and durable progress in the director.
 * Retrieved records are lent to the awaited consumer; protocol intake stays outside.
 * A provider store in the same runtime is never scanned for local recipient input.
 */
export class MailboxPoller {
  /**
   * Default header acquisition (5 seconds) and absolute poll window (30 seconds).
   */
  static readonly DefaultTimeoutPolicy: Readonly<MailboxPollingTimeoutPolicy> = Object.freeze({
    requestOpenTimeoutMs: 5_000,
    maxPollDurationMs: 30_000,
  });
  /**
   * Idle read window after the first complete event, in milliseconds.
   */
  static readonly ReadIdleTimeoutMs = 500;

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

  /**
   * Bind polling inputs and dependencies without starting workers or acquiring stores.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param mailboxDirector Borrowed provider/topic/cursor owner.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   * @param options Optional timeout overrides; finite positive values are floored with a 1 ms minimum. Missing/nonpositive/nonfinite values use 5-second headers and 30-second poll windows.
   */
  constructor(
    hby: Habery,
    mailboxDirector: MailboxDirector,
    http: HttpClient,
    clock: RuntimeClock,
    options: MailboxPollerOptions = {},
  ) {
    const { timeouts } = options;
    this.hby = hby;
    this.mailboxDirector = mailboxDirector;
    this.timeoutPolicy = normalizeMailboxPollingTimeoutPolicy(timeouts);
    this.http = http;
    this.clock = clock;
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
  ): Operation<never> {
    const remoteWorkers = new Map<string, Task<void>>();

    try {
      while (true) {
        const topics = this.mailboxDirector.registeredTopics();
        yield* this.syncRemoteWorkers(remoteWorkers, onBatch, topics);

        yield* runtimeTurn();
      }
    } finally {
      for (const task of [...remoteWorkers.values()].reverse()) {
        yield* task.halt();
      }
    }
  }

  /**
   * Stream one remote response through its consumer before recording cursor progress.
   *
   * @param target Mailbox subject habitat plus the actual local signer (a member for groups).
   * @param endpoint Selected remote endpoint AID and HTTP(S) URL.
   * @param onBatch Awaited consumer; successful completion precedes durable cursor advancement.
   */
  private *pollRemoteEndpointOnce(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<void> {
    const cursor = this.mailboxDirector.remoteQueryCursor(target.targetPre, endpoint.eid);
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    // The concrete HTTP/SSE operation owns and joins this whole poll attempt.
    yield* call(() =>
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
   */
  private *syncRemoteWorkers(
    remoteWorkers: Map<string, Task<void>>,
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
    topics: readonly string[],
  ): Operation<void> {
    const active = new Set<string>();
    if (topics.length > 0) {
      for (const target of this.remotePollTargets()) {
        for (const endpoint of mailboxPollEndpoints(target.hab)) {
          const workerKey = `${target.targetPre}:${endpoint.key}`;
          active.add(workerKey);
          if (remoteWorkers.has(workerKey)) {
            continue;
          }

          const task = yield* spawn(() => this.remoteEndpointWorker(target, endpoint, onBatch));
          remoteWorkers.set(workerKey, task);
        }
      }
    }

    for (const [workerKey, task] of [...remoteWorkers.entries()]) {
      if (active.has(workerKey)) {
        continue;
      }
      yield* task.halt();
      remoteWorkers.delete(workerKey);
    }
  }

  /**
   * Poll one remote endpoint continuously in the long-lived runtime shape.
   *
   * This keeps KERIpy's "one poller per endpoint" behavior while preserving
   * `keri-ts`'s split between mailbox transport and runtime parser ownership.
   *
   * @param target Mailbox subject habitat plus the actual local signer (a member for groups).
   * @param endpoint Selected remote endpoint AID and HTTP(S) URL.
   * @param onBatch Awaited consumer; successful completion precedes durable cursor advancement.
   */
  private *remoteEndpointWorker(
    target: MailboxPollTarget,
    endpoint: { eid: string; url: string },
    onBatch: (batch: MailboxPollBatch) => void | Operation<void>,
  ): Operation<never> {
    while (true) {
      yield* this.pollRemoteEndpointOnce(target, endpoint, onBatch);
      yield* runtimeTurn();
    }
  }

  /**
   * Select locally pollable subjects without substituting the group for its member signer.
   *
   * @returns Local subject/signing pairs; groups without an available local member are omitted.
   */
  private remotePollTargets(): MailboxPollTarget[] {
    const targets: MailboxPollTarget[] = [];
    for (const hab of this.hby.habs.values()) {
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
 * Query one endpoint and consume complete SSE events within one request scope.
 * Header timeout or non-success status ends this attempt without events. Successful
 * body processing and its cleanup finish before the endpoint worker begins another poll.
 * The sole alternate submission is the exact pre-intake KERIpy media refusal:
 * drain/close that request, then reuse the same signed query and attachments with
 * legacy metadata. Authentication or protocol refusals do not take that branch.
 * consume runs inline and is awaited before the caller persists its cursor; this
 * callback is a scoped event-consumer boundary, not deferred workflow scheduling.
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
): Operation<void> {
  const query = hab.query(targetPre, src, { route: "mbx", q: { topics } });
  const prepared = buildCesrRequest(query, { destination: src });
  for (const contentType of [CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE]) {
    const alternate = yield* scoped(function*() {
      const controller = new AbortController();
      const request = {
        method: "POST",
        headers: { ...prepared.headers, "Content-Type": contentType },
        body: prepared.body,
        signal: controller.signal,
      };
      const response = yield* requestWithHeaderTimeout(http, clock, url, request, timeouts.requestOpenTimeoutMs);
      if (!response) return false;
      if (!response.ok) {
        const detail = yield* abortable(signal => readResponseDetail(response, signal));
        return isLegacyCesrMediaRejection(request, response.status, detail);
      }
      yield* consumeMailboxSse(response, controller, consume, clock, {
        idleTimeoutMs: timeouts.readIdleTimeoutMs,
        maxDurationMs: timeouts.maxReadDurationMs,
      });
      return false;
    });
    // Closing the refused request is part of the scoped operation above. A close
    // failure escapes before another request can submit these same signed bytes.
    if (!alternate) return;
  }
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
  });
}

/**
 * Translate poller windows into the concrete request/SSE settings.
 *
 * @param timeouts Normalized poller policy.
 * @returns Per-attempt windows with the fixed 500 ms read-idle interval.
 */
function mailboxFetchTimeoutPolicy(
  timeouts: Readonly<MailboxPollingTimeoutPolicy>,
): MailboxFetchTimeoutPolicy {
  return {
    requestOpenTimeoutMs: timeouts.requestOpenTimeoutMs,
    maxReadDurationMs: timeouts.maxPollDurationMs,
    readIdleTimeoutMs: MailboxPoller.ReadIdleTimeoutMs,
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
