/*
This module exists as a development time convenience only to faciliate code navigation
and is rewritten by the build system to reference the "cesr-ts" package.
 */
export { CesrParser, createParser, parseBytes, type ParserOptions } from "cesr-ts";

export { toAsyncFrames } from "cesr-ts";
export { type FrameChannel, toEffectionFrames } from "cesr-ts";
export type { CesrFrame, CesrMessage, ParserState } from "cesr-ts";
