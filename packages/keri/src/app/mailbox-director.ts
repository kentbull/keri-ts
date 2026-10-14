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
import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy, type ResourceReservation } from "cesr-ts";
import { CueDeck, type OwnedCue } from "../core/cue-admission.ts";
import type { StreamCue } from "./../core/cues.ts";
import type { DeckFullError } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import type { MbxTopicCursor } from "../core/mailbox-topics.ts";
import type { Mailboxer } from "../db/mailboxing.ts";
import type { Habery } from "./habbing.ts";
import { mailboxQueryTopics, mailboxTopicKey, updateMailboxRemoteCursor } from "./mailboxing.ts";

/** Shared encoder for SSE mailbox stream framing. */
const textEncoder = new TextEncoder();

/** Configured mailbox output policy, independent of valid protocol topic/message sizes. */
export interface MailboxStreamLimits {
  maxMessageBytes?: number;
  maxChunkBytes?: number;
  maxTopics?: number;
  maxMetadataBytes?: number;
}
interface MailboxStreamOptions {
  retryMs?: number;
  pollIntervalMs?: number;
  idleTimeoutMs?: number | null;
  emitRetryHeader?: boolean;
}

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
  /** Exclusive correlation ownership; external producers append but do not take/release query owners. */
  readonly queryCues: CueDeck;
  readonly topics: Set<string>;
  private readonly streamCleanups = new Set<() => Promise<void>>();
  private readonly resources: ResourcePolicy;
  private readonly limits: Required<MailboxStreamLimits>;
  private correlationsClosed = false;

  constructor(
    hby: Habery,
    {
      mailboxer,
      queryCues,
      topics = [],
      resources = new ResourcePolicy(),
      streamLimits = {},
      maxQueryCues = 64,
    }: {
      mailboxer?: Mailboxer;
      queryCues?: CueDeck;
      topics?: readonly string[];
      resources?: ResourcePolicy;
      streamLimits?: MailboxStreamLimits;
      /** Local retained correlation slots, including active readers; not a protocol maximum. */
      maxQueryCues?: number;
    } = {},
  ) {
    this.hby = hby;
    this.mailboxer = mailboxer ?? null;
    if (!Number.isSafeInteger(maxQueryCues) || maxQueryCues < 0) throw new RangeError("Invalid mailbox query capacity");
    if (queryCues && queryCues.resourcePolicy !== resources) throw new RangeError("Mailbox query policy mismatch");
    this.queryCues = queryCues ?? new CueDeck(resources, maxQueryCues);
    this.queryCues.capacity = Math.min(this.queryCues.capacity, maxQueryCues);
    this.topics = new Set(topics);
    this.resources = resources;
    this.limits = {
      maxMessageBytes: 4 * 1024 ** 2,
      maxChunkBytes: 65536,
      maxTopics: 64,
      maxMetadataBytes: 65536,
      ...streamLimits,
    };
    for (const limit of Object.values(this.limits)) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid mailbox stream limit");
    }
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
  async close(): Promise<void> {
    this.correlationsClosed = true;
    const outcomes = await Promise.allSettled(
      [...this.streamCleanups].map((cleanup) => Promise.resolve().then(cleanup)),
    );
    const failures = outcomes.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    try {
      this.queryCues.clear();
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Mailbox stream cleanup failed");
  }

  /** Reserve message-copy, emitted-chunk and metadata allowance before any stream or native row acquisition. */
  private admit(): ResourceReservation {
    const { maxMessageBytes, maxChunkBytes, maxMetadataBytes } = this.limits;
    const credit = this.resources.reserve({
      streams: 1,
      bytes: 2 * maxMessageBytes + maxChunkBytes + 4 * maxMetadataBytes + 512,
    });
    if (credit.kind === "refuse") {
      throw new ResourceAdmissionError(`Mailbox stream admission refused: ${credit.reason}`, credit.reason);
    }
    return credit.reservation;
  }

  /** Bound labels/ordinals before making a cursor copy or Object.entries allocation. */
  private cursor(pre: string, topics: MbxTopicCursor): MbxTopicCursor {
    if (typeof pre !== "string" || !topics || typeof topics !== "object" || Array.isArray(topics)) {
      throw new RangeError("Invalid mailbox topic metadata");
    }
    let characters = pre.length, count = 0;
    for (const topic in topics) {
      if (!Object.hasOwn(topics, topic)) continue;
      characters += topic.length;
      if (++count > this.limits.maxTopics || 4 * characters > this.limits.maxMetadataBytes) {
        throw new ResourceLimitError("Mailbox topic metadata exceeds configured policy");
      }
      if (!Number.isSafeInteger(topics[topic]) || topics[topic] < 0) {
        throw new RangeError("Invalid mailbox topic cursor");
      }
    }
    if (4 * characters > this.limits.maxMetadataBytes) {
      throw new ResourceLimitError("Mailbox prefix metadata exceeds configured policy");
    }
    return { ...topics };
  }

  /** Admit one immutable query cue before the caller removes its source owner; busy leaves that source intact. */
  retainQueryCue(
    cue: StreamCue,
    onAdmissionRefusal?: (error: ResourceAdmissionError | DeckFullError) => void,
  ): void {
    if (this.correlationsClosed) throw new Error("Mailbox query correlation is closed");
    this.queryCues.prepare([cue], onAdmissionRefusal).publish();
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
    maxMessageBytes?: number,
  ): Generator<{ idx: number; msg: Uint8Array }> {
    for (
      const [idx, , msg] of this.requireMailboxer().cloneTopicIter(
        mailboxTopicKey(pre, topic),
        from,
        maxMessageBytes,
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
    options: MailboxStreamOptions = {},
  ): ReadableStream<Uint8Array> {
    const credit = this.admit();
    try {
      return this.mailboxStream(pre, this.cursor(pre, topicCursor), options, () => credit.release(), true);
    } catch (error) {
      credit.release();
      throw error;
    }
  }

  /** A query response lends its existing lease to this nested stream instead of charging it twice. */
  private mailboxStream(
    pre: string,
    cursors: MbxTopicCursor,
    {
      retryMs = 5000,
      pollIntervalMs = 50,
      idleTimeoutMs = 2000,
      emitRetryHeader = true,
    }: MailboxStreamOptions,
    release: () => void,
    tracked: boolean,
  ): ReadableStream<Uint8Array> {
    for (const value of [retryMs, pollIntervalMs, idleTimeoutMs]) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError("Invalid mailbox stream timing");
      }
    }
    if (pollIntervalMs < 1) throw new RangeError("Mailbox poll interval must be positive");
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array>;
    let retry = emitRetryHeader;
    let parts: Uint8Array[] = [];
    let offset = 0;
    let idleSince: number | undefined;
    let pending: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    let released = false;
    /** Closing wakes a pending pull before its database owner is released. */
    const stop = () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      parts = [];
    };
    const finish = () => {
      if (released) return;
      released = true;
      this.streamCleanups.delete(close);
      release();
    };
    const cleanup = (): Promise<void> => {
      stop();
      return closing ??= Promise.resolve(pending).finally(finish);
    };
    /** Runtime shutdown completes the response even when its consumer still holds a reader. */
    const close = (): Promise<void> => {
      if (!closed) {
        stop();
        stream.close();
      }
      return cleanup();
    };
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
      pull: async (controller) => {
        let finished!: () => void;
        pending = new Promise<void>((resolve) => {
          finished = resolve;
        });
        try {
          if (retry) {
            retry = false;
            controller.enqueue(textEncoder.encode(`retry: ${retryMs}\n\n`));
            return;
          }
          while (!closed) {
            if (parts.length) {
              const part = parts[0];
              const end = Math.min(part.length, offset + this.limits.maxChunkBytes);
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
              const items = this.topicIter(pre, topic, start, this.limits.maxMessageBytes);
              let item: { idx: number; msg: Uint8Array } | undefined;
              try {
                item = items.next().value;
              } finally {
                items.return(undefined);
              }
              if (!item) continue;
              if (item.msg.buffer.byteLength > this.limits.maxMessageBytes) {
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
              stop();
              controller.close();
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
            stop();
            controller.error(error);
          }
        } finally {
          finished();
          pending = undefined;
          if (closed) finish();
        }
      },
      cancel: cleanup,
    }, { highWaterMark: 0 });
    if (tracked) this.streamCleanups.add(close);
    return readable;
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
    options: Pick<MailboxStreamOptions, "retryMs" | "pollIntervalMs"> = {},
  ): ReadableStream<Uint8Array> {
    if (this.correlationsClosed) throw new Error("Mailbox query correlation is closed");
    const credit = this.admit();
    try {
      if (typeof said !== "string" || 4 * said.length > this.limits.maxMetadataBytes) {
        throw new ResourceLimitError("Mailbox query metadata exceeds configured policy");
      }
      return this.queryStream(said, options, () => credit.release());
    } catch (error) {
      credit.release();
      throw error;
    }
  }

  /** The outer query owner joins its nested reader before returning shared stream credit. */
  private queryStream(
    said: string,
    {
      retryMs = 5000,
      pollIntervalMs = 50,
    }: {
      retryMs?: number;
      pollIntervalMs?: number;
    },
    release: () => void,
  ): ReadableStream<Uint8Array> {
    if (!Number.isSafeInteger(retryMs) || retryMs < 0 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
      throw new RangeError("Invalid mailbox query timing");
    }
    let closed = false;
    let retry = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let selected: OwnedCue | undefined;
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
    let closing: Promise<void> | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array>;
    /** Stop cue polling and join the single nested read before releasing its reader. */
    const cleanup = (): Promise<void> => {
      if (closing) return closing;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      closing = (async () => {
        const failures: unknown[] = [];
        try {
          await reader?.cancel();
        } catch (error) {
          failures.push(error);
        }
        try {
          await pending;
        } catch (error) {
          if (!failures.includes(error)) failures.push(error);
        }
        try {
          reader?.releaseLock();
        } catch (error) {
          failures.push(error);
        }
        try {
          selected?.release();
        } catch (error) {
          if (!failures.includes(error)) failures.push(error);
        }
        selected = undefined;
        this.streamCleanups.delete(close);
        release();
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "Nested mailbox cleanup failed");
      })();
      return closing;
    };
    /** Director shutdown closes the outer response and starts joined nested cleanup. */
    const close = (): Promise<void> => {
      const open = !closed;
      const completed = cleanup();
      if (open) stream.close();
      return completed;
    };
    const readable = new ReadableStream<Uint8Array>({
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
            selected = this.takeQueryCue(said) ?? undefined;
            if (selected) {
              const cue = selected.cue;
              if (cue.kin !== "stream") throw new Error("Mailbox query owner is not a stream cue");
              reader = this.mailboxStream(
                cue.pre,
                this.cursor(cue.pre, cue.topics),
                {
                  retryMs,
                  pollIntervalMs,
                  idleTimeoutMs: null,
                  emitRetryHeader: false,
                },
                () => {},
                false,
              ).getReader();
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
            let failure = error;
            try {
              await cleanup();
            } catch (cleanupError) {
              if (cleanupError !== error) {
                failure = new AggregateError([error, cleanupError], "Mailbox read and cleanup failed");
              }
            }
            controller.error(failure);
          }
        }
      },
      cancel: cleanup,
    }, { highWaterMark: 0 });
    this.streamCleanups.add(close);
    return readable;
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
    for (const cue of this.queryCues) {
      if (cue.kin === "stream" && cue.serder.said === said) return true;
    }
    return false;
  }

  /** Select the first matching owner without re-admission or changing preceding cue order. */
  private takeQueryCue(said: string): OwnedCue | null {
    let preceding = 0;
    for (const cue of this.queryCues) {
      if (cue.kin === "stream" && cue.serder.said === said) {
        const kept: OwnedCue[] = [];
        for (let i = 0; i < preceding; i++) kept.push(this.queryCues.takeOwned()!);
        const selected = this.queryCues.takeOwned()!;
        for (let i = kept.length - 1; i >= 0; i--) this.queryCues.requeue(kept[i]);
        return selected;
      }
      preceding++;
    }
    return null;
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
