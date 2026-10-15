import type { AgentCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import { cueDeliveryBudget } from "./cue-budget.ts";
/** Synchronous admitted cue interpretation; destination owners provide retention and joined delivery. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, type ResourceReservation } from "cesr-ts";
import type { CueEmission } from "../core/cues.ts";
import type { Hab } from "./habbing.ts";

const { wireBytes, preparationBytes } = cueDeliveryBudget;

/** Borrow emission/evidence until the accepting delivery owner finishes consumption and joined cleanup. */
export interface PreparedCueEmission {
  readonly emission: CueEmission | undefined;
  /** Admitted output bytes, excluding temporary interpretation credit. */
  readonly retainedBytes: number;
  readonly resourcePolicy: ResourcePolicy;
  /** Called by the accepting owner after joined cleanup; repeated calls are harmless. */
  release(): void;
}

/** Expected cue preparation refusal from remaining output accounting. */
export type CuePreparationRefusal = { kind: "refuse"; error: ResourceAdmissionError };

/** Synchronous source-head preparation outcome. */
export type CuePreparationResult = { kind: "prepared" } | { kind: "empty" } | CuePreparationRefusal;

/** Strict preparation boundary for callers whose policy is to fail on occupied capacity. */
export function prepareCueEmission(
  hab: Hab | null,
  cues: Deck<AgentCue>,
  resources: ResourcePolicy,
  accept: (owner: PreparedCueEmission) => undefined,
  onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  transformEmission?: (emission: CueEmission) => CueEmission,
): boolean {
  const result = admitCueEmission(hab, cues, resources, accept, transformEmission);
  if (result.kind === "refuse") {
    if (result.error instanceof ResourceAdmissionError) onAdmissionRefusal?.(result.error);
    throw result.error;
  }
  return result.kind === "prepared";
}

/**
 * Interpret one ordinary source record and publish it synchronously to the consumer.
 * Failed interpretation or acceptance leaves the source head available for retry.
 * Replay iterators remain unopened here. Output accounting is a separate remaining
 * removal; cue records no longer carry retention credit or ownership handles.
 */
export function admitCueEmission(
  hab: Hab | null,
  cues: Deck<AgentCue>,
  resources: ResourcePolicy,
  accept: (owner: PreparedCueEmission) => undefined | CuePreparationRefusal,
  transformEmission?: (emission: CueEmission) => CueEmission,
): CuePreparationResult {
  const source = cues;
  const cue = source.peekHead();
  if (!cue) return { kind: "empty" };
  if (wireBytes + preparationBytes > resources.limits.bytes) {
    return {
      kind: "refuse",
      error: new ResourceAdmissionError("Cue interpretation exceeds shared byte capacity", "limit"),
    };
  }
  let output: ResourceReservation | undefined;
  let preparation: ResourceReservation | undefined;
  let published = false, live = true;
  let emission: CueEmission | undefined;
  try {
    const retained = resources.reserve({ bytes: wireBytes });
    if (retained.kind === "refuse") {
      return { kind: "refuse", error: new ResourceAdmissionError("Cue output admission refused", retained.reason) };
    }
    output = retained.reservation;
    const temporary = resources.reserve({ bytes: preparationBytes });
    if (temporary.kind === "refuse") {
      return {
        kind: "refuse",
        error: new ResourceAdmissionError("Cue interpretation admission refused", temporary.reason),
      };
    }
    preparation = temporary.reservation;
    emission = hab ? hab.interpretCue(cue) : {
      cue,
      messages: [],
      kind: cue.kin === "stream" ? "transport" as const : "notify" as const,
    };
    if (emission && transformEmission) emission = transformEmission(emission);
    if (emission && Array.isArray(emission.messages)) {
      const backing = new Set<ArrayBufferLike>();
      let size = 0;
      for (let index = 0; index < emission.messages.length; index++) {
        const message = emission.messages[index];
        if (!(message instanceof Uint8Array)) throw new TypeError("Cue output must be binary");
        if (!backing.has(message.buffer)) {
          backing.add(message.buffer);
          size += message.buffer.byteLength;
        }
      }
      if (size > wireBytes) throw new ResourceLimitError("Cue output exceeds finite interpretation limit");
    }
    const owner: PreparedCueEmission = {
      retainedBytes: wireBytes,
      resourcePolicy: resources,
      get emission() {
        if (!live) throw new Error("Cue emission owner is released");
        return emission;
      },
      release() {
        if (!live) return;
        if (!published) throw new Error("Cue emission has not transferred");
        live = false;
        emission = undefined;
        output!.release();
      },
    };
    const accepted = accept(owner);
    if (accepted?.kind === "refuse") return accepted;
    if (accepted !== undefined) throw new TypeError("Cue acceptance must be synchronous and return void or refusal");
    if (source.peekHead() !== cue) throw new Error("Cue head changed during acceptance");
    source.pull();
    published = true;
    return { kind: "prepared" };
  } finally {
    preparation?.release();
    if (!published) {
      live = false;
      emission = undefined;
      output?.release();
    }
  }
}
