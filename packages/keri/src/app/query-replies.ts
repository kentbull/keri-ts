import type { AgentCue } from "../core/cues.ts";
import type { ReceiptCue, ReplayCue, ReplyCue, WitnessCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";

/** One request's direct proof/reply. Duplicate requests may share immutable evidence. */
type DirectReply = ReplayCue | ReplyCue | ReceiptCue | WitnessCue;
/**
 * One request's retained evidence and optional readiness observer.
 * The first reply may gain one ordered companion; duplicate requests have separate
 * slots while sharing the same immutable cue records.
 */
type Slot = { reply?: DirectReply; companion?: DirectReply; notify?: () => void };

/** One correlated response or ordered protocol pair. */
interface QueryReplyBatch {
  readonly cues: readonly DirectReply[];
}

/** A request correlation slot; close it when its HTTP/TCP request completes or is cancelled. */
export interface QueryReply {
  /**
   * Observe this existing slot without queues or retained Promise waiters; one observer at a time.
   *
   * @param notify Synchronous wake-up callback, including already-ready/closed state.
   * @returns Unsubscribe function; cancellation must call it.
   */
  observeReady(notify: () => void): () => void;
  /** Whether a captured batch is available for request-owned consumption. */
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
  /**
   * Borrow the application output flow so a late request claims matching queued replies synchronously.
   *
   * @param published Borrowed application cue Deck, synchronously scanned when a late request reserves a slot.
   */
  constructor(private readonly published: Deck<AgentCue>) {}

  /**
   * Reserve one response; duplicate arrivals never add another retained batch.
   *
   * @param said Query SAID used for correlation, never sufficient proof of request authorization.
   * @returns A new request-owned slot; close it on request completion/cancellation.
   */
  reserve(said: string): QueryReply {
    return this.reserveKey(`query:${said}`);
  }

  /**
   * A connection owns only receipts for its exact event; unrelated runtime cues stay routed normally.
   *
   * @param pre Subject event AID.
   * @param said Exact event SAID whose receipt/witness output belongs to the connection.
   * @returns A request-owned event-proof slot.
   */
  reserveEvent(pre: string, said: string): QueryReply {
    return this.reserveKey(`event:${pre}:${said}`);
  }

  /**
   * Reuse the request slot for queries and accepted-event proofs.
   *
   * @param said Internal query:/event: correlation key.
   * @returns An independent slot, immediately capturing any already-published matching output.
   */
  private reserveKey(said: string): QueryReply {
    const slot: Slot = { reply: undefined, companion: undefined };
    const group = this.active.get(said) ?? new Set<Slot>();
    group.add(slot);
    this.active.set(said, group);
    let closed = false;
    this.capture(this.published);
    return {
      /**
       * Expose whether this request has captured evidence.
       *
       * @returns True when a first reply is retained; does not itself authorize the request.
       */
      get ready() {
        return slot.reply !== undefined;
      },
      /**
       * Install the sole readiness observer for this slot.
       *
       * @param notify Synchronous wake-up callback; invoked immediately if ready or closed.
       * @returns A function removing this observer without closing the request slot.
       */
      observeReady(notify) {
        if (slot.notify) throw new Error("Reply slot already has a readiness observer");
        slot.notify = notify;
        if (slot.reply || closed) notify();
        return () => {
          if (slot.notify === notify) slot.notify = undefined;
        };
      },
      /**
       * Inspect evidence without consuming it so callers can finish construction first.
       *
       * @returns Borrowed ordered cue batch, or undefined without a first reply.
       */
      peekAll() {
        if (!slot.reply) return;
        return { cues: slot.companion ? [slot.reply, slot.companion] : [slot.reply] };
      },
      /**
       * Consume this slot only after its caller has prepared the complete output.
       *
       * @returns Current batch, clearing this slot's retained references.
       */
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

  /**
   * Capture correlated reply pairs and share their ordinary records among matching requests.
   *
   * @param source Cue Deck to scan through its initial extent; unmatched cues retain their order.
   */
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
