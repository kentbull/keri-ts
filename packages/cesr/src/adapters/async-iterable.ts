import type { CesrFrame } from "../core/types.ts";
import { createParser, type ParserOptions } from "../core/parser-engine.ts";

export async function* toAsyncFrames(
  source: AsyncIterable<Uint8Array>,
  options: ParserOptions = {},
): AsyncGenerator<CesrFrame> {
  const parser = createParser(options);

  for await (const chunk of source) {
    const emissions = parser.feed(chunk);
    for (const emission of emissions) {
      if (emission.type === "error") throw emission.error;
      yield emission.frame;
    }
  }

  for (const emission of parser.flush()) {
    if (emission.type === "error") throw emission.error;
    yield emission.frame;
  }
}
