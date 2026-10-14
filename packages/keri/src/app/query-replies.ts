import { ResourceLimitError } from "cesr-ts";
import { CueDeck, type OwnedCue } from "../core/cue-admission.ts";
import type { AgentCue, ReplayCue, ReplyCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";

/** One query's direct reply. Duplicate HTTP requests may share immutable evidence. */
type DirectReply = ReplayCue | ReplyCue;
type Slot = { reply?: DirectReply; companion?: ReplyCue; owners: OwnedCue[] };

/** Borrow a bounded response batch until joined consumption releases its owners. */
interface QueryReplyBatch {
  readonly cues: readonly DirectReply[];
  release(): void;
}

/** A bounded request-owned slot; close it when the HTTP request responds or is cancelled. */
export interface QueryReply {
  /** Compatibility seam for a single ordinary, unadmitted response. */
  take(): DirectReply | undefined;
  /** Transfer at most the ordered TSN pair and its credit into the response/consumer owner. */
  takeAll(): QueryReplyBatch | undefined;
  /** Release untaken references only; a transferred batch owns its own cleanup. Safe to repeat. */
  close(): void;
}

/** Reserve direct query replies before any background cue consumer can take them. */
export class QueryReplies {
  /** One replay or a registry/credential pair per request, grouped by query SAID for fanout. */
  private readonly active = new Map<string, Set<Slot>>();
  private count = 0;

  /** Bound waiting HTTP requests independently of their source-parser lifetimes. */
  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Reply reservation limit must be positive");
  }

  /** Reserve one bounded response; duplicate arrivals never add another retained batch. */
  reserve(said: string): QueryReply {
    if (this.count >= this.limit) throw new ResourceLimitError("Too many pending query replies");
    const slot: Slot = { reply: undefined, companion: undefined, owners: [] };
    const group = this.active.get(said) ?? new Set<Slot>();
    group.add(slot);
    this.active.set(said, group);
    this.count++;
    let closed = false;
    return {
      take() {
        if (slot.companion || slot.owners.length) throw new Error("Paired/admitted replies require batch consumption");
        const reply = slot.reply;
        slot.reply = undefined;
        return reply;
      },
      takeAll() {
        if (!slot.reply) return;
        const cues = slot.companion ? [slot.reply, slot.companion] : [slot.reply];
        const owners = slot.owners;
        slot.reply = slot.companion = undefined;
        slot.owners = [];
        return {
          cues,
          release() {
            for (const owner of owners.splice(0)) owner.release();
            cues.length = 0;
          },
        };
      },
      close: () => {
        if (closed) return;
        closed = true;
        slot.reply = slot.companion = undefined;
        for (const owner of slot.owners.splice(0)) owner.release();
        group.delete(slot);
        if (group.size === 0) this.active.delete(said);
        this.count--;
      },
    };
  }

  /** Capture only a complementary TSN pair; transfer/fanout credit before publishing slot references. */
  capture(cues: Deck<AgentCue>): void {
    const count = cues.length, queued: OwnedCue[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const owner = cues instanceof CueDeck ? cues.takeOwned()! : undefined;
        const cue = owner ? owner.cue : cues.pull()!;
        const group = (cue.kin === "replay" || cue.kin === "reply") && cue.querySaid
          ? this.active.get(cue.querySaid)
          : undefined;
        if (!group || (cue.kin !== "replay" && cue.kin !== "reply")) {
          if (owner) queued.push(owner);
          else cues.push(cue);
          continue;
        }
        const targets = [...group].filter((slot) =>
          !slot.reply || (
            !slot.companion && slot.reply.kin === "reply" && slot.reply.route === "/tsn/registry"
            && cue.kin === "reply" && cue.route === "/tsn/credential"
          )
        );
        const retained: OwnedCue[] = [];
        let ownership: OwnedCue[][] = [];
        try {
          if (owner && targets.length) {
            retained.push(owner);
            for (let j = 1; j < targets.length; j++) retained.push(owner.retain());
            ownership = targets.map((slot, j) => [...slot.owners, retained[j]]);
          }
        } catch (error) {
          for (const copy of retained.slice(1)) copy.release();
          queued.push(owner!);
          throw error;
        }
        for (const [j, slot] of targets.entries()) {
          if (owner) slot.owners = ownership[j];
          if (!slot.reply) slot.reply = cue;
          else slot.companion = cue as ReplyCue;
        }
        if (owner && !targets.length) owner.release();
      }
    } finally {
      if (cues instanceof CueDeck) for (const owner of queued.reverse()) cues.requeue(owner);
    }
  }
}
