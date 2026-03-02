/**
 * Strategy interface for frame-boundary and emission cadence behavior.
 *
 * Implementations encapsulate framed/unframed decisions so parser collaborators
 * can delegate policy checks without branching on raw booleans.
 */
export interface FrameBoundaryPolicy {
  /** Whether one queued-frame emission should end the current drain cycle. */
  shouldStopAfterQueuedFrameEmission(): boolean;
  /** Whether one completed frame emission should end the current drain cycle. */
  shouldStopAfterCompletedFrameEmission(): boolean;
  /** Whether one collected attachment group should end local collection loops. */
  shouldStopAfterAttachmentGroupCollection(): boolean;
  /** Whether pending continuation should emit after one attachment append. */
  shouldEmitPendingAfterAttachmentResume(): boolean;
  /** Whether a body-only frame at end-of-buffer should be deferred as pending. */
  shouldDeferBodyOnlyFrame(
    attachmentCount: number,
    remainingBufferLength: number,
  ): boolean;
}

/**
 * Greedy frame-boundary policy for `framed=false` mode.
 *
 * What:
 * - continue draining as long as parse boundaries permit
 * - continue collecting contiguous attachment groups in the same cycle
 * - defer body-only end-of-buffer frames to preserve attachment lookahead
 *
 * Why:
 * unframed mode prioritizes maximal parse progress and compatibility with
 * legacy greedy continuation semantics.
 */
class GreedyFrameBoundaryPolicy implements FrameBoundaryPolicy {
  /**
   * Keep draining after one queued frame emission.
   *
   * Why `false`:
   * greedy mode should emit all immediately available deferred siblings before
   * returning control to the caller.
   */
  shouldStopAfterQueuedFrameEmission(): boolean {
    return false;
  }

  /**
   * Keep draining after one completed frame emission.
   *
   * Why `false`:
   * unframed callers expect `feed()` to make as much deterministic progress as
   * possible with currently buffered input.
   */
  shouldStopAfterCompletedFrameEmission(): boolean {
    return false;
  }

  /**
   * Keep collecting attachment groups until boundary/shortage.
   *
   * Why `false`:
   * greedy mode intentionally aggregates all contiguous trailing attachment
   * groups into one frame in the same drain cycle.
   */
  shouldStopAfterAttachmentGroupCollection(): boolean {
    return false;
  }

  /**
   * Do not emit pending frame immediately after one resumed attachment append.
   *
   * Why `false`:
   * greedy continuation should keep waiting until a clear frame boundary is
   * observed, so additional attachments can still be absorbed.
   */
  shouldEmitPendingAfterAttachmentResume(): boolean {
    return false;
  }

  /**
   * Defer body-only frame when no bytes remain.
   *
   * Why conditional `true`:
   * when attachment count is zero and the buffer is exhausted, hold as pending
   * to allow a following chunk to provide trailing attachments.
   */
  shouldDeferBodyOnlyFrame(
    attachmentCount: number,
    remainingBufferLength: number,
  ): boolean {
    return attachmentCount === 0 && remainingBufferLength === 0;
  }
}

/**
 * Bounded frame-boundary policy for `framed=true` mode.
 *
 * What:
 * - enforce one bounded parser work unit per drain cycle
 * - emit promptly instead of greedy continuation
 *
 * Why:
 * framed mode exists for deterministic stepwise consumption by callers that
 * interleave parsing with downstream processing.
 */
class BoundedFrameBoundaryPolicy implements FrameBoundaryPolicy {
  /**
   * Stop after one queued frame emission.
   *
   * Why `true`:
   * framed mode caps per-cycle output to a single unit of deferred progress.
   */
  shouldStopAfterQueuedFrameEmission(): boolean {
    return true;
  }

  /**
   * Stop after one completed frame emission.
   *
   * Why `true`:
   * preserves bounded cadence guarantees for framed consumers.
   */
  shouldStopAfterCompletedFrameEmission(): boolean {
    return true;
  }

  /**
   * Stop after one attachment-group collection step.
   *
   * Why `true`:
   * bounded mode avoids greedy attachment accumulation and returns control after
   * the first attachment parsing unit.
   */
  shouldStopAfterAttachmentGroupCollection(): boolean {
    return true;
  }

  /**
   * Emit pending frame immediately after one resumed attachment append.
   *
   * Why `true`:
   * framed continuation is intentionally stepwise and should not retain pending
   * once one bounded continuation step has succeeded.
   */
  shouldEmitPendingAfterAttachmentResume(): boolean {
    return true;
  }

  /**
   * Never defer body-only frame waiting for possible future attachments.
   *
   * Why `false`:
   * framed mode emits completed units as soon as possible instead of applying
   * greedy end-of-buffer hold behavior.
   */
  shouldDeferBodyOnlyFrame(
    _attachmentCount: number,
    _remainingBufferLength: number,
  ): boolean {
    return false;
  }
}

/**
 * Build default frame-boundary strategy from legacy parser options.
 *
 * Why:
 * maintains backward compatibility for `framed` while allowing call sites to
 * inject explicit `FrameBoundaryPolicy` implementations.
 */
export function createFrameBoundaryPolicy(
  framed: boolean = false,
): FrameBoundaryPolicy {
  return framed
    ? new BoundedFrameBoundaryPolicy()
    : new GreedyFrameBoundaryPolicy();
}
