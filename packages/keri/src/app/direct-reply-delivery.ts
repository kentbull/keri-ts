/** One interpreted reply batch owned by delivery and a borrowed HTTP/witness consumer until both close. */
import { ResourceAdmissionError } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { reserveCueBytes } from "../core/cue-admission.ts";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { CueDelivery, type OwnedCueTarget } from "./cue-delivery.ts";
import { prepareCueEmission, type PreparedCueEmission } from "./cue-preparation.ts";
import { prepareCueRoute, type PreparedCueRoute } from "./cue-route.ts";
import type { RawCesrRoute } from "./forwarding.ts";
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
  private readonly deliveries: CueDelivery[] = [];
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
    cues: Deck<AgentCue>,
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
            batch.deliveries.push(
              new CueDelivery(
                {
                  get emission() {
                    return owner.emission;
                  },
                  retainedBytes: owner.retainedBytes,
                  resourcePolicy: owner.resourcePolicy,
                  release() {},
                },
                runtime.hby.habs.get(route.route.sender) ?? hab,
                route,
              ),
            );
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
        const before = runtime.resources.used.bytes;
        const input = reserveCueBytes(runtime.resources, cues, undefined, onAdmissionRefusal, {
          additionalBytes: reply.retainedBytes + responseBytes
            + cues.length * 33 * 1024 ** 2,
          maxBytes: 8 * 1024 ** 2,
        });
        let response: ReturnType<AgentRuntime["replyStreams"]["prepare"]> | undefined;
        try {
          // One synchronous combined preflight guarantees all internal acquisitions before signing.
          const combined = runtime.resources.reserve({
            streams: publish ? 1 : 0,
            bytes: responseBytes + cues.length * 33 * 1024 ** 2
              + 2 * (runtime.resources.used.bytes - before),
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
                batch.deliveries.push(
                  new CueDelivery(
                    {
                      get emission() {
                        return owner.emission;
                      },
                      retainedBytes: owner.retainedBytes,
                      resourcePolicy: owner.resourcePolicy,
                      release() {},
                    },
                    sender,
                    route,
                  ),
                );
              }
              prepare(index + 1);
              return undefined;
            }, onAdmissionRefusal);
          };
          prepare(0);
        } finally {
          response?.release();
          input.release();
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

  /** One target per pass, preserving the queue's bounded sibling fairness and exact failed packets. */
  *step(
    runtime: AgentRuntime,
    signal: AbortSignal,
    retainFailed: (target: OwnedCueTarget) => boolean,
  ): Operation<"done" | "more" | "pending"> {
    const current = this.deliveries[this.index];
    if (!current) return "done";
    const result = yield* current.step(runtime, signal, retainFailed);
    if (result === "done") {
      this.index++;
      return "more";
    }
    return result;
  }

  /** Queue cleanup joins network before marking its half complete; attempt every independent owner. */
  release(): void {
    if (this.deliveryDone) return;
    this.deliveryDone = true;
    const cleanups = this.deliveries.map((delivery) => () => delivery.release());
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
