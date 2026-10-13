/**
 * Runtime-composed mailbox publication, query, and stream coordination.
 *
 * KERIpy correspondence:
 * - gathers responsibilities that KERIpy spreads across `Mailboxer`,
 *   mailbox iterables, and indirect-mode query handling
 *
 * Boundary rule:
 * - this module is mailbox storage/query infrastructure, not the general
 *   responder path
 * - non-`stream` cue delivery such as `reply`, `replay`, `receipt`, and
 *   `witness` belongs in `Respondant`
 *
 * Current `keri-ts` difference:
 * - one runtime host receives an explicit mailbox sidecar instead of
 *   discovering mailbox storage through `Habery`
 */
import { ResourceLimitError } from "cesr-ts";
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
 * Non-responsibilities:
 * - do not absorb generic non-`stream` cue emissions as implicit local mailbox
 *   side effects
 * - do not replace `Respondant` / `Poster` endpoint delivery
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
  private readonly streamCleanups = new Set<() => void>();

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

  /** Snapshot the currently configured mailbox topic set. */
  registeredTopics(): string[] {
    return [...this.topics];
  }

  /** Stop every request-owned mailbox stream before its backing store closes. */
  close(): void {
    for (const cleanup of [...this.streamCleanups]) {
      cleanup();
    }
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
      emitRetryHeader = true,
    }: {
      retryMs?: number;
      pollIntervalMs?: number;
      idleTimeoutMs?: number | null;
      emitRetryHeader?: boolean;
    } = {},
  ): ReadableStream<Uint8Array> {
    const cursors = { ...topicCursor };
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array>;
    let retry = emitRetryHeader;
    let parts: Uint8Array[] = [];
    let offset = 0;
    let idleSince: number | undefined;
    /** Closing wakes a pending pull before its database owner is released. */
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      parts = [];
      this.streamCleanups.delete(close);
    };
    /** Runtime shutdown completes the response even when its consumer still holds a reader. */
    const close = () => {
      if (closed) return;
      cleanup();
      stream.close();
    };
    this.streamCleanups.add(close);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
      pull: async (controller) => {
        try {
          if (retry) {
            retry = false;
            controller.enqueue(textEncoder.encode(`retry: ${retryMs}\n\n`));
            return;
          }
          while (!closed) {
            if (parts.length) {
              const part = parts[0];
              const end = Math.min(part.length, offset + 64 * 1024);
              controller.enqueue(part.slice(offset, end));
              offset = end;
              if (offset === part.length) {
                parts.shift();
                offset = 0;
              }
              return;
            }
            for (const [topic, start] of Object.entries(cursors)) {
              // Take one stored item, then release the LMDB iterator before suspending on HTTP demand.
              const items = this.topicIter(pre, topic, start);
              let item: { idx: number; msg: Uint8Array } | undefined;
              try {
                item = items.next().value;
              } finally {
                items.return(undefined);
              }
              if (!item) continue;
              if (item.msg.buffer.byteLength > 4 * 1024 * 1024) {
                throw new ResourceLimitError("Mailbox SSE message exceeds byte limit");
              }
              parts = [
                textEncoder.encode(`id: ${item.idx}\nevent: ${topic}\nretry: ${retryMs}\ndata: `),
                item.msg,
                textEncoder.encode("\n\n"),
              ];
              cursors[topic] = item.idx + 1;
              idleSince = undefined;
              break;
            }
            if (parts.length) continue;
            idleSince ??= Date.now();
            if (idleTimeoutMs !== null && Date.now() - idleSince >= idleTimeoutMs) {
              close();
              return;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, pollIntervalMs);
            });
            wake = undefined;
            timer = undefined;
          }
        } catch (error) {
          if (!closed) {
            cleanup();
            controller.error(error);
          }
        }
      },
      cancel: cleanup,
    }, { highWaterMark: 0 });
  }

  /**
   * Return a KERIpy-style long-lived SSE response for one posted `qry`.
   *
   * Correlation rule:
   * - emit the initial `retry:` hint immediately
   * - wait until a matching `stream` cue for the query SAID appears
   * - once matched, proxy the normal mailbox iterable for that cue
   *
   * This mirrors KERIpy `QryRpyMailboxIterable` ownership closely: the HTTP
   * route does not guess mailbox topics itself; it waits for mailbox query
   * correlation to tell it what to stream.
   */
  streamQueryResponse(
    said: string,
    {
      retryMs = 5000,
      pollIntervalMs = 50,
    }: {
      retryMs?: number;
      pollIntervalMs?: number;
    } = {},
  ): ReadableStream<Uint8Array> {
    let closed = false;
    let retry = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
    let closing: Promise<void> | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array>;
    /** Stop cue polling and join the single nested read before releasing its reader. */
    const cleanup = (): Promise<void> => {
      if (closing) return closing;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      this.streamCleanups.delete(close);
      closing = (async () => {
        await reader?.cancel().catch(() => {});
        await pending?.catch(() => {});
        reader?.releaseLock();
      })();
      return closing;
    };
    /** Director shutdown closes the outer response and starts joined nested cleanup. */
    const close = () => {
      if (closed) return;
      void cleanup();
      stream.close();
    };
    this.streamCleanups.add(close);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
      pull: async (controller) => {
        try {
          if (retry) {
            retry = false;
            controller.enqueue(textEncoder.encode(`retry: ${retryMs}\n\n`));
            return;
          }
          while (!reader && !closed) {
            const cue = this.takeQueryCue(said);
            if (cue) {
              reader = this.streamMailbox(cue.pre, cue.topics, {
                retryMs,
                pollIntervalMs,
                idleTimeoutMs: null,
                emitRetryHeader: false,
              }).getReader();
              break;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, pollIntervalMs);
            });
            wake = undefined;
            timer = undefined;
          }
          if (closed || !reader) return;
          pending = reader.read();
          const next = await pending;
          pending = undefined;
          if (closed) return;
          if (next.done) {
            await cleanup();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          if (!closed) {
            await cleanup();
            controller.error(error);
          }
        }
      },
      cancel: cleanup,
    }, { highWaterMark: 0 });
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

  /** Remove and return the next queued `stream` cue for one query SAID. */
  private takeQueryCue(said: string): StreamCue | null {
    let match: StreamCue | null = null;
    const kept: StreamCue[] = [];
    while (!this.queryCues.empty) {
      const cue = this.queryCues.pull();
      if (!cue) {
        continue;
      }
      if (!match && cue.serder.said === said) {
        match = cue;
        continue;
      }
      kept.push(cue);
    }
    this.queryCues.extend(kept);
    return match;
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
