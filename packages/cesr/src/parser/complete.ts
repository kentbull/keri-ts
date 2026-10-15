import { discardFrame } from "../core/frame.ts";
import type { CesrFrame } from "../core/types.ts";
import { parse, type ParseOptions } from "./progressive.ts";

/**
 * Parse complete input with the progressive engine and return every frame.
 *
 * This convenience API retains all results. Use parse() for progressive streaming
 * consumption. Keep input immutable until the promise settles. Successful
 * callers own each frame's ESSR payload; failure releases every collected payload
 * because no result has yet transferred to the caller.
 */
export async function parseBytes(bytes: Uint8Array, options: ParseOptions = {}): Promise<CesrFrame[]> {
  async function* source(): AsyncGenerator<Uint8Array> {
    options.signal?.throwIfAborted();
    yield bytes;
  }

  // Collection owns every publicly yielded frame until the whole input succeeds.
  const frames: CesrFrame[] = [];
  try {
    for await (const frame of parse(source(), options)) frames.push(frame);
    options.signal?.throwIfAborted();
    return frames;
  } catch (error) {
    // Continue releasing siblings even if one external storage cleanup fails.
    const failures: unknown[] = [];
    for (const frame of frames) {
      try {
        await discardFrame(frame);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      throw new AggregateError([error, ...failures], "Parsing failed and payload cleanup was incomplete", {
        cause: error,
      });
    }
    throw error;
  }
}
