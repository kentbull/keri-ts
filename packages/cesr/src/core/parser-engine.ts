import type { CesrFrame, CesrMessage } from "./types.ts";
import {
  type AttachmentDispatchOptions,
  type AttachmentVersionFallbackPolicy,
  createAttachmentVersionFallbackPolicy,
  type VersionFallbackInfo,
} from "../parser/group-dispatch.ts";
import { ParserError, ShortageError } from "./errors.ts";
import { DEFAULT_VERSION } from "./parser-constants.ts";
import { ParserStreamState } from "./parser-stream-state.ts";
import { DeferredFrameLifecycle } from "./parser-deferred-frames.ts";
import { FrameParser } from "./parser-frame-parser.ts";
import { AttachmentCollector } from "./parser-attachment-collector.ts";
import {
  createFrameBoundaryPolicy,
  type FrameBoundaryPolicy,
} from "./parser-policy.ts";
import {
  composeRecoveryDiagnosticObserver,
  type RecoveryDiagnosticObserver,
} from "./recovery-diagnostics.ts";

export interface ParserOptions {
  /** Legacy framed toggle; used only when `frameBoundaryPolicy` is not injected. */
  framed?: boolean;
  /**
   * Legacy strict/compat selector; used only when
   * `attachmentVersionFallbackPolicy` is not injected.
   */
  attachmentDispatchMode?: AttachmentDispatchOptions["mode"];
  /** Legacy fallback observer; adapted from structured diagnostics events. */
  onAttachmentVersionFallback?: (info: VersionFallbackInfo) => void;
  /** Structured recovery diagnostics observer (preferred observability path). */
  onRecoveryDiagnostic?: RecoveryDiagnosticObserver;
  /** Explicit frame-boundary strategy override (preferred for new integrations). */
  frameBoundaryPolicy?: FrameBoundaryPolicy;
  /**
   * Explicit attachment fallback strategy override.
   *
   * When provided, this supersedes `attachmentDispatchMode` and
   * `onAttachmentVersionFallback`.
   */
  attachmentVersionFallbackPolicy?: AttachmentVersionFallbackPolicy;
}

/**
 * Streaming CESR parser for message-domain and CESR-native body-group streams.
 * Handles chunk boundaries, pending frames, and attachment continuation.
 */
export class CesrParser {
  /**
   * Parser state contract (normative):
   * `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
   */
  private readonly frameBoundaryPolicy: FrameBoundaryPolicy;
  private readonly stream: ParserStreamState;
  private readonly deferred: DeferredFrameLifecycle;
  private readonly frameParser: FrameParser;
  private readonly attachmentCollector: AttachmentCollector;
  private readonly recoveryDiagnosticObserver?: RecoveryDiagnosticObserver;

  /**
   * Compose parser collaborators with injected policy strategies.
   *
   * Policy precedence:
   * 1) explicit policy objects from `ParserOptions`
   * 2) derived defaults from legacy `framed` and strict/compat options
   */
  constructor(options: ParserOptions = {}) {
    this.frameBoundaryPolicy = options.frameBoundaryPolicy ??
      createFrameBoundaryPolicy(options.framed ?? false);
    this.recoveryDiagnosticObserver = composeRecoveryDiagnosticObserver({
      onRecoveryDiagnostic: options.onRecoveryDiagnostic,
      onAttachmentVersionFallback: options.attachmentVersionFallbackPolicy
        ? undefined
        : options.onAttachmentVersionFallback,
    });
    const attachmentVersionFallbackPolicy =
      options.attachmentVersionFallbackPolicy ??
        createAttachmentVersionFallbackPolicy({
          mode: options.attachmentDispatchMode,
        });

    this.stream = new ParserStreamState(DEFAULT_VERSION);
    this.deferred = new DeferredFrameLifecycle();
    this.frameParser = new FrameParser({
      frameBoundaryPolicy: this.frameBoundaryPolicy,
      attachmentVersionFallbackPolicy,
      onEnclosedFrames: (frames) => this.deferred.enqueueQueued(frames),
      recoveryDiagnosticObserver: this.recoveryDiagnosticObserver,
    });
    this.attachmentCollector = new AttachmentCollector({
      frameBoundaryPolicy: this.frameBoundaryPolicy,
      attachmentVersionFallbackPolicy,
      recoveryDiagnosticObserver: this.recoveryDiagnosticObserver,
      isFrameBoundaryAhead: (input, version, cold) =>
        this.frameParser.isFrameBoundaryAhead(input, version, cold),
    });
  }

  /** Append bytes and emit any complete parse events. */
  feed(chunk: Uint8Array): CesrFrame[] {
    this.stream.append(chunk);
    return this.drain();
  }

  /** Flush pending state at end-of-stream, emitting frame/error if needed. */
  flush(): CesrFrame[] {
    const out = this.deferred.flushDeferred();
    if (this.stream.buffer.length === 0) {
      return out;
    }

    const remainder = this.stream.buffer.length;
    out.push({
      type: "error",
      error: new ShortageError(
        remainder + 1,
        remainder,
        this.stream.offset,
      ),
    });
    this.stream.consume(remainder);
    return out;
  }

  reset(): void {
    this.stream.reset(DEFAULT_VERSION);
    this.deferred.reset();
  }

  /**
   * Core streaming loop. Emit pending frames, then queued frames, then new base frame with trailing attachments.
   * Contract invariants:
   * - `pendingFrame` is always resumed before any queued enclosed frame emits.
   * - `queuedFrames` are emitted before starting a new parse from `buffer`.
   */
  private drain(): CesrFrame[] {
    const out: CesrFrame[] = [];

    while (this.stream.buffer.length > 0) {
      try {
        this.stream.consumeLeadingAno();
        if (this.stream.buffer.length === 0) {
          break;
        }

        const pending = this.deferred.pending;
        if (pending) {
          const resume = this.attachmentCollector.resumePendingFrame(
            this.stream.buffer,
            pending.frame,
            pending.version,
            this.stream.streamVersion,
          );
          if (resume.consumed > 0) {
            this.stream.consume(resume.consumed);
          }
          if (resume.emitPending) {
            out.push({ type: "frame", frame: pending.frame });
            this.deferred.clearPending();
          }
          if (!resume.shouldContinue) {
            break;
          }
          continue;
        }

        if (this.deferred.hasQueued()) {
          const frame = this.deferred.shiftQueued();
          if (frame) {
            out.push({ type: "frame", frame });
            if (
              this.frameBoundaryPolicy.shouldStopAfterQueuedFrameEmission()
            ) {
              break;
            }
          }
          continue;
        }

        const base = this.frameParser.parseFrame(
          this.stream.buffer,
          this.stream.streamVersion,
        );
        this.stream.consume(base.consumed);
        this.stream.streamVersion = base.streamVersion;

        const collected = this.attachmentCollector.collectTrailingAttachments(
          this.stream.buffer,
          base.version,
          base.streamVersion,
          base.frame.attachments,
        );
        if (collected.consumed > 0) {
          this.stream.consume(collected.consumed);
        }

        if (collected.pausedForShortage) {
          this.deferred.setPending(
            { body: base.frame.body, attachments: collected.attachments },
            base.version,
          );
          break;
        }

        const completed: CesrMessage = {
          body: base.frame.body,
          attachments: collected.attachments,
        };

        // when in greedy attachment collection mode and a complete body has
        // been received then set the current base frame as the pending frame to
        // wait for attachments to arrive.
        if (
          this.frameBoundaryPolicy.shouldDeferBodyOnlyFrame(
            completed.attachments.length,
            this.stream.buffer.length,
          )
        ) {
          this.deferred.setPending(completed, base.version);
          break;
        }

        // Once all attachments have arrived then emit the current completed frame
        out.push({ type: "frame", frame: completed });
        if (this.frameBoundaryPolicy.shouldStopAfterCompletedFrameEmission()) {
          break;
        }
      } catch (error) {
        // Shortage Errors are expected when waiting for bytes to arrive for
        // either message bodies (base) frames or attachment frames.
        if (error instanceof ShortageError) {
          break;
        }
        // For any other error, push a ParserError, emit an error frame, and reset
        const normalized = error instanceof ParserError
          ? error
          : new ParserError(String(error), this.stream.offset);
        this.recoveryDiagnosticObserver?.({
          type: "parser-error-reset",
          offset: this.stream.offset,
          errorName: normalized.name,
          reason: normalized.message,
        });
        out.push({ type: "error", error: normalized });
        this.reset();
        break;
      }
    }

    return out;
  }
}

/** CESR parser factory function. */
export function createParser(options: ParserOptions = {}): CesrParser {
  return new CesrParser(options);
}

/** Parse a buffer of bytes into a list of frames. */
export function parseBytes(
  bytes: Uint8Array,
  options: ParserOptions = {},
): CesrFrame[] {
  const parser = createParser(options);
  return [...parser.feed(bytes), ...parser.flush()];
}
