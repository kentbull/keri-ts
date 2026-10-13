import { action, type Operation } from "npm:effection@^3.6.0";
import type { CesrFrame } from "../core/types.ts";
import type { ParseOptions } from "../parser/progressive.ts";
import { toAsyncFrames } from "./async-iterable.ts";

/** Effection-facing handle for a parsed-frame async iterable. */
export interface FrameChannel {
  readonly frames: AsyncIterable<CesrFrame>;
}

/**
 * Bridge the async-iterable parser adapter into an Effection operation.
 *
 * This stays intentionally thin so parser semantics continue to live in
 * `toAsyncFrames()` rather than forking behavior in an Effection-only path.
 */
export function* toEffectionFrames(
  source: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): Operation<FrameChannel> {
  const frames = yield* action<AsyncIterable<CesrFrame>>((resolve) => {
    resolve(toAsyncFrames(source, options));
    return () => {};
  });

  return { frames };
}
