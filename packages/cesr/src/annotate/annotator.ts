import { b } from "../core/bytes.ts";
import type { CesrFrame } from "../core/types.ts";
import { parseBytes } from "../parser/complete.ts";
import { renderAnnotatedFrames } from "./render.ts";
import type { AnnotatedFrame, AnnotateOptions, RenderOptions } from "./types.ts";

/** Presentation defaults do not change protocol parsing. */
const DEFAULT_OPTIONS: RenderOptions = Object.freeze({
  commentMode: "inline",
  indent: 2,
  pretty: false,
});
/** Decode finite input and render the original wrapper wire without temporary storage. */
export function annotateFrames(input: Uint8Array | string, options: AnnotateOptions = {}): AnnotatedFrame[] {
  const bytes = typeof input === "string" ? b(input) : input;
  return renderAnnotatedFrames(parseBytes(bytes), { ...DEFAULT_OPTIONS, ...options }, bytes);
}

/** Render finite annotation text from ordinary complete message values. */
export function annotate(input: Uint8Array | string, options: AnnotateOptions = {}): string {
  return annotateFrames(input, options).map((frame) => frame.lines.join("\n")).join("\n");
}
