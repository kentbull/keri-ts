/**
 * Retry state for a transient delivery failure inside a live operation.
 *
 * A member that is briefly offline is normal, so an owner keeps the unsent work, waits with a doubling delay and
 * tries again on a later pass instead of ending the operation at the first error. The owner decides when retrying
 * stops: an operation with a deadline ends at the deadline, and one without ends once failures have lasted the
 * bound it states.
 */

/** Delay after the first failure; it doubles per consecutive failure up to {@link RETRY_MAX_MS}. */
export const RETRY_BASE_MS = 1_000;
/** Longest delay between attempts. */
export const RETRY_MAX_MS = 30_000;
/** How long failures may last before an owner with no deadline of its own gives up. */
export const RETRY_BOUND_MS = 600_000;

/**
 * How long a retried action waits: it starts at `baseMs`, doubles per consecutive failure up to `maxMs`, and an
 * owner that gives up does so once failures have lasted `boundMs`. Owners that never give up ignore the bound.
 * Milliseconds; a test passes small values.
 */
export interface RetryPolicy {
  baseMs: number;
  maxMs: number;
  boundMs: number;
}

/** The production delays of delivery retries. */
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
  baseMs: RETRY_BASE_MS,
  maxMs: RETRY_MAX_MS,
  boundMs: RETRY_BOUND_MS,
});

/** Consecutive-failure counter with a next-attempt time; memory only. */
export class RetryBackoff {
  /** Consecutive failures since the last success. */
  attempts = 0;
  /** Time of the first failure of the current run (host clock, ms); 0 when none. */
  since = 0;
  /** Error of the latest failure. */
  last: unknown = null;
  #next = 0;

  constructor(private readonly policy: Readonly<RetryPolicy> = DEFAULT_RETRY_POLICY) {}

  /** Host-clock time (ms) of the next attempt. */
  get next(): number {
    return this.#next;
  }

  /** Whether an attempt may be made at `now`. */
  due(now: number): boolean {
    return now >= this.#next;
  }

  /** Record a failure at `now` and schedule the next attempt. */
  failed(now: number, error: unknown): void {
    if (this.attempts === 0) this.since = now;
    this.attempts++;
    this.last = error;
    this.#next = now + Math.min(this.policy.baseMs * 2 ** (this.attempts - 1), this.policy.maxMs);
  }

  /** Whether failures have lasted at least `boundMs` by `now`. */
  exhausted(now: number, boundMs: number): boolean {
    return this.attempts > 0 && now - this.since >= boundMs;
  }

  /** Forget failures after a success. */
  succeeded(): void {
    this.attempts = 0;
    this.since = 0;
    this.last = null;
    this.#next = 0;
  }
}
