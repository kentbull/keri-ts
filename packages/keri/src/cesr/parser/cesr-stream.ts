/*
This module exists as a development time convenience only to faciliate code navigation
and is rewritten by the build system to reference the "cesr-ts" package.
 */
export {
  CesrParserCore,
  createParser,
  parseBytes,
  type ParserOptions
} from "../../../../cesr/src/core/parser-engine.ts";

export { toAsyncFrames } from "../../../../cesr/src/adapters/async-iterable.ts";
export { toEffectionFrames, type FrameChannel } from "../../../../cesr/src/adapters/effection.ts";
export type { CesrFrame, ParseEmission, ParserState } from "../../../../cesr/src/core/types.ts";

