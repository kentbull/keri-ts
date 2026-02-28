import type { CesrFrame, CesrMessage } from "./types.ts";
import type {
  AttachmentDispatchMode,
  AttachmentDispatchOptions,
  VersionFallbackInfo,
} from "../parser/group-dispatch.ts";
import { ParserError, ShortageError } from "./errors.ts";
import { DEFAULT_VERSION } from "./parser-constants.ts";
import { ParserStreamState } from "./parser-stream-state.ts";
import { DeferredFrameLifecycle } from "./parser-deferred-frames.ts";
import { FrameParser } from "./parser-frame-parser.ts";
import { AttachmentCollector } from "./parser-attachment-collector.ts";

export interface ParserOptions {
  framed?: boolean;
  attachmentDispatchMode?: AttachmentDispatchOptions["mode"];
  onAttachmentVersionFallback?: (info: VersionFallbackInfo) => void;
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
  private readonly framed: boolean;
  private readonly stream: ParserStreamState;
  private readonly deferred: DeferredFrameLifecycle;
  private readonly frameParser: FrameParser;
  private readonly attachmentCollector: AttachmentCollector;

  constructor(options: ParserOptions = {}) {
    this.framed = options.framed ?? false;
    const attachmentDispatchMode: AttachmentDispatchMode =
      options.attachmentDispatchMode ?? "compat";

    this.stream = new ParserStreamState(DEFAULT_VERSION);
    this.deferred = new DeferredFrameLifecycle();
    this.frameParser = new FrameParser({
      framed: this.framed,
      attachmentDispatchMode,
      onAttachmentVersionFallback: options.onAttachmentVersionFallback,
      onEnclosedFrames: (frames) => this.deferred.enqueueQueued(frames),
    });
    this.attachmentCollector = new AttachmentCollector({
      framed: this.framed,
      attachmentDispatchMode,
      onAttachmentVersionFallback: options.onAttachmentVersionFallback,
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
            if (this.framed) {
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
          !this.framed && completed.attachments.length === 0 &&
          this.stream.buffer.length === 0
        ) {
          this.deferred.setPending(completed, base.version);
          break;
        }

        // Once all attachments have arrived then emit the current completed frame
        out.push({ type: "frame", frame: completed });
        if (this.framed) {
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
