import { createParser, type ParserOptions } from "../core/parser-engine.ts";
import type { CesrMessage } from "../core/types.ts";

/**
 * Adapt an async byte stream into parsed CESR frames.
 *
 * Boundary contract:
 * - chunks are fed in arrival order into one parser instance
 * - emitted parser error events are rethrown as stream errors
 * - yielded values are the historical `CesrMessage` frame payloads only
 */
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
