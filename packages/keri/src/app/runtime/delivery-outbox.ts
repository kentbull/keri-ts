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
import { RetryBackoff } from "./retry-backoff.ts";
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

/** The queue and its retry state for one live operation. */
export class DeliveryOutbox {
  private readonly queue: Outbound[] = [];
  private readonly backoff = new RetryBackoff();
  /** Destinations the transport reported for everything delivered so far. */
  readonly delivered: string[] = [];

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
