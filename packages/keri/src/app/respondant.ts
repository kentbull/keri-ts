import type { Operation } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import type { CueSink } from "./cue-runtime.ts";
import type { Poster } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { MailboxDirector } from "./mailbox-director.ts";

/**
 * Shared host-side responder for indirect and witness runtimes.
 *
 * KERIpy correspondence:
 * - this is the local analogue of `Respondant` for reply/replay/receipt-style
 *   cues
 * - mailbox-query `stream` cues stay with mailbox storage/query coordination
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

  /** Bind one default forwarding habitat for long-lived host sinks. */
  forHab(hab?: Hab | null): CueSink {
    return {
      send: (emission) => this.sendWithHab(emission, hab),
    };
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
    const senderHab = senderHabForEmission(this.hby, emission, hab);
    if (!recipient || !topic || !senderHab) {
      return;
    }

    for (const message of emission.msgs) {
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

function senderHabForEmission(
  hby: Habery,
  emission: CueEmission,
  hab?: Hab | null,
): Hab | null {
  const source = cueSourcePrefix(emission.cue);
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
  const habitats = [...hby.habs.values()];
  return habitats.length === 1 ? habitats[0] ?? null : null;
}
