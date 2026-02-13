import { action, type Operation } from "effection";
import type { CesrFrame } from "../core/types.ts";
import { toAsyncFrames } from "./async-iterable.ts";
import type { ParserOptions } from "../core/parser-engine.ts";

export interface FrameChannel {
  readonly frames: AsyncIterable<CesrFrame>;
}

export function* toEffectionFrames(
  source: AsyncIterable<Uint8Array>,
  options: ParserOptions = {},
): Operation<FrameChannel> {
  const frames = yield* action<AsyncIterable<CesrFrame>>((resolve) => {
    resolve(toAsyncFrames(source, options));
    return () => {};
  });

  return { frames };
}
