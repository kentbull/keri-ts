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

/** Consecutive-failure counter with a next-attempt time; memory only. */
export class RetryBackoff {
  /** Consecutive failures since the last success. */
  attempts = 0;
  /** Time of the first failure of the current run (host clock, ms); 0 when none. */
  since = 0;
  /** Error of the latest failure. */
  last: unknown = null;
  #next = 0;

  /** Whether an attempt may be made at `now`. */
  due(now: number): boolean {
    return now >= this.#next;
  }

  /** Record a failure at `now` and schedule the next attempt. */
  failed(now: number, error: unknown): void {
    if (this.attempts === 0) this.since = now;
    this.attempts++;
    this.last = error;
    this.#next = now + Math.min(RETRY_BASE_MS * 2 ** (this.attempts - 1), RETRY_MAX_MS);
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
