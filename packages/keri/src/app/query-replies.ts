import type { AgentCue } from "../core/cues.ts";
import type { ReceiptCue, ReplayCue, ReplyCue, WitnessCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";

/** One request's direct proof/reply. Duplicate requests may share immutable evidence. */
type DirectReply = ReplayCue | ReplyCue | ReceiptCue | WitnessCue;
type Slot = { reply?: DirectReply; companion?: DirectReply; notify?: () => void };

/** One correlated response or ordered protocol pair. */
interface QueryReplyBatch {
  readonly cues: readonly DirectReply[];
}

/** A request correlation slot; close it when its HTTP/TCP request completes or is cancelled. */
export interface QueryReply {
  /** Observe this existing slot without queues or retained Promise waiters; one observer at a time. */
  observeReady(notify: () => void): () => void;
  /** Whether a captured batch is available for guarded consumption. */
  readonly ready: boolean;
  /** Take the receipt/witness or ordered TSN pair. */
  takeAll(): QueryReplyBatch | undefined;
  /** Inspect the current ordered batch without removing its correlation records. */
  peekAll(): QueryReplyBatch | undefined;
  /** Remove this request from correlation and discard untaken records. Safe to repeat. */
  close(): void;
}

/** Reserve direct query replies before any background cue consumer can take them. */
export class QueryReplies {
  /** One replay or a registry/credential pair per request, grouped by query SAID for fanout. */
  private readonly active = new Map<string, Set<Slot>>();
  /** Reserve one response; duplicate arrivals never add another retained batch. */
  reserve(said: string): QueryReply {
    return this.reserveKey(`query:${said}`);
  }

  /** A connection owns only receipts for its exact event; unrelated runtime cues stay routed normally. */
  reserveEvent(pre: string, said: string): QueryReply {
    return this.reserveKey(`event:${pre}:${said}`);
  }

  /** Reuse the request slot for queries and accepted-event proofs. */
  private reserveKey(said: string): QueryReply {
    const slot: Slot = { reply: undefined, companion: undefined };
    const group = this.active.get(said) ?? new Set<Slot>();
    group.add(slot);
    this.active.set(said, group);
    let closed = false;
    return {
      get ready() {
        return slot.reply !== undefined;
      },
      observeReady(notify) {
        if (slot.notify) throw new Error("Reply slot already has a readiness observer");
        slot.notify = notify;
        if (slot.reply || closed) notify();
        return () => {
          if (slot.notify === notify) slot.notify = undefined;
        };
      },
      peekAll() {
        if (!slot.reply) return;
        return { cues: slot.companion ? [slot.reply, slot.companion] : [slot.reply] };
      },
      takeAll() {
        const batch = this.peekAll();
        slot.reply = slot.companion = undefined;
        return batch;
      },
      close: () => {
        if (closed) return;
        closed = true;
        slot.reply = slot.companion = undefined;
        group.delete(slot);
        if (group.size === 0) this.active.delete(said);
        slot.notify?.();
        slot.notify = undefined;
      },
    };
  }

  /** Capture correlated reply pairs and share their ordinary records among matching requests. */
  capture(source: Deck<AgentCue>): void {
    const count = source.length;
    for (let i = 0; i < count; i++) {
      const cue = source.pull()!;
      const group = (cue.kin === "replay" || cue.kin === "reply") && cue.querySaid
        ? this.active.get(`query:${cue.querySaid}`)
        : (cue.kin === "receipt" || cue.kin === "witness")
        ? this.active.get(`event:${cue.serder.pre}:${cue.serder.said}`)
        : undefined;
      if (!group || (cue.kin !== "replay" && cue.kin !== "reply" && cue.kin !== "receipt" && cue.kin !== "witness")) {
        source.push(cue);
        continue;
      }
      for (const slot of [...group]) {
        if (!slot.reply) slot.reply = cue;
        else if (
          !slot.companion && (
            slot.reply.kin === "reply" && slot.reply.route === "/tsn/registry"
              && cue.kin === "reply" && cue.route === "/tsn/credential"
            || slot.reply.kin === "receipt" && cue.kin === "witness"
          )
        ) slot.companion = cue;
        else continue;
        slot.notify?.();
      }
    }
  }
}
