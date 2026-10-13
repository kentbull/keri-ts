import { sniff } from "../parser/cold-start.ts";
import type { AttachmentDispatchOptions } from "../parser/group-dispatch.ts";
import type { Versionage } from "../tables/table-types.ts";
import { concatBytes } from "./bytes.ts";
import { ParserError, ShortageError } from "./errors.ts";
import { AttachmentCollector } from "./parser-attachment-collector.ts";
import { FrameParser } from "./parser-frame-parser.ts";
import type { CesrFrame, ParseEvent } from "./types.ts";

/**
 * Parser construction options for emission and wrapper-tail recovery.
 */
export interface ParserOptions {
  /** Emit at most one complete frame per feed; never treat a chunk as a frame. */
  framed?: boolean;
  /** Wrapper-tail recovery mode; attachment dispatch never retries versions. */
  attachmentDispatchMode?: AttachmentDispatchOptions["mode"];
}

/**
 * Streaming CESR parser for message-domain and CESR-native body-group streams.
 * Handles chunk boundaries, pending frames, and attachment continuation.
 */
export class CesrParser {
  /**
   * Parser state contract (normative):
   * `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
   */
  private readonly framed: boolean;
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private streamGvrsn: Versionage | null = null;
  private pending: { frame: CesrFrame; gvrsn: Versionage } | null = null;
  private queued: CesrFrame[] = [];
  private readonly frameParser: FrameParser;
  private readonly attachmentCollector: AttachmentCollector;

  /** Configure frame parsing and attachment collection. */
  constructor(options: ParserOptions = {}) {
    this.framed = options.framed ?? false;
    const attachmentDispatchMode = options.attachmentDispatchMode ?? "compat";

    this.frameParser = new FrameParser({
      attachmentDispatchMode,
    });
    this.attachmentCollector = new AttachmentCollector({
      attachmentDispatchMode,
      startsFrame: (input, gvrsn, cold) => this.frameParser.startsFrame(input, gvrsn, cold),
    });
  }

  /** Append bytes and emit any complete parse events. */
  feed(chunk: Uint8Array): ParseEvent[] {
    this.append(chunk);
    return this.drain();
  }

  /** Finish a complete record or stream, emitting complete frames or a terminal shortage. */
  flush(): ParseEvent[] {
    return this.drain(true);
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.offset = 0;
    this.streamGvrsn = null;
    this.pending = null;
    this.queued = [];
  }

  /** Append bytes without changing the consumed offset or selected genus. */
  private append(chunk: Uint8Array): void {
    this.buffer = concatBytes(this.buffer, chunk);
  }

  /** Remove a consumed prefix and advance the absolute byte offset. */
  private consume(length: number): void {
    this.buffer = this.buffer.slice(length);
    this.offset += length;
  }

  /** Resume open attachments or emit enclosed frames before parsing another body. */
  private drain(terminal = false): ParseEvent[] {
    const out: ParseEvent[] = [];
    while (this.buffer.length > 0 || this.queued.length > 0 || (terminal && this.pending)) {
      try {
        while (this.buffer.length > 0 && sniff(this.buffer) === "ano") {
          this.consume(1);
        }
        const pending = this.pending;
        if (pending) {
          const collected = this.attachmentCollector.collectTrailingAttachments(
            this.buffer,
            pending.gvrsn,
            pending.frame.attachments,
            terminal,
          );
          this.consume(collected.consumed);
          pending.frame.attachments = collected.attachments;
          if (!collected.complete) {
            if (terminal) {
              throw new ShortageError(this.buffer.length + 1, this.buffer.length, this.offset);
            }
            break;
          }
          out.push({ type: "frame", frame: pending.frame });
          this.pending = null;
        } else if (this.queued.length > 0) {
          out.push({ type: "frame", frame: this.queued.shift()! });
        } else {
          if (this.buffer.length === 0) break;
          const base = this.frameParser.parseFrameStart(this.buffer, this.streamGvrsn);
          this.consume(base.consumed);
          this.streamGvrsn = base.streamGvrsn;
          if (!base.complete) {
            this.pending = { frame: base.frame, gvrsn: base.gvrsn };
            continue;
          }
          this.queued.push(...(base.siblings ?? []));
          out.push({ type: "frame", frame: base.frame });
        }
        if (!terminal && this.framed) break;
      } catch (error) {
        if (error instanceof ShortageError) {
          if (!terminal) break;
          out.push({
            type: "error",
            error: new ShortageError(
              this.buffer.length + 1,
              this.buffer.length,
              this.offset,
            ),
          });
          this.consume(this.buffer.length);
          this.pending = null;
          break;
        }
        const normalized = error instanceof ParserError
          ? error
          : new ParserError(String(error), this.offset);
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
): ParseEvent[] {
  const parser = createParser(options);
  return [...parser.feed(bytes), ...parser.flush()];
}
