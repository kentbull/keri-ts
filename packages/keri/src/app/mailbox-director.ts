/**
 * Runtime-composed mailbox publication, query, and stream coordination.
 *
 * KERIpy correspondence:
 * - gathers responsibilities that KERIpy spreads across `Mailboxer`,
 *   mailbox iterables, and indirect-mode query handling
 *
 * Current `keri-ts` difference:
 * - one runtime host receives an explicit mailbox sidecar instead of
 *   discovering mailbox storage through `Habery`
 */
import type { StreamCue } from "./../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { MbxTopicCursor } from "../core/mailbox-topics.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import type { Habery } from "./habbing.ts";
import { mailboxQueryTopics, mailboxTopicKey, updateMailboxRemoteCursor } from "./mailboxing.ts";

/** Shared encoder for SSE mailbox stream framing. */
const textEncoder = new TextEncoder();

/**
 * Mailbox topic director for one runtime host.
 *
 * Responsibilities:
 * - retain mailbox stream requests so protocol hosts can answer `mbx` queries
 * - expose ordered topic iteration backed by the dedicated `Mailboxer` and
 *   durable remote cursor state in `tops.`
 * - publish only explicitly forwarded mailbox payloads such as authorized
 *   `/fwd` deliveries
 *
 * KERIpy correspondence:
 * - coordinates the storage/query slice around `Mailboxer` and
 *   `MailboxIterable`
 */
export class MailboxDirector {
  readonly hby: Habery;
  readonly mailboxer: Mailboxer | null;
  readonly queryCues: Deck<StreamCue>;
  readonly topics: Set<string>;
  private activeMailboxAid: string | null = null;

  constructor(
    hby: Habery,
    {
      mailboxer,
      queryCues,
      topics = [],
    }: {
      mailboxer?: Mailboxer;
      queryCues?: Deck<StreamCue>;
      topics?: readonly string[];
    } = {},
  ) {
    this.hby = hby;
    this.mailboxer = mailboxer ?? null;
    this.queryCues = queryCues ?? new Deck();
    this.topics = new Set(topics);
  }

  /** Return true when provider-side mailbox storage is available. */
  hasMailboxStore(): boolean {
    return this.mailboxer !== null;
  }

  /** Register one mailbox topic this runtime should poll/stream. */
  registerTopic(topic: string): void {
    if (topic.length > 0) {
      this.topics.add(topic);
    }
  }

  /**
   * Run one request-scoped block with the addressed hosted mailbox AID set.
   *
   * `/fwd` handling needs this so it can verify mailbox authorization against
   * the mailbox AID that actually received the request instead of guessing from
   * payload contents alone.
   */
  withActiveMailboxAid<T>(
    aid: string | null,
    fn: () => T,
  ): T {
    const prior = this.activeMailboxAid;
    this.activeMailboxAid = aid;
    try {
      return fn();
    } finally {
      this.activeMailboxAid = prior;
    }
  }

  /**
   * Return the mailbox AID currently associated with the in-flight request, if
   * any.
   */
  currentMailboxAid(): string | null {
    return this.activeMailboxAid;
  }

  /** Snapshot the currently configured mailbox topic set. */
  registeredTopics(): string[] {
    return [...this.topics];
  }

  /** Retain one mailbox-query `stream` cue for later HTTP/SSE correlation. */
  retainQueryCue(cue: StreamCue): void {
    this.queryCues.push(cue);
  }

  /**
   * Persist one outbound mailbox payload under the ordered topic bucket for
   * `pre/topic`.
   *
   * The returned index is the newly assigned mailbox event id for that topic.
   */
  publish(pre: string, topic: string, msg: Uint8Array): number {
    const idx = this.lastIndex(pre, topic) + 1;
    this.requireMailboxer().storeMsg(mailboxTopicKey(pre, topic), msg);
    return idx;
  }

  /** Return the latest stored publication index for one topic, or `-1`. */
  lastIndex(pre: string, topic: string): number {
    const count = this.requireMailboxer().tpcs.cntOn(
      mailboxTopicKey(pre, topic),
    );
    return count > 0 ? count - 1 : -1;
  }

  /**
   * Return ordered topic payloads starting at the provided insertion index.
   *
   * The returned index is the mailbox event id that should be reflected in the
   * SSE `id:` field for the emitted message.
   */
  *topicIter(
    pre: string,
    topic: string,
    from = 0,
  ): Generator<{ idx: number; msg: Uint8Array }> {
    for (
      const [idx, , msg] of this.requireMailboxer().cloneTopicIter(
        mailboxTopicKey(pre, topic),
        from,
      )
    ) {
      yield { idx, msg };
    }
  }

  /**
   * Return a server-sent-event stream over mailbox topics until the idle window
   * expires.
   *
   * SSE policy:
   * - emit one initial `retry:` hint
   * - stream ordered mailbox payloads as `id/event/data`
   * - close once the idle window expires without new mailbox traffic
   */
  streamMailbox(
    pre: string,
    topicCursor: MbxTopicCursor,
    {
      retryMs = 5000,
      pollIntervalMs = 50,
      idleTimeoutMs = 2000,
    }: {
      retryMs?: number;
      pollIntervalMs?: number;
      idleTimeoutMs?: number;
    } = {},
  ): ReadableStream<Uint8Array> {
    const cursors = { ...topicCursor };
    const encoder = new TextEncoder();
    let closed = false;
    let idleTimer: number | null = null;
    let pollTimer: number | null = null;

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));

        const close = () => {
          cleanup();
          controller.close();
        };

        const resetIdle = () => {
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
          }
          idleTimer = setTimeout(close, idleTimeoutMs);
        };

        const poll = () => {
          if (closed) {
            return;
          }

          let emitted = false;
          for (const [topic, start] of Object.entries(cursors)) {
            for (const item of this.topicIter(pre, topic, start)) {
              controller.enqueue(encoder.encode(
                `id: ${item.idx}\nevent: ${topic}\nretry: ${retryMs}\ndata: `,
              ));
              controller.enqueue(item.msg);
              controller.enqueue(encoder.encode("\n\n"));
              cursors[topic] = item.idx + 1;
              emitted = true;
            }
          }

          if (emitted) {
            resetIdle();
          }
          pollTimer = setTimeout(poll, pollIntervalMs);
        };

        resetIdle();
        poll();
      },
      cancel: () => {
        cleanup();
      },
    });
  }

  /**
   * Build the next `mbx` query cursor map for one `(pre, witness)` pair.
   *
   * Stored cursor rows track the last seen index, while the wire query asks for
   * the next wanted index.
   */
  remoteQueryCursor(pre: string, witness: string): Record<string, number> {
    return mailboxQueryTopics(this.hby, pre, witness, this.topics);
  }

  /** Persist one consumed remote mailbox index for one `(pre, witness, topic)`. */
  updateRemoteCursor(
    pre: string,
    witness: string,
    topic: string,
    idx: number,
  ): void {
    updateMailboxRemoteCursor(this.hby, pre, witness, topic, idx);
  }

  /**
   * Check whether the runtime has seen a matching `stream` cue for one query
   * SAID without discarding other pending query cues.
   *
   * This keeps query correlation observable without consuming cues that later
   * host work still needs.
   */
  hasQueryCue(said: string): boolean {
    let found = false;
    const kept: StreamCue[] = [];
    while (!this.queryCues.empty) {
      const cue = this.queryCues.pull();
      if (!cue) {
        continue;
      }
      if (cue.serder.said === said) {
        found = true;
      }
      kept.push(cue);
    }
    this.queryCues.extend(kept);
    return found;
  }

  /** Require provider mailbox storage for publication or mailbox serving. */
  private requireMailboxer(): Mailboxer {
    if (!this.mailboxer) {
      throw new ValidationError(
        "Provider mailbox storage is unavailable for this runtime.",
      );
    }
    return this.mailboxer;
  }
}
