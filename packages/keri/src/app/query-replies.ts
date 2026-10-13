import { ResourceLimitError } from "cesr-ts";
import type { AgentCue, ReplayCue, ReplyCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";

/** One query's direct reply. Duplicate HTTP requests may share this immutable evidence. */
type DirectReply = ReplayCue | ReplyCue;

/** A bounded request-owned slot; close it when the HTTP request responds or is cancelled. */
export interface QueryReply {
  /** Remove the first matching response, if query processing has produced it. */
  take(): DirectReply | undefined;
  /** Release the reservation and any retained response reference. Safe to repeat. */
  close(): void;
}

/** Reserve direct query replies before any background cue consumer can take them. */
export class QueryReplies {
  /** At most one response reference per active request, grouped by query SAID for fanout. */
  private readonly active = new Map<string, Set<{ reply?: DirectReply }>>();
  /** Current request count, including duplicate SAIDs. */
  private count = 0;

  /** Bound waiting HTTP requests independently of their source-parser lifetimes. */
  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Reply reservation limit must be positive");
  }

  /** Reserve one direct response; repeated replies never grow this request's slot. */
  reserve(said: string): QueryReply {
    if (this.count >= this.limit) throw new ResourceLimitError("Too many pending query replies");
    const slot: { reply?: DirectReply } = {};
    const group = this.active.get(said) ?? new Set();
    group.add(slot);
    this.active.set(said, group);
    this.count++;
    let closed = false;
    return {
      take() {
        const reply = slot.reply;
        slot.reply = undefined;
        return reply;
      },
      close: () => {
        if (closed) return;
        closed = true;
        slot.reply = undefined;
        group.delete(slot);
        if (group.size === 0) this.active.delete(said);
        this.count--;
      },
    };
  }

  /** Transfer reserved responses out of the shared cue deck without copying replay bytes. */
  capture(cues: Deck<AgentCue>): void {
    const count = cues.length;
    for (let i = 0; i < count; i++) {
      const cue = cues.pull()!;
      const group = (cue.kin === "replay" || cue.kin === "reply") && cue.querySaid
        ? this.active.get(cue.querySaid)
        : undefined;
      if (group && (cue.kin === "replay" || cue.kin === "reply")) {
        for (const slot of group) slot.reply ??= cue;
      } else {
        cues.push(cue);
      }
    }
  }
}
