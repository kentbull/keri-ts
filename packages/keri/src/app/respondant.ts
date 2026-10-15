import type { Operation } from "npm:effection@^3.6.0";
import type { CueEmission } from "../core/cues.ts";
import { DeckFullError } from "../core/deck.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import type { CueAdmission, CueSink } from "./cue-runtime.ts";
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

  /** Bind one default forwarding habitat for long-lived host sinks. */
  forHab(hab?: Hab | null): CueSink {
    return {
      admitCue: (runtime, interpreter) => this.admitCue(runtime, interpreter, hab),
      send: (emission) => this.sendWithHab(emission, hab),
    };
  }

  /** Atomically retain eligible source wire; occupied capacity never falls back to destructive sending. */
  admitCue(runtime: AgentRuntime, interpreter: Hab | null, hint?: Hab | null): CueAdmission {
    const cue = runtime.cues.peekHead();
    if (!cue || !interpreter) return "ineligible";
    const recipient = recipientForCue(cue), topic = topicForCue(cue);
    const sender = senderHabForCue(this.hby, cue, hint);
    if (!recipient || !topic || !sender) return "ineligible";
    if (this.hby !== runtime.hby || this.poster !== runtime.poster) throw new RangeError("Wrong cue runtime");
    const transferred = runtime.deliveries.enqueueCue(
      interpreter,
      runtime.cues,
      () =>
        this.poster.findBytesRoute(sender, { recipient, topic }) ?? {
          sender: sender.pre,
          recipient,
          topic,
          bodyMode: this.hby.cesrBodyMode,
          kind: "direct",
          targets: [],
        },
      sender,
    );
    if (typeof transferred !== "boolean") {
      if (transferred.error instanceof DeckFullError || transferred.error.reason === "busy") return "busy";
      throw transferred.error;
    }
    return transferred ? "transferred" : "ineligible";
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
