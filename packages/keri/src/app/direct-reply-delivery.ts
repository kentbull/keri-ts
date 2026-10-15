/** Prepare reply records once for independent queued delivery and HTTP readers. */
import type { AgentCue, CueEmission } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { CueDelivery, type CueTargetPreparation } from "./cue-delivery.ts";
import { prepareCueEmission } from "./cue-preparation.ts";
import type { Poster, RawCesrRoute } from "./forwarding.ts";
import type { Hab } from "./habbing.ts";
import type { QueryReply } from "./query-replies.ts";

/** Ordered delivery cursors; each HTTP reader independently consumes the same emission records. */
export class DirectReplyDelivery {
  private index = 0;
  private readonly deliveries: CueDelivery[] = [];

  /** All acquisition/publication is synchronous under the guard; no replay reader opens here. */
  static prepare(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    publish: (delivery: DirectReplyDelivery, open: () => ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> | null {
    return this.prepareBatch(runtime, hab, reply, publish);
  }

  /** Transfer an earlier query batch to delivery only, without opening an HTTP response reader. */
  static prepareQueued(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    accept: (delivery: DirectReplyDelivery) => void,
  ): boolean {
    let transferred = false;
    this.prepareBatch(runtime, hab, reply, undefined, (delivery) => {
      accept(delivery);
      transferred = true;
    });
    return transferred;
  }

  /** Interpret one cue for queued targets and the witness callback without signing twice. */
  static prepareCue(
    runtime: AgentRuntime,
    hab: Hab,
    cues: Deck<AgentCue>,
    resolve: (emission: CueEmission) => RawCesrRoute | null,
    accept: (delivery: DirectReplyDelivery, emission: CueEmission | undefined) => void,
  ): boolean {
    const batch = new DirectReplyDelivery();
    return prepareCueEmission(hab, cues, (emission) => {
      if (emission?.kind === "wire") {
        const route = resolve(emission);
        if (route?.targets.length) {
          batch.deliveries.push(new CueDelivery(emission, runtime.hby.habs.get(route.sender) ?? hab, route));
        }
      }
      accept(batch, emission);
      return undefined;
    });
  }

  /** One atomic wire preparation serves either queue-only delivery or the existing two consumers. */
  private static prepareBatch(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    publish?: (delivery: DirectReplyDelivery, open: () => ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>,
    enqueue?: (delivery: DirectReplyDelivery) => void,
  ): ReadableStream<Uint8Array> | null {
    const batch = new DirectReplyDelivery();
    let stream: ReadableStream<Uint8Array> | null = null;
    reply.admit((cues) => {
      const emissions: CueEmission[] = [];
      for (const cue of cues) {
        const emission = hab.interpretCue(cue);
        if (emission?.kind !== "wire") throw new RangeError("Direct reply requires wire");
        emissions.push(emission);
        const sender = ("src" in cue && cue.src ? runtime.hby.habs.get(cue.src) : undefined) ?? hab;
        const route = "dest" in cue && cue.dest
          ? runtime.poster.findBytesRoute(sender, {
            recipient: cue.dest,
            recipientIsPrefix: true,
            topic: cue.kin === "replay" ? "/replay" : "/reply",
          })
          : null;
        if (route?.targets.length) batch.deliveries.push(new CueDelivery(emission, sender, route));
      }
      if (publish) {
        stream = publish(batch, () =>
          runtime.replyStreams.open({
            *[Symbol.iterator]() {
              for (const emission of emissions) yield* emission.messages;
            },
          }));
      } else enqueue!(batch);
      return undefined;
    });
    return stream;
  }

  get hasTargets(): boolean {
    return this.deliveries.length > 0;
  }

  /** Exhausted batches and already prepared packets do not enter a new preparation turn. */
  get needsPreparation(): boolean {
    return this.deliveries[this.index]?.needsPreparation ?? false;
  }

  /** Prepare one target per pass, preserving bounded sibling fairness across reply cues. */
  prepareTarget(poster: Poster): CueTargetPreparation {
    const current = this.deliveries[this.index];
    if (!current) return { kind: "done" };
    const result = current.prepareTarget(poster);
    if (result.kind === "done") {
      this.index++;
      return { kind: "more" };
    }
    return result;
  }

  /** Apply the queue owner's completed transmission or failed-packet transfer to the current cue. */
  retireTarget(): void {
    this.deliveries[this.index].retireTarget();
  }

  /** Close every real delivery iterator; repeated cleanup is harmless. */
  release(): void {
    const deliveries = this.deliveries.splice(0);
    const errors: unknown[] = [];
    for (const delivery of deliveries) {
      try {
        delivery.release();
      } catch (error) {
        if (!errors.includes(error)) errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Direct reply cleanup failed");
  }
}
