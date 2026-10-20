import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { Poster, PosterMsg } from "./forwarding.ts";
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
  /** Borrowed local signer and accepted-state collection. */
  private readonly hby: Habery;
  /** Delivery owner; source cues are consumed only after its admission succeeds. */
  private readonly postman: Poster;
  /** Request-owned HTTP response readers, independent of queued delivery. */
  private readonly replyStreams: ReplyStreams;

  /**
   * Bind production dependencies without acquiring transport or store lifetimes.
   *
   * @param hby Borrowed local habitat collection and accepted-state database.
   * @param dependencies Borrowed postman delivery owner and replyStreams response-reader owner.
   */
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

  /**
   * Produce a whole cue before publishing or removing it; construction failure leaves the source visible.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param cues Source Deck; only its current head is interpreted, and removed after full publication.
   * @param hint Optional local sender hint used when cue provenance does not resolve a habitat.
   * @returns True after complete admission/removal; false if the head has no routable responder output.
   * @throws Construction/admission failures leave the source cue present.
   */
  enqueueCue(hab: Hab, cues: Deck<AgentCue>, hint?: Hab | null): boolean {
    this.postman.ensureOpen();
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

  /**
   * Admit already produced witness messages without signing them again.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param cue Routing/provenance cue for the already-signed output.
   * @param msgs Complete signed messages; Poster copies them during atomic admission.
   */
  enqueueMsgs(hab: Hab, cue: AgentCue, msgs: readonly Uint8Array[]): void {
    const dest = recipientForCue(cue), topic = topicForCue(cue);
    const src = senderHabForCue(this.hby, cue, hab);
    if (!dest || !topic || !src) return;
    this.postman.sendAll(msgs.map((msg) => ({ src: src.pre, dest, topic, msg, replies: true })));
  }

  /**
   * Construct the complete correlated pair before publishing its independent HTTP and queued deliveries.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param reply Borrowed request correlation; inspect all cues before taking any of them.
   * @returns Request-owned response stream, or null if no captured batch exists.
   * @throws Construction/admission errors propagate before correlation consumption.
   */
  openReply(hab: Hab, reply: QueryReply): ReadableStream<Uint8Array> | null {
    this.postman.ensureOpen();
    const captured = reply.peekAll();
    if (!captured) return null;
    const { msgs, evts } = this.prepareReplies(hab, captured.cues);
    const stream = this.replyStreams.open(msgs);
    this.postman.sendAll(evts);
    reply.takeAll();
    return stream;
  }

  /**
   * Earlier queries transfer to ordinary queued replies without an HTTP response reader.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param reply Borrowed request correlation; inspect all cues before taking any of them.
   * @returns True when the captured batch was consumed; false when not ready.
   * @throws Construction/admission errors propagate before correlation consumption.
   */
  enqueueReply(hab: Hab, reply: QueryReply): boolean {
    this.postman.ensureOpen();
    const captured = reply.peekAll();
    if (!captured) return false;
    const { evts } = this.prepareReplies(hab, captured.cues);
    this.postman.sendAll(evts);
    reply.takeAll();
    return true;
  }

  /**
   * Prepare the entire captured batch without publishing or consuming it.
   * Direct HTTP response messages remain available when no outbound route exists.
   * Local replay is fully materialized here; delivery never suspends a replay iterator.
   *
   * @param hab Local habitat used to construct/sign this output; stores remain borrowed.
   * @param cues Borrowed complete captured batch, already in registry-before-credential order.
   * @returns All produced response msgs and only the events with an available outbound route.
   */
  private prepareReplies(hab: Hab, cues: readonly AgentCue[]): { msgs: Uint8Array[]; evts: PosterMsg[] } {
    const msgs: Uint8Array[] = [], evts: PosterMsg[] = [];
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

/**
 * Select the existing mailbox topic for a responder cue.
 *
 * @param cue Typed cue whose family determines the field meaning.
 * @returns Mailbox topic or null for a non-responder cue.
 */
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

/**
 * Select the intended recipient without preparing or transmitting bytes.
 *
 * @param cue Typed cue whose family determines the field meaning.
 * @returns Final recipient AID, or null when this cue has none.
 */
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

/**
 * Borrow the local sender selected by cue provenance, explicit hint or sole habitat.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @param cue Cue whose src may identify a local sender.
 * @param hab Optional fallback habitat hint.
 * @returns Cue-selected habitat, hint or sole local habitat; null if unresolved.
 */
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

/**
 * Read explicit local sender provenance only from cue families that carry it.
 *
 * @param cue Typed cue whose family determines the field meaning.
 * @returns Explicit local sender AID for reply/replay, or null.
 */
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

/**
 * Use an implicit signer only when the local collection is unambiguous.
 *
 * @param hby Borrowed local habitat collection and accepted-state database.
 * @returns The only local habitat, or null for zero/multiple candidates.
 */
function soleHab(hby: Habery): Hab | null {
  const habitats = hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}
