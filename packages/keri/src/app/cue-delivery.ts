/** One captured cue cursor plus independently owned failed packets on the existing runtime delivery queue. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, type ResourceReservation } from "cesr-ts";
import { cueDeliveryBudget } from "./cue-budget.ts";
import type { PreparedCueEmission } from "./cue-preparation.ts";
import type { PreparedCueRoute } from "./cue-route.ts";
import type { Poster, PreparedCesrTarget } from "./forwarding.ts";
import type { Hab } from "./habbing.ts";

const { wireBytes, preparationBytes } = cueDeliveryBudget;

/** Exact independent wire and its credit; cleanup precedes release or transfer. */
export interface OwnedCueTarget {
  readonly target: PreparedCesrTarget;
  release(): void;
}

/** Concrete preparation result; a batch may advance between cues without producing a packet. */
export type CueTargetPreparation =
  | { kind: "target"; owner: OwnedCueTarget }
  | { kind: "done" | "more" | "pending" };

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
    private readonly routing: PreparedCueRoute,
  ) {
    if (routing.route.sender !== hab.pre || !routing.route.targets.length) {
      throw new RangeError("Invalid cue delivery route");
    }
  }

  /** Prepare one finite target synchronously; the queue owner schedules and transmits it. */
  prepareTarget(poster: Poster, resources: ResourcePolicy): CueTargetPreparation {
    if (this.prepared) return { kind: "target", owner: this.prepared };
    const admitted = resources.reserve({ bytes: preparationBytes });
    if (admitted.kind === "refuse") {
      if (admitted.reason === "busy") return { kind: "pending" };
      throw new ResourceAdmissionError("Cue target preparation refused", admitted.reason);
    }
    let transferred = false;
    try {
      if (!this.message) {
        this.iterator ??= this.owner.emission!.messages[Symbol.iterator]();
        const next = this.iterator.next();
        if (next.done) return { kind: "done" };
        this.message = next.value;
        if (!(this.message instanceof Uint8Array)) throw new TypeError("Cue message must be binary");
        if (this.message.buffer.byteLength > wireBytes) {
          throw new ResourceLimitError("Cue message backing exceeds limit");
        }
      }
      const target = poster.prepareBytesTarget(this.hab, this.routing.route, this.targetIndex, this.message, wireBytes);
      this.prepared = ownTarget(target, admitted.reservation);
      transferred = true;
      return { kind: "target", owner: this.prepared };
    } finally {
      if (!transferred) admitted.reservation.release();
    }
  }

  /** Retire only after joined transmission or successful transfer to the failed-packet queue. */
  retireTarget(outcome: "sent" | "retained"): void {
    if (!this.prepared) throw new Error("Cue target has not been prepared");
    if (outcome === "sent") this.prepared.release();
    this.prepared = undefined;
    this.advance();
  }

  /** Advance only joined transmission or successful independent live transfer; never claim remote acceptance. */
  private advance(): void {
    if (++this.targetIndex === this.routing.route.targets.length) {
      this.targetIndex = 0;
      this.message = undefined;
    }
  }

  /** Queue acknowledgement/shutdown releases retained evidence after the active transport has joined. */
  release(): void {
    if (this.released) return;
    this.released = true;
    const errors: unknown[] = [];
    for (
      const cleanup of [
        () => this.iterator?.return?.(),
        () => this.prepared?.release(),
        () => this.owner.release(),
        () => this.routing.release(),
      ]
    ) {
      try {
        cleanup();
      } catch (error) {
        if (!errors.includes(error)) errors.push(error);
      }
    }
    this.iterator = this.message = undefined;
    this.prepared = undefined;
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Cue delivery cleanup failed");
  }
}
