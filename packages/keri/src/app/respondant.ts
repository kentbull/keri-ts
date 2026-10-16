import { call, type Operation, resource } from "npm:effection@^3.6.0";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { attemptPreparedCesrTarget, type Poster, type PreparedCesrTarget, type RawCesrRoute } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { QueryReply } from "./query-replies.ts";
import type { Reactor } from "./reactor.ts";
import type { ReplyStreams } from "./reply-streams.ts";

/** Live replay cursor and exact signed packet owned only by Respondant. */
interface ReplyCursor {
  emission: CueEmission;
  hab: Hab;
  route: RawCesrRoute;
  iterator?: Iterator<Uint8Array>;
  message?: Uint8Array;
  targetIndex: number;
  prepared?: PreparedCesrTarget;
}

/** A correlated reply batch stays ordered; refused packets retain their exact wire. */
type OutboundReply =
  | { kind: "cues"; cues: ReplyCursor[]; index: number }
  | { kind: "packet"; packet: PreparedCesrTarget };

/**
 * Shared host-side responder for indirect and witness runtimes.
 *
 * KERIpy correspondence:
 * - this is the local analogue of `Respondant` for reply/replay/receipt-style
 *   cues
 * - `BaseHab.processCuesIter()` interprets the cue; `Respondant` delivers the
 *   resulting bytes
 * - mailbox-query `stream` cues stay with mailbox storage/query coordination
 *
 * Boundary rule:
 * - this class owns non-`stream` cue delivery
 * - `MailboxDirector` owns mailbox storage and `stream` cue correlation
 * - if a future change starts treating generic `reply` / `replay` /
 *   `receipt`-family cues as local mailbox writes, that change is regressing
 *   back toward the bug where mailbox code was incorrectly acting like
 *   KERIpy's `Respondant`
 */
export class Respondant {
  private readonly hby: Habery;
  private readonly poster: Poster;
  private readonly reactor: Reactor;
  private readonly replyStreams: ReplyStreams;
  private readonly outgoing = new Deck<OutboundReply>();
  private processing = false;
  private closed = false;
  private active?: AbortController;
  private joined?: Promise<void>;

  constructor(
    hby: Habery,
    {
      poster,
      reactor,
      replyStreams,
    }: {
      poster: Poster;
      reactor: Reactor;
      replyStreams: ReplyStreams;
    },
  ) {
    this.hby = hby;
    this.poster = poster;
    this.reactor = reactor;
    this.replyStreams = replyStreams;
  }

  /** Include active transport and lazy replies in runtime convergence. */
  get hasPending(): boolean {
    return this.processing || !this.outgoing.empty;
  }

  /** Interpret and route a source head before removing it; failed preparation leaves it visible. */
  enqueueCue(interpreter: Hab, source: Deck<AgentCue>, hint?: Hab | null): boolean {
    this.assertOpen();
    const cue = source.peekHead();
    if (!cue) return false;
    const recipient = recipientForCue(cue), topic = topicForCue(cue);
    const sender = senderHabForCue(this.hby, cue, hint);
    if (!recipient || !topic || !sender) return false;
    const emission = interpreter.interpretCue(cue);
    if (emission?.kind !== "wire") throw new RangeError("Cue delivery requires wire");
    const route = this.poster.findBytesRoute(sender, { recipient, recipientIsPrefix: true, topic });
    if (route?.targets.length) {
      this.outgoing.push({ kind: "cues", cues: [{ emission, hab: sender, route, targetIndex: 0 }], index: 0 });
    }
    source.pull();
    return true;
  }

  /** Queue an already interpreted witness emission without reopening or signing its messages. */
  enqueueEmission(hab: Hab, emission: CueEmission): void {
    this.assertOpen();
    const route = this.routeForEmission(emission, hab);
    if (route?.targets.length) {
      const sender = this.hby.habs.get(route.sender) ?? hab;
      this.outgoing.push({ kind: "cues", cues: [{ emission, hab: sender, route, targetIndex: 0 }], index: 0 });
    }
  }

  /** Prepare the whole correlated batch before publishing either its HTTP reader or queued destinations. */
  openReply(hab: Hab, reply: QueryReply): ReadableStream<Uint8Array> | null {
    this.assertOpen();
    const captured = reply.peekAll();
    if (!captured) return null;
    const { emissions, cues } = this.interpretReplies(hab, captured.cues);
    const stream = this.replyStreams.open({
      *[Symbol.iterator]() {
        for (const emission of emissions) yield* emission.messages;
      },
    });
    if (cues.length) this.outgoing.push({ kind: "cues", cues, index: 0 });
    reply.takeAll();
    return stream;
  }

  /** Earlier queries transfer to ordinary queued replies without an HTTP response reader. */
  enqueueReply(hab: Hab, reply: QueryReply): boolean {
    this.assertOpen();
    const captured = reply.peekAll();
    if (!captured) return false;
    const { cues } = this.interpretReplies(hab, captured.cues);
    if (cues.length) this.outgoing.push({ kind: "cues", cues, index: 0 });
    reply.takeAll();
    return true;
  }

  private interpretReplies(hab: Hab, replies: readonly AgentCue[]): { emissions: CueEmission[]; cues: ReplyCursor[] } {
    const emissions: CueEmission[] = [], cues: ReplyCursor[] = [];
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
      if (route?.targets.length) cues.push({ emission, hab: sender, route, targetIndex: 0 });
    }
    return { emissions, cues };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Respondant is closed");
  }

  /** Join actual transport before returning every opened replay cursor; ordinary cues need no release protocol. */
  *close(): Operation<void> {
    this.closed = true;
    this.active?.abort();
    if (this.joined) yield* call(() => this.joined!);
    const errors: unknown[] = [];
    while (!this.outgoing.empty) {
      try {
        this.closeReply(this.outgoing.pull()!);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Respondant cleanup failed");
  }

  private closeReply(reply: OutboundReply): void {
    if (reply.kind === "packet") return;
    const errors: unknown[] = [];
    for (const cue of reply.cues.splice(0)) {
      try {
        cue.iterator?.return?.();
      } catch (error) {
        if (!errors.includes(error)) errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Reply cursor cleanup failed");
  }

  /** Advance each captured batch once; signing/routing stays synchronous and transport runs outside the state turn. */
  process(): Operation<void> {
    // deno-lint-ignore no-this-alias -- The operation owns this finite output pass.
    const self = this;
    return call(function*() {
      if (self.processing || self.closed) return;
      self.processing = true;
      const active = self.active = new AbortController();
      let complete!: () => void;
      self.joined = new Promise<void>((resolve) => complete = resolve);
      yield* resource<void>(function*(provide) {
        try {
          yield* provide();
        } finally {
          self.processing = false;
          self.active = undefined;
          self.joined = undefined;
          complete();
        }
      });
      const count = self.outgoing.length;
      for (let index = 0; index < count && !self.closed; index++) {
        const reply = self.outgoing.peekHead();
        if (!reply) break;
        active.signal.throwIfAborted();
        let done = true;
        if (reply.kind === "packet") {
          done = (yield* attemptPreparedCesrTarget(reply.packet, self.poster.services, active.signal, {
            reactor: self.reactor,
          })) === "complete";
        } else {
          const cue = reply.cues[reply.index];
          const next = self.prepareReplyTarget(reply);
          done = next.kind === "done";
          if (next.kind === "target") {
            const target = next.target;
            const outcome = yield* attemptPreparedCesrTarget(target, self.poster.services, active.signal, {
              reactor: self.reactor,
            });
            if (outcome === "complete" || outcome === "refused" && !self.closed) {
              active.signal.throwIfAborted();
              if (outcome === "refused") self.outgoing.push({ kind: "packet", packet: target });
              cue.prepared = undefined;
              if (++cue.targetIndex === cue.route.targets.length) {
                cue.targetIndex = 0;
                cue.message = undefined;
              }
            }
          }
        }
        active.signal.throwIfAborted();
        if (done) {
          try {
            self.closeReply(reply);
          } finally {
            self.outgoing.pull();
          }
        } else {
          self.outgoing.pull();
          self.outgoing.push(reply);
        }
      }
    });
  }

  private prepareReplyTarget(
    reply: Extract<OutboundReply, { kind: "cues" }>,
  ): { kind: "target"; target: PreparedCesrTarget } | { kind: "done" | "more" } {
    const cue = reply.cues[reply.index];
    if (!cue) return { kind: "done" };
    if (cue.prepared) return { kind: "target", target: cue.prepared };
    if (!cue.message) {
      cue.iterator ??= cue.emission.messages[Symbol.iterator]();
      const next = cue.iterator.next();
      if (next.done) {
        reply.index++;
        return { kind: "more" };
      }
      cue.message = next.value;
      if (!(cue.message instanceof Uint8Array)) throw new TypeError("Cue message must be binary");
    }
    cue.prepared = this.poster.prepareBytesTarget(cue.hab, cue.route, cue.targetIndex, cue.message);
    return { kind: "target", target: cue.prepared };
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
