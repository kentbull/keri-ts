import { sniff } from "../parser/cold-start.ts";
import type { Versionage } from "../tables/table-types.ts";
import { concatBytes } from "./bytes.ts";
import type { ParserState } from "./types.ts";

/**
 * Owns mutable stream-level parser state (buffer, absolute offset, stream version).
 *
 * This class intentionally has no parse policy; it only provides deterministic
 * state transitions used by parser orchestration.
 */
export class ParserStreamState {
  private state: ParserState = { buffer: new Uint8Array(0), offset: 0 };
  private activeGvrsn: Versionage | null;

  /** Initialize with an explicit genus, or leave the stream unselected. */
  constructor(initialGvrsn: Versionage | null = null) {
    this.activeGvrsn = initialGvrsn;
  }

  /** Current unconsumed bytes. */
  get buffer(): Uint8Array {
    return this.state.buffer;
  }

  /** Absolute consumed-byte offset (monotonic). */
  get offset(): number {
    return this.state.offset;
  }

  /** Selected stream genus; null permits legacy inference. */
  get streamGvrsn(): Versionage | null {
    return this.activeGvrsn;
  }

  /** Update active top-level stream version context. */
  set streamGvrsn(gvrsn: Versionage | null) {
    this.activeGvrsn = gvrsn;
  }

  /** Append bytes to the buffered stream tail. */
  append(chunk: Uint8Array): void {
    this.state.buffer = concatBytes(this.state.buffer, chunk);
  }

  /** Consume a prefix from the buffer and advance absolute offset. */
  consume(length: number): void {
    this.state.buffer = this.state.buffer.slice(length);
    this.state.offset += length;
  }

  /** Consume all leading annotation-domain separator bytes (`ano`). */
  consumeLeadingAno(): void {
    while (this.state.buffer.length > 0 && sniff(this.state.buffer) === "ano") {
      this.consume(1);
    }
  }

  /** Reset buffer/offset/version to initial parser state. */
  reset(initialGvrsn: Versionage | null = null): void {
    this.state = { buffer: new Uint8Array(0), offset: 0 };
    this.activeGvrsn = initialGvrsn;
  }
}
