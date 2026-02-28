import type { Versionage } from "../tables/table-types.ts";
import type { CesrFrame, CesrMessage } from "./types.ts";

/** Pending top-level frame state awaiting continuation parsing. */
export interface PendingFrameState {
  frame: CesrMessage;
  version: Versionage;
}

/**
 * Manages deferred frame emission lifecycle for parser orchestration.
 *
 * Contract reminder:
 * - `pendingFrame` is older than any `queuedFrames`.
 * - flush order must preserve stream encounter order.
 */
export class DeferredFrameLifecycle {
  private pendingFrame: PendingFrameState | null = null;
  private queuedFrames: CesrMessage[] = [];

  /** Current pending top-level frame continuation, if any. */
  get pending(): PendingFrameState | null {
    return this.pendingFrame;
  }

  /** Whether enclosed deferred frames are queued for emission. */
  hasQueued(): boolean {
    return this.queuedFrames.length > 0;
  }

  /** Store a pending top-level frame continuation. */
  setPending(frame: CesrMessage, version: Versionage): void {
    this.pendingFrame = { frame, version };
  }

  /** Clear pending top-level frame continuation state. */
  clearPending(): void {
    this.pendingFrame = null;
  }

  /** Append enclosed frames parsed from one bounded GenericGroup payload. */
  enqueueQueued(frames: CesrMessage[]): void {
    if (frames.length === 0) {
      return;
    }
    this.queuedFrames.push(...frames);
  }

  /** Emit next queued enclosed frame (FIFO) when no pending frame remains. */
  shiftQueued(): CesrMessage | undefined {
    return this.queuedFrames.shift();
  }

  /**
   * Flush deferred frames in normative order: pending first, queued next.
   * Buffer-remainder shortage handling is outside this collaborator.
   */
  flushDeferred(): CesrFrame[] {
    const out: CesrFrame[] = [];

    if (this.pendingFrame) {
      out.push({ type: "frame", frame: this.pendingFrame.frame });
      this.pendingFrame = null;
    }

    while (this.queuedFrames.length > 0) {
      const frame = this.queuedFrames.shift();
      if (frame) {
        out.push({ type: "frame", frame });
      }
    }

    return out;
  }

  /** Clear all deferred frame lifecycle state. */
  reset(): void {
    this.pendingFrame = null;
    this.queuedFrames = [];
  }
}
