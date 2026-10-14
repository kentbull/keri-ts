/** One interpreted reply batch borrowed by HTTP and the existing delivery queue until both close. */
import { ResourceAdmissionError } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { reserveCueBytes } from "../core/cue-admission.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import type { AgentRuntime } from "./agent-runtime.ts";
import { CueDelivery, type OwnedCueTarget } from "./cue-delivery.ts";
import { prepareCueEmission, type PreparedCueEmission } from "./cue-preparation.ts";
import { prepareCueRoute, type PreparedCueRoute } from "./cue-route.ts";
import type { Hab } from "./habbing.ts";
import type { QueryReply } from "./query-replies.ts";

/** Domain-specific two-consumer lifetime; neither consumer may retain bytes after its cleanup. */
export class DirectReplyDelivery {
  private index = 0;
  private responseDone = false;
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
  ): ReadableStream<Uint8Array> | null {
    const batch = new DirectReplyDelivery();
    let stream: ReadableStream<Uint8Array> | null = null;
    try {
      reply.admit((cues, release) => {
        batch.releaseInput = release;
        const before = runtime.resources.used.bytes;
        const input = reserveCueBytes(runtime.resources, cues, undefined, undefined, {
          additionalBytes: reply.retainedBytes + runtime.replyStreams.preparationByteFloor
            + cues.length * 33 * 1024 ** 2,
          maxBytes: 8 * 1024 ** 2,
        });
        let response: ReturnType<AgentRuntime["replyStreams"]["prepare"]> | undefined;
        try {
          // One synchronous combined preflight guarantees all internal acquisitions before signing.
          const combined = runtime.resources.reserve({
            streams: 1,
            bytes: runtime.replyStreams.preparationByteFloor + cues.length * 33 * 1024 ** 2
              + 2 * (runtime.resources.used.bytes - before),
          });
          if (combined.kind === "refuse") {
            throw new ResourceAdmissionError("Direct reply preparation refused", combined.reason);
          }
          combined.reservation.release();
          response = runtime.replyStreams.prepare();
          const prepare = (index: number): void => {
            if (index === cues.length) {
              stream = publish(batch, () =>
                response!.open({
                  *[Symbol.iterator]() {
                    for (const owner of batch.owners) yield* owner.emission!.messages;
                  },
                }, () => batch.closeResponse()));
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
              });
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
            });
          };
          prepare(0);
        } finally {
          response?.release();
          input.release();
        }
        return undefined;
      });
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
  private closeResponse(): void {
    this.responseDone = true;
    if (this.published) this.finish([]);
  }
  private finish(cleanups: (() => void)[]): void {
    if (this.responseDone && this.deliveryDone) {
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
