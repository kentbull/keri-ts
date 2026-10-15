import type { CueQueueInput } from "../core/cue-publishing.ts";
import { cueDeliveryBudget } from "./cue-budget.ts";
/** One interpreted reply batch owned by delivery and a borrowed HTTP/witness consumer until both close. */
import { ResourceAdmissionError, type ResourcePolicy } from "cesr-ts";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { CueDelivery, type CueTargetPreparation } from "./cue-delivery.ts";
import { prepareCueEmission, type PreparedCueEmission } from "./cue-preparation.ts";
import { prepareCueRoute, type PreparedCueRoute } from "./cue-route.ts";
import type { Poster, RawCesrRoute } from "./forwarding.ts";
import type { Hab } from "./habbing.ts";
import type { QueryReply } from "./query-replies.ts";

/** Queue-only or two-consumer reply lifetime; consumers cannot retain bytes after cleanup. */
export class DirectReplyDelivery {
  private index = 0;
  private borrowDone = false;
  private deliveryDone = false;
  private published = false;
  private readonly owners: PreparedCueEmission[] = [];
  private readonly routes: PreparedCueRoute[] = [];
  private readonly deliveries: { delivery: CueDelivery; route: PreparedCueRoute }[] = [];
  private releaseInput?: () => void;

  /** All acquisition/publication is synchronous under the guard; no replay reader opens here. */
  static prepare(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    publish: (delivery: DirectReplyDelivery, open: () => ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>,
    onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  ): ReadableStream<Uint8Array> | null {
    return this.prepareBatch(runtime, hab, reply, publish, undefined, onAdmissionRefusal);
  }

  /** Transfer an earlier query batch to delivery only, without reserving an HTTP response permit. */
  static prepareQueued(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    accept: (delivery: DirectReplyDelivery) => void,
    onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  ): boolean {
    let transferred = false;
    this.prepareBatch(runtime, hab, reply, undefined, (delivery) => {
      accept(delivery);
      transferred = true;
    }, onAdmissionRefusal);
    return transferred;
  }

  /** Share one admitted cue between queued targets and a scoped witness consumer; neither reinterprets it. */
  static prepareCue(
    runtime: AgentRuntime,
    hab: Hab,
    cues: CueQueueInput,
    resolve: (emission: CueEmission) => RawCesrRoute | null,
    accept: (delivery: DirectReplyDelivery, borrow: PreparedCueEmission) => void,
    onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  ): boolean {
    const batch = new DirectReplyDelivery();
    try {
      const prepared = prepareCueEmission(hab, cues, runtime.resources, (owner) => {
        batch.owners.push(owner);
        if (owner.emission?.kind === "wire") {
          const route = prepareCueRoute(runtime.resources, owner, () =>
            resolve(owner.emission!) ?? {
              sender: hab.pre,
              recipient: "",
              topic: "",
              bodyMode: runtime.hby.cesrBodyMode,
              kind: "direct",
              targets: [],
            }, onAdmissionRefusal);
          batch.routes.push(route);
          if (route.route.targets.length) {
            batch.deliveries.push({
              delivery: new CueDelivery(owner.emission, runtime.hby.habs.get(route.route.sender) ?? hab, route.route),
              route,
            });
          }
        }
        let live = true;
        accept(batch, {
          get emission() {
            if (!live) throw new Error("Witness cue borrow is released");
            return owner.emission;
          },
          retainedBytes: owner.retainedBytes,
          resourcePolicy: owner.resourcePolicy,
          release() {
            if (!live) return;
            live = false;
            batch.closeBorrow();
          },
        });
        return undefined;
      }, onAdmissionRefusal);
      batch.published = prepared;
      batch.finish([]);
      return prepared;
    } finally {
      if (!batch.published) for (const route of batch.routes) route.release();
    }
  }

  /** One atomic wire preparation serves either queue-only delivery or the existing two consumers. */
  private static prepareBatch(
    runtime: AgentRuntime,
    hab: Hab,
    reply: QueryReply,
    publish?: (delivery: DirectReplyDelivery, open: () => ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>,
    enqueue?: (delivery: DirectReplyDelivery) => void,
    onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  ): ReadableStream<Uint8Array> | null {
    const batch = new DirectReplyDelivery();
    batch.borrowDone = !publish;
    const responseBytes = publish ? runtime.replyStreams.preparationByteFloor : 0;
    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      reply.admit((cues, release) => {
        batch.releaseInput = release;
        const preparationBytes = responseBytes + cues.length * cueDeliveryBudget.preparationFloorBytes;
        if (reply.retainedBytes + preparationBytes > runtime.resources.limits.bytes) {
          const refusal = new ResourceAdmissionError("Direct reply preparation exceeds shared byte capacity", "limit");
          onAdmissionRefusal?.(refusal);
          throw refusal;
        }
        let response: ReturnType<AgentRuntime["replyStreams"]["prepare"]> | undefined;
        try {
          // One synchronous combined preflight guarantees all internal acquisitions before signing.
          const combined = runtime.resources.reserve({
            streams: publish ? 1 : 0,
            bytes: preparationBytes,
          });
          if (combined.kind === "refuse") {
            const refusal = new ResourceAdmissionError("Direct reply preparation refused", combined.reason);
            onAdmissionRefusal?.(refusal);
            throw refusal;
          }
          combined.reservation.release();
          if (publish) response = runtime.replyStreams.prepare(onAdmissionRefusal);
          const prepare = (index: number): void => {
            if (index === cues.length) {
              if (publish) {
                stream = publish(batch, () =>
                  response!.open({
                    *[Symbol.iterator]() {
                      for (const owner of batch.owners) yield* owner.emission!.messages;
                    },
                  }, () => batch.closeBorrow()));
              } else enqueue!(batch);
              batch.published = true;
              return;
            }
            prepareCueEmission(hab, new Deck<AgentCue>([cues[index]]), runtime.resources, (owner) => {
              if (owner.emission?.kind !== "wire") throw new RangeError("Direct reply requires wire");
              batch.owners.push(owner);
              const route = prepareCueRoute(runtime.resources, owner, () => {
                const cue = owner.emission!.cue;
                const sender = ("src" in cue && cue.src ? runtime.hby.habs.get(cue.src) : undefined) ?? hab;
                return ("dest" in cue && cue.dest
                  ? runtime.poster.findBytesRoute(sender, {
                    recipient: cue.dest,
                    recipientIsPrefix: true,
                    topic: cue.kin === "replay" ? "/replay" : "/reply",
                  })
                  : null)
                  ?? {
                    sender: sender.pre,
                    recipient: "",
                    topic: "",
                    bodyMode: runtime.hby.cesrBodyMode,
                    kind: "direct",
                    targets: [],
                  };
              }, onAdmissionRefusal);
              batch.routes.push(route);
              if (route.route.targets.length) {
                const sender = runtime.hby.habs.get(route.route.sender) ?? hab;
                batch.deliveries.push({ delivery: new CueDelivery(owner.emission, sender, route.route), route });
              }
              prepare(index + 1);
              return undefined;
            }, onAdmissionRefusal);
          };
          prepare(0);
        } finally {
          response?.release();
        }
        return undefined;
      });
      // Queue-only no-target cleanup must wait until every nested preparation and the reply slot transfer finish.
      batch.finish([]);
      return stream;
    } finally {
      if (!batch.published) for (const route of batch.routes) route.release();
    }
  }

  get hasTargets(): boolean {
    return this.deliveries.length > 0;
  }

  /** Exhausted batches and already prepared packets do not enter a new preparation turn. */
  get needsPreparation(): boolean {
    return this.deliveries[this.index]?.delivery.needsPreparation ?? false;
  }

  /** Prepare one target per pass, preserving bounded sibling fairness across reply cues. */
  prepareTarget(poster: Poster, resources: ResourcePolicy): CueTargetPreparation {
    const current = this.deliveries[this.index]?.delivery;
    if (!current) return { kind: "done" };
    const result = current.prepareTarget(poster, resources);
    if (result.kind === "done") {
      this.index++;
      return { kind: "more" };
    }
    return result;
  }

  /** Apply the queue owner's completed transmission or failed-packet transfer to the current cue. */
  retireTarget(outcome: "sent" | "retained"): void {
    this.deliveries[this.index].delivery.retireTarget(outcome);
  }

  /** Queue cleanup joins network before marking its half complete; attempt every independent owner. */
  release(): void {
    if (this.deliveryDone) return;
    this.deliveryDone = true;
    // Route credit retires with queued delivery, even while an HTTP borrower retains emission bytes.
    const cleanups = this.deliveries.flatMap(({ delivery, route }) => [
      () => delivery.release(),
      () => route.release(),
    ]);
    this.deliveries.length = 0;
    this.finish(cleanups);
  }
  private closeBorrow(): void {
    this.borrowDone = true;
    if (this.published) this.finish([]);
  }
  private finish(cleanups: (() => void)[]): void {
    if (this.published && this.borrowDone && this.deliveryDone) {
      const releaseInput = this.releaseInput;
      cleanups.push(
        ...this.routes.map((route) => () => route.release()),
        ...this.owners.map((owner) => () => owner.release()),
        () => releaseInput?.(),
      );
      this.routes.length = this.owners.length = 0;
      this.releaseInput = undefined;
    }
    const errors: unknown[] = [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        if (!errors.includes(error)) errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Direct reply cleanup failed");
  }
}
