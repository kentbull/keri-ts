/** Buffered input accumulation around the finite CESR decoder. */
import { ParserError, ShortageError, WireParseError } from "../core/errors.ts";
import type { CesrFrame } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { decodeNext } from "./decoder.ts";

/** Input cancellation belongs to the concrete source owner. */
export interface ParseOptions {
  signal?: AbortSignal;
}

/** Receive fragments and emit complete messages; counted enclosures arrive before decoding. */
export async function* parse(
  source: AsyncIterable<Uint8Array>,
  { signal }: ParseOptions = {},
): AsyncGenerator<CesrFrame, void> {
  signal?.throwIfAborted();
  const input = source[Symbol.asyncIterator]();
  const failures: unknown[] = [];
  let bytes = new Uint8Array(0), start = 0, end = 0, wanted = 1, eof = false;
  let selected: Versionage | null = null;
  try {
    while (true) {
      signal?.throwIfAborted();
      if (end - start >= wanted || eof) {
        if (start === end && eof) return;
        let decoderFailure: unknown;
        try {
          const unit = decodeNext(bytes.subarray(start, end), selected, eof, (error) => {
            decoderFailure = error;
          });
          let step = unit.next();
          while (!step.done) {
            yield step.value;
            signal?.throwIfAborted();
            step = unit.next();
          }
          start += step.value.consumed;
          selected = step.value.selected;
          wanted = 1;
          if (start === end) start = end = 0;
          if (end > start) continue;
          if (eof) return;
        } catch (error) {
          if (error instanceof ShortageError && !eof) wanted = error.needed;
          else if (error instanceof ParserError && error !== decoderFailure && error !== signal?.reason) {
            throw new WireParseError(error);
          } else throw error;
        }
      }
      // Source operations stay outside decoding classification. The source honors cancellation.
      const part = await input.next();
      signal?.throwIfAborted();
      if (part.done) {
        eof = true;
        continue;
      }
      const size = end - start + part.value.length;
      if (size > bytes.length) {
        const buffer = new Uint8Array(Math.max(size, bytes.length * 2, 4096));
        buffer.set(bytes.subarray(start, end));
        end -= start;
        start = 0;
        bytes = buffer;
      } else if (bytes.length - end < part.value.length) {
        bytes.copyWithin(0, start, end);
        end -= start;
        start = 0;
      }
      bytes.set(part.value, end);
      end += part.value.length;
    }
  } catch (error) {
    failures.push(error);
    throw error;
  } finally {
    try {
      await input.return?.();
    } catch (cleanup) {
      if (failures.length && cleanup !== failures[0]) {
        // deno-lint-ignore no-unsafe-finally -- Preserve both the parse failure and joined source cleanup failure.
        throw new AggregateError([...failures, cleanup], "Parsing and source cleanup failed", { cause: failures[0] });
      }
      // deno-lint-ignore no-unsafe-finally -- Source cleanup must fail the operation even after a successful delivery.
      throw cleanup;
    }
  }
}
