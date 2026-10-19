import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { Poster, PosterEvent } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { QueryReply } from "./query-replies.ts";
import type { ReplyStreams } from "./reply-streams.ts";

/**
 * Shared host-side responder for indirect and witness runtimes.
 *
 * KERIpy correspondence:
 * - this is the local analogue of `Respondant` for reply/replay/receipt-style
 *   cues
 * - `BaseHab.processCuesIter()` interprets the cue; `Poster` delivers the
 *   resulting bytes
 * - mailbox-query `stream` cues stay with mailbox storage/query coordination
 *
 * Boundary rule:
 * - this class owns non-`stream` cue production and reply capture
 * - `MailboxDirector` owns mailbox storage and `stream` cue correlation
 * - if a future change starts treating generic `reply` / `replay` /
 *   `receipt`-family cues as local mailbox writes, that change is regressing
 *   back toward the bug where mailbox code was incorrectly acting like
 *   KERIpy's `Respondant`
 */
export class Respondant {
  private readonly hby: Habery;
  private readonly postman: Poster;
  private readonly replyStreams: ReplyStreams;

  constructor(
    hby: Habery,
    {
      postman,
      replyStreams,
    }: {
      postman: Poster;
      replyStreams: ReplyStreams;
    },
  ) {
    this.hby = hby;
    this.postman = postman;
    this.replyStreams = replyStreams;
  }

  /** Produce a whole cue before publishing or removing it; construction failure leaves the source visible. */
  enqueueCue(hab: Hab, cues: Deck<AgentCue>, hint?: Hab | null): boolean {
    this.postman.assertOpen();
    const cue = cues.peekHead();
    if (!cue) return false;
    const dest = recipientForCue(cue), topic = topicForCue(cue);
    const src = senderHabForCue(this.hby, cue, hint);
    if (!dest || !topic || !src) return false;
    const msgs = [...hab.processCuesIter([cue])];
    this.postman.sendAll(msgs.map((msg) => ({ src: src.pre, dest, topic, msg, replies: true })));
    cues.pull();
    return true;
  }

  /** Admit already produced witness messages without signing them again. */
  enqueueMsgs(hab: Hab, cue: AgentCue, msgs: readonly Uint8Array[]): void {
    this.postman.assertOpen();
    const dest = recipientForCue(cue), topic = topicForCue(cue);
    const src = senderHabForCue(this.hby, cue, hab);
    if (!dest || !topic || !src) return;
    this.postman.sendAll(msgs.map((msg) => ({ src: src.pre, dest, topic, msg, replies: true })));
  }

  /** Construct the complete correlated pair before publishing its independent HTTP and queued deliveries. */
  openReply(hab: Hab, reply: QueryReply): ReadableStream<Uint8Array> | null {
    this.postman.assertOpen();
    const captured = reply.peekAll();
    if (!captured) return null;
    const { msgs, evts } = this.prepareReplies(hab, captured.cues);
    const stream = this.replyStreams.open(msgs);
    this.postman.sendAll(evts);
    reply.takeAll();
    return stream;
  }

  /** Earlier queries transfer to ordinary queued replies without an HTTP response reader. */
  enqueueReply(hab: Hab, reply: QueryReply): boolean {
    this.postman.assertOpen();
    const captured = reply.peekAll();
    if (!captured) return false;
    const { evts } = this.prepareReplies(hab, captured.cues);
    this.postman.sendAll(evts);
    reply.takeAll();
    return true;
  }

  private prepareReplies(hab: Hab, cues: readonly AgentCue[]): { msgs: Uint8Array[]; evts: PosterEvent[] } {
    const msgs: Uint8Array[] = [], evts: PosterEvent[] = [];
    for (const cue of cues) {
      const produced = [...hab.processCuesIter([cue])];
      for (const msg of produced) msgs.push(msg);
      const src = ("src" in cue && cue.src ? this.hby.habs.get(cue.src) : undefined) ?? hab;
      const dest = "dest" in cue ? cue.dest : undefined;
      if (!dest) continue;
      const topic = cue.kin === "replay" ? "/replay" : "/reply";
      const pending = produced.map((msg) => ({ src: src.pre, dest, topic, msg, replies: true }));
      // Direct HTTP readers remain available even when the requester has no outbound route.
      if (pending.length && this.postman.canDeliver(pending[0])) {
        for (const evt of pending) evts.push(evt);
      }
    }
    return { msgs, evts };
  }
}

/** Select the existing mailbox topic for a responder cue. */
function topicForCue(
  cue: AgentCue,
): string | null {
  switch (cue.kin) {
    case "replay":
      return "/replay";
    case "reply":
      return "/reply";
    case "receipt":
    case "witness":
      return "/receipt";
    default:
      return null;
  }
}

/** Select the intended recipient without preparing or transmitting bytes. */
function recipientForCue(
  cue: AgentCue,
): string | null {
  switch (cue.kin) {
    case "replay":
      return cue.dest ?? null;
    case "reply":
      return cue.dest ?? null;
    case "receipt":
    case "witness":
      return cue.serder.pre ?? null;
    default:
      return null;
  }
}

/** Borrow the local sender selected by cue provenance, explicit hint or sole habitat. */
function senderHabForCue(
  hby: Habery,
  cue: AgentCue,
  hab?: Hab | null,
): Hab | null {
  const source = cueSourcePrefix(cue);
  if (source) {
    return hby.habs.get(source) ?? hab ?? soleHab(hby);
  }
  return hab ?? soleHab(hby);
}

function cueSourcePrefix(
  cue: AgentCue,
): string | null {
  switch (cue.kin) {
    case "replay":
      return cue.src ?? null;
    case "reply":
      return cue.src ?? null;
    default:
      return null;
  }
}

function soleHab(hby: Habery): Hab | null {
  const habitats = hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}
