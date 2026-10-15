import type { Operation } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import type { CueSink } from "./cue-runtime.ts";
import type { Poster, RawCesrRoute } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { MailboxDirector } from "./mailbox-director.ts";

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
export class Respondant implements CueSink {
  readonly hby: Habery;
  readonly poster: Poster;
  readonly mailboxDirector: MailboxDirector;

  constructor(
    hby: Habery,
    {
      poster,
      mailboxDirector,
    }: {
      poster: Poster;
      mailboxDirector: MailboxDirector;
    },
  ) {
    this.hby = hby;
    this.poster = poster;
    this.mailboxDirector = mailboxDirector;
  }

  /** Resolve the existing responder policy for an admitted witness emission without sending or signing again. */
  routeForEmission(emission: CueEmission, hab?: Hab | null): RawCesrRoute | null {
    const recipient = recipientForCue(emission.cue), topic = topicForCue(emission.cue);
    const sender = senderHabForCue(this.hby, emission.cue, hab);
    if (emission.kind !== "wire" || !recipient || !topic || !sender) return null;
    return this.poster.findBytesRoute(sender, { recipient, topic });
  }

  /** Default cue-sink entry point when no explicit habitat hint is supplied. */
  *send(emission: CueEmission): Operation<void> {
    yield* this.sendWithHab(emission, null);
  }

  /**
   * Route one interpreted cue emission to mailbox query state or outbound
   * mailbox/direct delivery.
   */
  *sendWithHab(
    emission: CueEmission,
    hab?: Hab | null,
  ): Operation<void> {
    if (emission.kind === "transport" && emission.cue.kin === "stream") {
      this.mailboxDirector.retainQueryCue(emission.cue);
      return;
    }

    if (emission.kind !== "wire") {
      return;
    }

    const recipient = recipientForCue(emission.cue);
    const topic = topicForCue(emission.cue);
    const senderHab = senderHabForCue(this.hby, emission.cue, hab);
    if (!recipient || !topic || !senderHab) {
      return;
    }

    for (const message of emission.messages) {
      try {
        yield* this.poster.sendBytes(senderHab, {
          recipient,
          topic,
          message,
        });
      } catch {
        // Keep host ingress best-effort, matching KERIpy's background
        // respondant behavior instead of failing the request path.
      }
    }
  }
}

/** Select the existing mailbox topic for a responder cue. */
export function topicForCue(
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
export function recipientForCue(
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
export function senderHabForCue(
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
