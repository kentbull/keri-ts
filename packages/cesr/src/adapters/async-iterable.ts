import type { CesrFrame } from "../core/types.ts";
import { parse, type ParseOptions } from "../parser/progressive.ts";

/** Adapt an async byte source through the progressive parser with pull backpressure. */
export async function* toAsyncFrames(
  source: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): AsyncGenerator<CesrFrame> {
  yield* parse(source, options);
}
