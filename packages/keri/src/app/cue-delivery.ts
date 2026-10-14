/** One captured cue cursor plus independently owned failed packets on the existing runtime delivery queue. */
import { ResourceAdmissionError, ResourceLimitError, type ResourceReservation } from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import type { AgentRuntime } from "./agent-runtime.ts";
import { CesrHttpRefusal } from "./cesr-egress.ts";
import type { PreparedCueEmission } from "./cue-preparation.ts";
import { type PreparedCesrTarget, type RawCesrRoute, sendPreparedCesrTarget } from "./forwarding.ts";
import type { Hab } from "./habbing.ts";

const wireBytes = 8 * 1024 ** 2, preparationBytes = 3 * wireBytes;

/** Exact independent wire and its credit; cleanup precedes release or transfer. */
export interface OwnedCueTarget {
  readonly target: PreparedCesrTarget;
  release(): void;
}

/** Keep packet closures independent of the original cue, habitat and cursor. */
function ownTarget(value: PreparedCesrTarget | undefined, credit: ResourceReservation): OwnedCueTarget {
  return {
    get target() {
      if (!value) throw new Error("Cue target owner is released");
      return value;
    },
    release() {
      value = undefined;
      credit.release();
    },
  };
}

/** Local owner progress only: pending work proves neither durable transfer nor protocol acceptance. */
export type CueDeliveryStep = "done" | "more" | "pending";

/** Keep one lazy extent/current message and one target; failed packets transfer into admitted queue slots. */
export class CueDelivery {
  private iterator?: Iterator<Uint8Array>;
  private message?: Uint8Array;
  private targetIndex = 0;
  private prepared?: OwnedCueTarget;
  private released = false;
  constructor(
    private readonly owner: PreparedCueEmission,
    private readonly hab: Hab,
    private readonly route: RawCesrRoute,
  ) {
    if (route.sender !== hab.pre || !route.targets.length) throw new RangeError("Invalid cue delivery route");
  }

  /** One target per pass permits other admitted owners to progress; preparation alone runs under Reactor. */
  *step(
    runtime: AgentRuntime,
    signal: AbortSignal,
    retainFailed: (target: OwnedCueTarget) => boolean,
  ): Operation<CueDeliveryStep> {
    signal.throwIfAborted();
    if (!this.prepared) {
      let done = false, busy = false;
      // deno-lint-ignore no-this-alias -- Guarded generator callbacks have no lexical this.
      const self = this;
      yield* runtime.reactor.settle(undefined, {}, function*() {
        const admitted = runtime.resources.reserve({ bytes: preparationBytes });
        if (admitted.kind === "refuse") {
          if (admitted.reason === "busy") {
            busy = true;
            return;
          }
          throw new ResourceAdmissionError("Cue target preparation refused", admitted.reason);
        }
        let transferred = false;
        try {
          if (!self.message) {
            self.iterator ??= self.owner.emission!.messages[Symbol.iterator]();
            const next = self.iterator.next();
            if (next.done) {
              done = true;
              return;
            }
            self.message = next.value;
            if (!(self.message instanceof Uint8Array)) throw new TypeError("Cue message must be binary");
            if (self.message.buffer.byteLength > wireBytes) {
              throw new ResourceLimitError("Cue message backing exceeds limit");
            }
          }
          const target = runtime.poster.prepareBytesTarget(
            self.hab,
            self.route,
            self.targetIndex,
            self.message,
            wireBytes,
          );
          self.prepared = ownTarget(target, admitted.reservation);
          transferred = true;
        } finally {
          if (!transferred) admitted.reservation.release();
        }
      });
      if (done) return "done";
      if (busy) return "pending";
    }
    let refusal: CesrHttpRefusal | undefined;
    try {
      yield* call(() =>
        sendPreparedCesrTarget(this.prepared!.target, runtime.services, signal, (error) => refusal = error)
      );
    } catch (error) {
      // Only an actual non-ok HTTP response permits independent failed-wire retention; other failures propagate.
      signal.throwIfAborted();
      if (error instanceof ResourceAdmissionError && error.reason === "busy") return "pending";
      if (error !== refusal) throw error;
      if (!retainFailed(this.prepared!)) return "pending";
      this.prepared = undefined;
      this.advance();
      return "more";
    }
    signal.throwIfAborted();
    this.prepared!.release();
    this.prepared = undefined;
    this.advance();
    return "more";
  }

  /** Advance only joined transmission or successful independent live transfer; never claim remote acceptance. */
  private advance(): void {
    if (++this.targetIndex === this.route.targets.length) {
      this.targetIndex = 0;
      this.message = undefined;
    }
  }

  /** Queue acknowledgement/shutdown releases retained evidence after the active transport has joined. */
  release(): void {
    if (this.released) return;
    this.iterator?.return?.();
    this.prepared?.release();
    this.owner.release();
    this.released = true;
    this.iterator = this.message = undefined;
    this.prepared = undefined;
  }
}
