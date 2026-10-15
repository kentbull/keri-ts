import type { CueQueueInput } from "../core/cue-publishing.ts";
import { cueDeliveryBudget } from "./cue-budget.ts";
/** Synchronous admitted cue interpretation; destination owners provide retention and joined delivery. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, type ResourceReservation } from "cesr-ts";
import { admitCueBytes, type CueByteReservation, type OwnedCue } from "../core/cue-admission.ts";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck, type DeckFullError } from "../core/deck.ts";
import type { Hab } from "./habbing.ts";

const { wireBytes, preparationBytes } = cueDeliveryBudget;

/** Borrow emission/evidence until the accepting delivery owner finishes consumption and joined cleanup. */
export interface PreparedCueEmission {
  readonly emission: CueEmission | undefined;
  /** Irreducible input retention plus admitted output, excluding temporary interpretation credit. */
  readonly retainedBytes: number;
  readonly resourcePolicy: ResourcePolicy;
  /** Called by the accepting owner after joined cleanup; repeated calls are harmless. */
  release(): void;
}

/** Expected cue preparation refusal, including an accepting queue's occupied item slot. */
export type CuePreparationRefusal = { kind: "refuse"; error: ResourceAdmissionError | DeckFullError };

/** Synchronous source-head preparation outcome. */
export type CuePreparationResult = { kind: "prepared" } | { kind: "empty" } | CuePreparationRefusal;

/** Strict preparation boundary for callers whose policy is to fail on occupied capacity. */
export function prepareCueEmission(
  hab: Hab | null,
  cues: CueQueueInput,
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
 * Caller preflights its existing destination item slot under the guard. Accept must
 * immediately and atomically retain this owner, or refuse/throw without publishing it;
 * async acceptance, source mutation and early release are forbidden. Optional local
 * transformation runs within preparation credit and the final finite output check.
 * Failed preparation leaves the original cue/credit
 * available for retry. Replay metadata stays borrowed and unopened, never collected.
 * This is logical copy/retention allowance, not a decoded/capture/native allocation bound.
 */
export function admitCueEmission(
  hab: Hab | null,
  cues: CueQueueInput,
  resources: ResourcePolicy,
  accept: (owner: PreparedCueEmission) => undefined | CuePreparationRefusal,
  transformEmission?: (emission: CueEmission) => CueEmission,
): CuePreparationResult {
  const source = cues, owned = source instanceof Deck ? undefined : source;
  const cue = source.peekHead();
  if (!cue) return { kind: "empty" };
  if (owned && owned.resourcePolicy !== resources) {
    throw new RangeError("Cue interpretation requires the source deck's exact policy");
  }
  const heldInput = owned?.headRetentionBytes() ?? 0;
  if (heldInput + wireBytes + preparationBytes > resources.limits.bytes) {
    return {
      kind: "refuse",
      error: new ResourceAdmissionError("Cue interpretation exceeds shared byte capacity", "limit"),
    };
  }
  let input: CueByteReservation | undefined;
  let output: ResourceReservation | undefined;
  let preparation: ResourceReservation | undefined, original: OwnedCue | undefined;
  let inputBytes = heldInput;
  let published = false, live = true;
  let emission: CueEmission | undefined;
  try {
    if (!owned) {
      const admission = admitCueBytes(resources, [cue]);
      if (admission.kind === "refuse") return admission;
      input = admission.reservation;
      inputBytes = input.bytes;
      // Synchronous inspection has no yield; classify this operation's own combined floor before contention.
      if (inputBytes + wireBytes + preparationBytes > resources.limits.bytes) {
        return {
          kind: "refuse",
          error: new ResourceAdmissionError("Cue retention and interpretation exceed shared capacity", "limit"),
        };
      }
    }
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
    if (owned) original = owned.takeOwned()!;
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
      retainedBytes: inputBytes + wireBytes,
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
        original?.release();
        input?.release();
        output!.release();
      },
    };
    const accepted = accept(owner);
    if (accepted?.kind === "refuse") return accepted;
    if (accepted !== undefined) throw new TypeError("Cue acceptance must be synchronous and return void or refusal");
    if (source instanceof Deck) {
      if (source.peekHead() !== cue) throw new Error("Cue head changed during acceptance");
      source.pull();
    }
    published = true;
    return { kind: "prepared" };
  } finally {
    preparation?.release();
    if (!published) {
      live = false;
      emission = undefined;
      try {
        if (original) owned!.requeue(original);
      } finally {
        input?.release();
        output?.release();
      }
    }
  }
}
