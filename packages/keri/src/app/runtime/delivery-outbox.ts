/**
 * Ordered outbox of signed bytes an operation owes its peers, with retry.
 *
 * An operation's steps decide what to send and queue it here; the owner drains the queue each pass. A delivery
 * that fails keeps its message at the head and is retried after a doubling delay ({@link RetryBackoff}), so a peer
 * that is briefly offline delays an operation instead of ending it. The owner decides when retrying stops: an
 * operation with a deadline ends at the deadline, and one without ends once failures have lasted the bound it
 * states. Memory only: the signed messages themselves are durable in the protocol stores.
 */
import type { Operation } from "npm:effection@^3.6.0";
import { DEFAULT_RETRY_POLICY, RetryBackoff, type RetryPolicy } from "./retry-backoff.ts";
import type { RuntimeClock } from "./runtime-clock.ts";

/** One message waiting for delivery. */
export interface Outbound {
  src: string;
  dest: string;
  /** The signed bytes, or a producer called at delivery for a message that must be timely when it leaves (a query). */
  msg: Uint8Array | (() => Uint8Array);
  topic?: string;
}

/** Signed bytes handed to the transport. */
export interface DeliveryMessage {
  src: string;
  dest: string;
  msg: Uint8Array;
  topic?: string;
}

/** Delivery of signed bytes; resolves once the transport reports an outcome and throws when it failed. */
export interface OutboxDelivery {
  deliver(message: DeliveryMessage): Operation<string[]>;
}

/** Why the head delivery is being retried; part of an active operation's status. */
export interface DeliveryFailure {
  /** Consecutive failures of the head message. */
  attempts: number;
  /** The error's message followed by its `cause` chain, joined with " <- ". */
  reason: string;
  /** When the next attempt is due (ISO 8601). */
  retryAt: string;
}

/** Flatten an error and its `cause` chain to one line of text, so a reader sees the transport's own reason. */
export function describeFailure(error: unknown): string {
  const parts: string[] = [];
  for (let e = error, depth = 0; e !== undefined && e !== null && depth < 8; depth++) {
    parts.push(e instanceof Error ? (e.message || e.name) : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(" <- ");
}

/** The queue and its retry state for one live operation. */
export class DeliveryOutbox {
  private readonly queue: Outbound[] = [];
  private readonly backoff: RetryBackoff;
  /** Destinations the transport reported for everything delivered so far. */
  readonly delivered: string[] = [];

  constructor(policy: Readonly<RetryPolicy> = DEFAULT_RETRY_POLICY) {
    this.backoff = new RetryBackoff(policy);
  }

  /** Messages still waiting. */
  get length(): number {
    return this.queue.length;
  }

  /** Consecutive delivery failures of the head message. */
  get attempts(): number {
    return this.backoff.attempts;
  }

  /** The latest delivery error, or null. */
  get lastError(): unknown {
    return this.backoff.last;
  }

  /** The retry state of the head message, or null while nothing is failing. */
  get failure(): DeliveryFailure | null {
    return this.backoff.attempts === 0
      ? null
      : {
        attempts: this.backoff.attempts,
        reason: describeFailure(this.backoff.last),
        retryAt: new Date(this.backoff.next).toISOString(),
      };
  }

  /** Queue a message behind the others. */
  enqueue(message: Outbound): void {
    this.queue.push(message);
  }

  /**
   * Deliver the queued messages in order. A failure keeps the message and schedules a retry; it throws only when
   * `boundMs` is given and failures have lasted that long.
   *
   * @returns True when the queue is empty, false while a message waits for its retry.
   */
  *drain(transport: OutboxDelivery, clock: RuntimeClock, boundMs?: number): Operation<boolean> {
    while (this.queue.length) {
      const now = clock.now();
      if (!this.backoff.due(now)) return false;
      try {
        const { src, dest, msg, topic } = this.queue[0];
        this.delivered.push(
          ...yield* transport.deliver({ src, dest, msg: typeof msg === "function" ? msg() : msg, topic }),
        );
        this.queue.shift();
        this.backoff.succeeded();
      } catch (error) {
        this.backoff.failed(now, error);
        if (boundMs !== undefined && this.backoff.exhausted(now, boundMs)) throw error;
        return false;
      }
    }
    return true;
  }
}
