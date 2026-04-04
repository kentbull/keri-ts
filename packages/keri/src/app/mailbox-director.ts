import type { Operation } from "npm:effection@^3.6.0";
import type { AgentCue, CueEmission, ReplyCue, StreamCue } from "./../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { TopicsRecord } from "../core/records.ts";
import type { Baser } from "../db/basing.ts";
import type { CueSink } from "./cue-runtime.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MAILBOX_CURSOR = "__mailbox__";

/**
 * Mailbox topic director for one runtime host.
 *
 * Responsibilities:
 * - persist reply/replay/receipt-style wire emissions into durable topic stores
 * - retain mailbox stream requests so protocol hosts can answer `mbx` queries
 * - expose ordered topic iteration backed by `ptds.` and durable topic cursors
 *
 * KERIpy correspondence:
 * - this is the closest `keri-ts` analogue to the mailbox storage/query slice
 *   coordinated by `MailboxDirector`, `MailboxIterable`, and related helpers
 *
 * Current `keri-ts` difference:
 * - the first pass is intentionally scoped to runtime-driven mailbox topics and
 *   query streaming; forwarding/exchange orchestration lands later on top of
 *   this storage seam
 */
export class MailboxDirector implements CueSink {
  readonly db: Baser;
  readonly queryCues: Deck<StreamCue>;

  constructor(db: Baser, { queryCues }: { queryCues?: Deck<StreamCue> } = {}) {
    this.db = db;
    this.queryCues = queryCues ?? new Deck();
  }

  /**
   * Consume one interpreted cue emission from the shared runtime.
   *
   * Storage policy:
   * - `reply`/`replay` wire emissions are persisted into mailbox topics
   * - `stream` transport cues are retained so the HTTP host can correlate
   *   mailbox queries with later server-sent-event responses
   */
  *send(emission: CueEmission): Operation<void> {
    this.handleEmission(emission);
  }

  /** Synchronously apply one cue emission outside the Effection sink boundary. */
  handleEmission(emission: CueEmission): void {
    if (emission.kind === "wire") {
      this.storeWireEmission(emission.cue, emission.msgs);
      return;
    }

    if (emission.kind === "transport" && emission.cue.kin === "stream") {
      this.queryCues.push(emission.cue);
    }
  }

  /**
   * Persist one outbound mailbox payload under the ordered topic bucket for
   * `pre/topic`.
   */
  publish(pre: string, topic: string, msg: Uint8Array): number {
    const prior = this.cursorRecord(pre);
    const idx = (prior.topics[topic] ?? -1) + 1;
    this.db.ptds.add([pre, topic], textDecoder.decode(msg));
    prior.topics[topic] = idx;
    this.db.tops.pin([pre, MAILBOX_CURSOR], prior);
    return idx;
  }

  /** Return the latest stored publication index for one topic, or `-1`. */
  lastIndex(pre: string, topic: string): number {
    return this.cursorRecord(pre).topics[topic] ?? -1;
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
    let idx = from;
    for (
      const [, payload] of this.db.ptds.getItemIter([pre, topic], { ion: from })
    ) {
      yield { idx, msg: textEncoder.encode(payload) };
      idx += 1;
    }
  }

  /**
   * Return a server-sent-event stream over mailbox topics until the idle window
   * expires.
   */
  streamMailbox(
    pre: string,
    topics: Record<string, number>,
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
    const cursors = { ...topics };
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));
        let closed = false;
        let idleTimer: number | null = null;
        let pollTimer: number | null = null;

        const close = () => {
          if (closed) {
            return;
          }
          closed = true;
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
          }
          if (pollTimer !== null) {
            clearTimeout(pollTimer);
          }
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
    });
  }

  /**
   * Check whether the runtime has seen a matching `stream` cue for one query
   * SAID without discarding other pending query cues.
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

  /** Return the mailbox topic used for one runtime cue, if any. */
  private topicForCue(cue: AgentCue): string | null {
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

  /** Return the mailbox identifier bucket used for one runtime cue, if any. */
  private preForCue(cue: AgentCue): string | null {
    switch (cue.kin) {
      case "replay":
        return cue.pre ?? null;
      case "reply":
        return replyMailboxPre(cue);
      case "receipt":
      case "witness":
        return cue.serder.pre ?? null;
      default:
        return null;
    }
  }

  /** Persist any mailbox-relevant wire emission into the durable topic stores. */
  private storeWireEmission(cue: AgentCue, msgs: Uint8Array[]): void {
    const topic = this.topicForCue(cue);
    const pre = this.preForCue(cue);
    if (!topic || !pre) {
      return;
    }
    for (const msg of msgs) {
      this.publish(pre, topic, msg);
    }
  }

  /** Load or initialize the durable topic-index record used for local mailbox publication. */
  private cursorRecord(pre: string): TopicsRecord {
    return this.db.tops.get([pre, MAILBOX_CURSOR])
      ?? new TopicsRecord({ topics: {} });
  }
}

function replyMailboxPre(cue: ReplyCue): string | null {
  const data = cue.data
    ?? (cue.serder?.ked?.a as Record<string, unknown> | undefined);
  const pre = data?.i;
  return typeof pre === "string" ? pre : null;
}
