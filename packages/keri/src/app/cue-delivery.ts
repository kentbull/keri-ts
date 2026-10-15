/** One captured cue cursor and its current prepared packet. */
import type { CueEmission } from "../core/cues.ts";
import type { Poster, PreparedCesrTarget, RawCesrRoute } from "./forwarding.ts";
import type { Hab } from "./habbing.ts";

/** A batch may advance between cues without producing a packet. */
export type CueTargetPreparation =
  | { kind: "target"; target: PreparedCesrTarget }
  | { kind: "done" | "more" };

/** Keep one lazy extent/current message and one target; failed packets remain ordinary delivery records. */
export class CueDelivery {
  private emission?: CueEmission;
  private iterator?: Iterator<Uint8Array>;
  private message?: Uint8Array;
  private targetIndex = 0;
  private prepared?: PreparedCesrTarget;
  private released = false;
  constructor(
    emission: CueEmission,
    private readonly hab: Hab,
    private readonly routing: RawCesrRoute,
  ) {
    this.emission = emission;
    if (routing.sender !== hab.pre || !routing.targets.length) {
      throw new RangeError("Invalid cue delivery route");
    }
  }

  /** Existing packets need no guarded preparation or protocol-side cue capture. */
  get needsPreparation(): boolean {
    return !this.prepared;
  }

  /** Prepare one target synchronously; the queue schedules and transmits its ordinary wire record. */
  prepareTarget(poster: Poster): CueTargetPreparation {
    if (this.prepared) return { kind: "target", target: this.prepared };
    if (!this.message) {
      this.iterator ??= this.emission!.messages[Symbol.iterator]();
      const next = this.iterator.next();
      if (next.done) return { kind: "done" };
      this.message = next.value;
      if (!(this.message instanceof Uint8Array)) throw new TypeError("Cue message must be binary");
    }
    this.prepared = poster.prepareBytesTarget(this.hab, this.routing, this.targetIndex, this.message);
    return { kind: "target", target: this.prepared };
  }

  /** Advance only after joined transmission or transfer to the failed-packet queue. */
  retireTarget(): void {
    if (!this.prepared) throw new Error("Cue target has not been prepared");
    this.prepared = undefined;
    this.advance();
  }

  /** Advance only joined transmission or successful independent live transfer; never claim remote acceptance. */
  private advance(): void {
    if (++this.targetIndex === this.routing.targets.length) {
      this.targetIndex = 0;
      this.message = undefined;
    }
  }

  /** Close the actual replay iterator once, including when its return method fails. */
  release(): void {
    if (this.released) return;
    this.released = true;
    try {
      this.iterator?.return?.();
    } finally {
      this.emission = undefined;
      this.iterator = this.message = undefined;
      this.prepared = undefined;
    }
  }
}
