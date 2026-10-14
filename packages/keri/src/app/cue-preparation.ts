/** Synchronous admitted cue interpretation; destination owners provide retention and joined delivery. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, type ResourceReservation } from "cesr-ts";
import { CueDeck, type OwnedCue, reserveCueBytes } from "../core/cue-admission.ts";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import type { Hab } from "./habbing.ts";

// Local finite policy matches RuntimeDeliveries' 8 MiB retained wire plus 24 MiB preparation allowance.
const wireBytes = 8 * 1024 ** 2, preparationBytes = 3 * wireBytes;

/** Borrow emission/evidence until the accepting delivery owner finishes consumption and joined cleanup. */
export interface PreparedCueEmission {
  readonly emission: CueEmission | undefined;
  /** Called by the accepting owner after joined cleanup; repeated calls are harmless. */
  release(): void;
}

/**
 * Caller preflights its existing destination item slot under the guard. Accept must
 * immediately and atomically retain this owner, or throw without publishing it;
 * async acceptance, source mutation and early release are forbidden. Failed preparation leaves the original cue/credit
 * available for retry. Replay metadata stays borrowed and unopened, never collected.
 * This is logical copy/retention allowance, not a decoded/capture/native allocation bound.
 */
export function prepareCueEmission(
  hab: Hab | null,
  cues: Deck<AgentCue>,
  resources: ResourcePolicy,
  accept: (owner: PreparedCueEmission) => undefined,
): boolean {
  const cue = cues.peekHead();
  if (!cue) return false;
  if (cues instanceof CueDeck && cues.resourcePolicy !== resources) {
    throw new RangeError("Cue interpretation requires the source deck's exact policy");
  }
  const heldInput = cues instanceof CueDeck ? cues.headRetentionBytes() : 0;
  if (heldInput + wireBytes + preparationBytes > resources.limits.bytes) {
    throw new ResourceAdmissionError("Cue interpretation exceeds shared byte capacity", "limit");
  }
  let input: ResourceReservation | undefined, output: ResourceReservation | undefined;
  let preparation: ResourceReservation | undefined, original: OwnedCue | undefined;
  let published = false, live = true;
  let emission: CueEmission | undefined;
  try {
    if (!(cues instanceof CueDeck)) {
      const before = resources.used.bytes;
      input = reserveCueBytes(resources, [cue]);
      // Synchronous inspection has no yield; classify this operation's own combined floor before contention.
      if (resources.used.bytes - before + wireBytes + preparationBytes > resources.limits.bytes) {
        throw new ResourceAdmissionError("Cue retention and interpretation exceed shared capacity", "limit");
      }
    }
    const retained = resources.reserve({ bytes: wireBytes });
    if (retained.kind === "refuse") throw new ResourceAdmissionError("Cue output admission refused", retained.reason);
    output = retained.reservation;
    const temporary = resources.reserve({ bytes: preparationBytes });
    if (temporary.kind === "refuse") {
      throw new ResourceAdmissionError("Cue interpretation admission refused", temporary.reason);
    }
    preparation = temporary.reservation;
    if (cues instanceof CueDeck) original = cues.takeOwned()!;
    emission = hab ? hab.interpretCue(cue) : {
      cue,
      messages: [],
      kind: cue.kin === "stream" ? "transport" as const : "notify" as const,
    };
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
    const accepted: unknown = accept(owner);
    if (accepted !== undefined) throw new TypeError("Cue acceptance must be synchronous and return void");
    if (!(cues instanceof CueDeck)) {
      if (cues.peekHead() !== cue) throw new Error("Cue head changed during acceptance");
      cues.pull();
    }
    published = true;
    return true;
  } finally {
    preparation?.release();
    if (!published) {
      live = false;
      emission = undefined;
      try {
        if (original && cues instanceof CueDeck) cues.requeue(original);
      } finally {
        input?.release();
        output?.release();
      }
    }
  }
}
