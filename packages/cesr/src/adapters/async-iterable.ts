import type { CesrMessage } from "../core/types.ts";
import { createParser, type ParserOptions } from "../core/parser-engine.ts";

export async function* toAsyncFrames(
  source: AsyncIterable<Uint8Array>,
  options: ParserOptions = {},
): AsyncGenerator<CesrMessage> {
  const parser = createParser(options);

  for await (const chunk of source) {
    const frames = parser.feed(chunk);
    for (const frame of frames) {
      if (frame.type === "error") throw frame.error;
      yield frame.frame;
    }
  }

  for (const frame of parser.flush()) {
    if (frame.type === "error") throw frame.error;
    yield frame.frame;
  }
}
