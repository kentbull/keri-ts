/**
 * Resend schedule for a group's threshold DH or Unblind query.
 *
 * A single signer re-dates every resend (`Dhke.requery`, `Unblind.requery`), so a resend is a new query the peer's
 * KRAM accepts. A group cannot: re-dating needs the members' signatures, so the frozen query is resent as the same
 * bytes. The peer's KRAM drops identical copies cheaply only while its replay cache row lives, and once the query's
 * `dt` is older than the multi-key acceptance window it refuses every copy as untimely. This schedule therefore
 * backs off and stops resending an unchanged query when the peer can no longer accept it. It never ends the
 * operation: the owner keeps waiting until its own deadline, exactly as before.
 */
import { parseBytes, type SerderKERI } from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import { timestampMicros } from "../time/mod.ts";

/** Milliseconds between the first resends of a query, and the shortest gap a receiver re-sends a stored reply. */
export const QUERY_RESEND_MS = 1000;

/** The longest gap the backoff reaches, in milliseconds. */
export const QUERY_RESEND_CAP_MS = 8000;

/** One group operation's frozen threshold query and when it may next be sent; memory only. */
export class ThresholdQueryResend {
  /** The frozen signed query, unchanged on every resend; absent until the members' contributions complete it. */
  query?: Uint8Array;
  private queryAt = 0;
  private next = 0;
  private wait = 0;

  /** Take the frozen query and restart the schedule; its own `dt` is what the acceptance window is measured from. */
  set(query: Uint8Array): void {
    const body = parseBytes(query)[0]?.body as SerderKERI | undefined;
    const micros = timestampMicros(body?.sad?.dt);
    if (micros === null) throw new ValidationError("Threshold query has no valid date");
    this.query = query;
    this.queryAt = Number(micros / 1000n);
    this.next = 0;
    this.wait = 0;
  }

  /** Whether a query is frozen and the running gap has elapsed at `now` (epoch ms). */
  ready(now: number): boolean {
    return !!this.query && now >= this.next;
  }

  /**
   * Whether the query is still younger than `windowMs` at `now`; past it a receiver can no longer accept the
   * unchanged query, so it is not sent again. A null window (this store never ran KRAM) never closes.
   */
  fresh(now: number, windowMs: number | null): boolean {
    return windowMs === null || now - this.queryAt < windowMs;
  }

  /** Record a send at `now`: the next gap doubles from `baseMs` up to {@link QUERY_RESEND_CAP_MS}. */
  sent(now: number, baseMs: number): void {
    this.wait = this.wait ? Math.max(baseMs, Math.min(this.wait * 2, QUERY_RESEND_CAP_MS)) : baseMs;
    this.next = now + this.wait;
  }
}
