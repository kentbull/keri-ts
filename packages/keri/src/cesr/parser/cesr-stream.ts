/*
This module exists as a development time convenience only to faciliate code navigation
and is rewritten by the build system to reference the "cesr-ts" package.
 */
export { CesrParser, createParser, parseBytes, type ParserOptions } from "../../../../cesr/src/core/parser-engine.ts";

export { toAsyncFrames } from "../../../../cesr/src/adapters/async-iterable.ts";
export { type FrameChannel, toEffectionFrames } from "../../../../cesr/src/adapters/effection.ts";
export type { CesrFrame, CesrMessage, ParserState } from "../../../../cesr/src/core/types.ts";
