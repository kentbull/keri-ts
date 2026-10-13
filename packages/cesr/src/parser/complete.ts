import { ResourceLimitError } from "../core/errors.ts";
import { discardFrame } from "../core/frame.ts";
import type { CesrFrame } from "../core/types.ts";
import { parse, type ParseOptions } from "./progressive.ts";

/** Finite collection policy, separate from each streamed frame's admission limits. */
export interface ParseBytesOptions extends ParseOptions {
  /** Total encoded input admitted for collection; defaults to 8 MiB. */
  maxInputBytes?: number;
}

/**
 * Parse complete input with the progressive engine and return every frame.
 *
 * This convenience API retains all results under an explicit input limit. Use parse() for bounded streaming
 * consumption. Keep input immutable until the promise settles. Successful
 * callers own each frame's ESSR payload; failure releases every collected payload
 * because no result has yet transferred to the caller.
 */
export async function parseBytes(bytes: Uint8Array, options: ParseBytesOptions = {}): Promise<CesrFrame[]> {
  const limit = options.maxInputBytes ?? 8 * 1024 ** 2;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid finite input limit");
  if (bytes.length > limit) throw new ResourceLimitError("Complete input exceeds collection limit");
  // Copy each admitted chunk once: subarrays would pin the caller's entire input
  // and violate the cursor's backing-allocation budget for large finite inputs.
  async function* source(): AsyncGenerator<Uint8Array> {
    const size = Math.min(65536, options.maxChunkBytes ?? 1024 ** 2);
    for (let offset = 0; offset < bytes.length; offset += size) {
      options.signal?.throwIfAborted();
      yield bytes.slice(offset, offset + size);
    }
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
