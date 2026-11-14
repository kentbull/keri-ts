/**
 * The `logs` query a recipient publishes when an event it holds waits for an issuer KEL event it lacks.
 *
 * Both TEL families use this shape: a recipient asks the issuer's KEL holders for the events from the first one it
 * lacks, up to the anchoring event when that event's sequence number is known. Owners build the query when an event
 * first enters its pending state and publish the cue after the write commits, never per re-processing pass.
 */
import type { QueryCue } from "./cues.ts";

/**
 * Issuer KEL events a pending event is waiting for, as the `fn`/`s` filters of a `logs` query.
 *
 * Both filters are lowercase hexadecimal, as on the query wire.
 */
export interface MissingAnchorQuery {
  /** Issuer whose KEL holds the anchoring seal. */
  pre: string;
  /** Replay start: one past the issuer's accepted sequence number, or 0 when the issuer is unknown. */
  fn: string;
  /** Sequence number the responder must have reached. Absent when no source seal names the anchoring event. */
  s?: string;
}

/**
 * Name the issuer KEL events still missing for a pending event, or null when more KEL cannot supply the anchor.
 *
 * @param pre Issuer whose KEL holds the anchoring seal.
 * @param accepted Sequence number of the issuer's accepted KEL here, or null when the issuer is unknown.
 * @param anchor Sequence number of the anchoring event when a source seal names it, otherwise null.
 * @returns The query, or null when the accepted KEL already reaches a known anchor sequence number: the anchor was
 *   found wanting rather than missing, and replay cannot change that.
 */
export function missingAnchorQuery(
  pre: string,
  accepted: bigint | null,
  anchor: bigint | null,
): MissingAnchorQuery | null {
  if (accepted !== null && anchor !== null && accepted >= anchor) return null;
  const fn = (accepted === null ? 0n : accepted + 1n).toString(16);
  return anchor === null ? { pre, fn } : { pre, fn, s: anchor.toString(16) };
}

/** The routed query cue that asks for `query`; the existing query path sends it. */
export function missingAnchorCue(query: MissingAnchorQuery): QueryCue {
  const { pre, fn, s } = query;
  return { kin: "query", pre, route: "logs", q: s === undefined ? { fn } : { fn, s } };
}
