import { action, type Operation } from "npm:effection@^3.6.0";
import type { ParserOptions } from "../core/parser-engine.ts";
import type { CesrMessage } from "../core/types.ts";
import { toAsyncFrames } from "./async-iterable.ts";

export interface FrameChannel {
  readonly frames: AsyncIterable<CesrMessage>;
}

export function* toEffectionFrames(
  source: AsyncIterable<Uint8Array>,
  options: ParserOptions = {},
): Operation<FrameChannel> {
  const frames = yield* action<AsyncIterable<CesrMessage>>((resolve) => {
    resolve(toAsyncFrames(source, options));
    return () => {};
  });

  return { frames };
}
