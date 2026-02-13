import { concatBytes } from "./bytes.ts";
import type { CesrFrame, ParseEmission, ParserState } from "./types.ts";
import { sniff } from "../parser/cold-start.ts";
import { reapSerder } from "../serder/serdery.ts";
import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { ColdStartError, ParserError, ShortageError } from "./errors.ts";

export interface ParserOptions {
  framed?: boolean;
}

export class CesrParserCore {
  private state: ParserState = { buffer: new Uint8Array(0), offset: 0 };
  private readonly framed: boolean;

  constructor(options: ParserOptions = {}) {
    this.framed = options.framed ?? false;
  }

  feed(chunk: Uint8Array): ParseEmission[] {
    this.state.buffer = concatBytes(this.state.buffer, chunk);
    return this.drain();
  }

  flush(): ParseEmission[] {
    if (this.state.buffer.length === 0) return [];
    return [{
      type: "error",
      error: new ShortageError(
        this.state.buffer.length + 1,
        this.state.buffer.length,
        this.state.offset,
      ),
    }];
  }

  reset(): void {
    this.state = { buffer: new Uint8Array(0), offset: 0 };
  }

  private drain(): ParseEmission[] {
    const out: ParseEmission[] = [];

    while (this.state.buffer.length > 0) {
      try {
        const cold = sniff(this.state.buffer);
        if (cold !== "msg") {
          throw new ColdStartError(
            `Expected message body at frame start but got ${cold}`,
            this.state.offset,
          );
        }

        const { serder, consumed: bodyConsumed } = reapSerder(
          this.state.buffer,
        );
        this.consume(bodyConsumed);

        const attachments: CesrFrame["attachments"] = [];

        while (this.state.buffer.length > 0) {
          const nextCold = sniff(this.state.buffer);
          if (nextCold === "msg") break;
          if (nextCold !== "txt" && nextCold !== "bny") {
            throw new ColdStartError(
              `Unsupported attachment cold code ${nextCold}`,
              this.state.offset,
            );
          }

          const { group, consumed } = parseAttachmentGroup(
            this.state.buffer,
            serder.gvrsn ?? serder.pvrsn,
            nextCold,
          );
          attachments.push(group);
          this.consume(consumed);
          if (this.framed) break;
        }

        out.push({ type: "frame", frame: { serder, attachments } });
        if (this.framed) break;
      } catch (error) {
        if (error instanceof ShortageError) {
          break;
        }
        const normalized = error instanceof ParserError
          ? error
          : new ParserError(String(error), this.state.offset);
        out.push({ type: "error", error: normalized });
        this.reset();
        break;
      }
    }

    return out;
  }

  private consume(length: number): void {
    this.state.buffer = this.state.buffer.slice(length);
    this.state.offset += length;
  }
}

export function createParser(options: ParserOptions = {}): CesrParserCore {
  return new CesrParserCore(options);
}

export function parseBytes(
  bytes: Uint8Array,
  options: ParserOptions = {},
): ParseEmission[] {
  const parser = createParser(options);
  return [...parser.feed(bytes), ...parser.flush()];
}
