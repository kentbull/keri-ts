import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { Poster, RawCesrRoute } from "./forwarding.ts";
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
  private readonly poster: Poster;
  private readonly replyStreams: ReplyStreams;

  constructor(
    hby: Habery,
    {
      poster,
      replyStreams,
    }: {
      poster: Poster;
      replyStreams: ReplyStreams;
    },
  ) {
    this.hby = hby;
    this.poster = poster;
    this.replyStreams = replyStreams;
  }

  /** Interpret and route a source head before removing it; failed preparation leaves it visible. */
  enqueueCue(interpreter: Hab, source: Deck<AgentCue>, hint?: Hab | null): boolean {
    this.poster.assertOpen();
    const cue = source.peekHead();
    if (!cue) return false;
    const recipient = recipientForCue(cue), topic = topicForCue(cue);
    const sender = senderHabForCue(this.hby, cue, hint);
    if (!recipient || !topic || !sender) return false;
    const emission = interpreter.interpretCue(cue);
    if (emission?.kind !== "wire") throw new RangeError("Cue delivery requires wire");
    const route = this.poster.findBytesRoute(sender, { recipient, recipientIsPrefix: true, topic });
    if (route?.targets.length) {
      this.poster.enqueueReplies([{ emission, hab: sender, route }]);
    }
    source.pull();
    return true;
  }

  /** Queue an already interpreted witness emission without reopening or signing its messages. */
  enqueueEmission(hab: Hab, emission: CueEmission): void {
    this.poster.assertOpen();
    const route = this.routeForEmission(emission, hab);
    if (route?.targets.length) {
      const sender = this.hby.habs.get(route.sender) ?? hab;
      this.poster.enqueueReplies([{ emission, hab: sender, route }]);
    }
  }

  /** Prepare the whole correlated batch before publishing either its HTTP reader or queued destinations. */
  openReply(hab: Hab, reply: QueryReply): ReadableStream<Uint8Array> | null {
    this.poster.assertOpen();
    const captured = reply.peekAll();
    if (!captured) return null;
    const { emissions, cues } = this.interpretReplies(hab, captured.cues);
    const stream = this.replyStreams.open({
      *[Symbol.iterator]() {
        for (const emission of emissions) yield* emission.messages;
      },
    });
    if (cues.length) this.poster.enqueueReplies(cues);
    reply.takeAll();
    return stream;
  }

  /** Earlier queries transfer to ordinary queued replies without an HTTP response reader. */
  enqueueReply(hab: Hab, reply: QueryReply): boolean {
    this.poster.assertOpen();
    const captured = reply.peekAll();
    if (!captured) return false;
    const { cues } = this.interpretReplies(hab, captured.cues);
    if (cues.length) this.poster.enqueueReplies(cues);
    reply.takeAll();
    return true;
  }

  private interpretReplies(
    hab: Hab,
    replies: readonly AgentCue[],
  ): { emissions: CueEmission[]; cues: { emission: CueEmission; hab: Hab; route: RawCesrRoute }[] } {
    const emissions: CueEmission[] = [], cues: { emission: CueEmission; hab: Hab; route: RawCesrRoute }[] = [];
    for (const cue of replies) {
      const emission = hab.interpretCue(cue);
      if (emission?.kind !== "wire") throw new RangeError("Direct reply requires wire");
      emissions.push(emission);
      const sender = ("src" in cue && cue.src ? this.hby.habs.get(cue.src) : undefined) ?? hab;
      const route = "dest" in cue && cue.dest
        ? this.poster.findBytesRoute(sender, {
          recipient: cue.dest,
          recipientIsPrefix: true,
          topic: cue.kin === "replay" ? "/replay" : "/reply",
        })
        : null;
      if (route?.targets.length) cues.push({ emission, hab: sender, route });
    }
    return { emissions, cues };
  }

  /** Resolve the existing responder policy for an admitted witness emission without sending or signing again. */
  private routeForEmission(emission: CueEmission, hab?: Hab | null): RawCesrRoute | null {
    const recipient = recipientForCue(emission.cue), topic = topicForCue(emission.cue);
    const sender = senderHabForCue(this.hby, emission.cue, hab);
    if (emission.kind !== "wire" || !recipient || !topic || !sender) return null;
    return this.poster.findBytesRoute(sender, { recipient, recipientIsPrefix: true, topic });
  }
}

/** Select the existing mailbox topic for a responder cue. */
function topicForCue(
  cue: CueEmission["cue"],
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
  cue: CueEmission["cue"],
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
  cue: CueEmission["cue"],
  hab?: Hab | null,
): Hab | null {
  const source = cueSourcePrefix(cue);
  if (source) {
    return hby.habs.get(source) ?? hab ?? soleHab(hby);
  }
  return hab ?? soleHab(hby);
}

function cueSourcePrefix(
  cue: CueEmission["cue"],
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
